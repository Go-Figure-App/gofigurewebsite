/**
 * api/_mailchimp.js — request-handling and Mailchimp plumbing shared by the API routes.
 *
 * The leading underscore is load-bearing, and the location is deliberate. Vercel turns every
 * file in api/ into a serverless function EXCEPT underscore-prefixed ones, and it serves
 * everything outside api/ verbatim as a static file. So this file:
 *
 *   - is not published — the same helpers at lib/mailchimp.js were downloadable at
 *     gofigureapp.io/lib/mailchimp.js, handing out the origin allowlist and rate-limit
 *     settings (verified with `npx vercel build`; see the warning in README.md)
 *   - is not routed — no /api/_mailchimp endpoint is created
 *   - still ships, because file tracing follows the static require in quiz-submit.js
 *
 * Verify with `npx vercel build` after moving it: it must appear under
 * .vercel/output/functions/api/quiz-submit.func/ and NOT under .vercel/output/static/.
 *
 * api/subscribe.js predates this file and keeps its own copies of these helpers. That was
 * deliberate: it is the live tester-signup path and rewriting it to prove a refactor is not
 * worth the risk. If you touch it for another reason, that is the moment to pull it over.
 *
 * CommonJS, zero deps — package.json is "type": "commonjs" and Node 18+ on Vercel has
 * global fetch and a built-in crypto module.
 */

const crypto = require('crypto');

const CONTACT_EMAIL = 'contact@gofigureapp.io';

/**
 * Origins allowed to POST to our routes. A missing Origin header is allowed through: some
 * clients omit it on same-origin posts, and blocking those would cost real submissions to
 * stop an attacker who can trivially omit the header anyway. Rate limiting is the real
 * defense; this only turns away casual cross-site abuse.
 */
const ALLOWED_ORIGINS = [
  'https://gofigureapp.io',
  'https://www.gofigureapp.io',
  'http://localhost:3000',
];

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * Mailchimp rejects ISO 8601 here ("This value is not a valid datetime") — it wants
 * 'YYYY-MM-DD HH:MM:SS' in UTC, with no 'T', no milliseconds and no 'Z'.
 */
function mailchimpTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** First entry of x-forwarded-for is the real client on Vercel; the rest are proxies. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const candidate = (forwarded ? String(forwarded).split(',')[0] : req.headers['x-real-ip']) || '';
  const ip = candidate.trim();
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((n) => Number(n) <= 255);
  const isIpv6 = ip.includes(':') && /^[0-9a-fA-F:.]+$/.test(ip);
  return isIpv4 || isIpv6 ? ip : '';
}

/**
 * On a preview deployment the site is served from a generated hostname, not gofigureapp.io,
 * so the fixed list above would 403 every submission and make previews untestable.
 *
 * Vercel injects the deployment's own hostnames, so the preview origin is read from those
 * rather than allow-listing a `*.vercel.app` wildcard — which would let ANY Vercel-hosted
 * site post here. Only active when VERCEL_ENV is 'preview'; production keeps the fixed list.
 *
 *   VERCEL_URL         the unique deployment hostname  (gofigurewebsite-abc123.vercel.app)
 *   VERCEL_BRANCH_URL  the branch alias                (gofigurewebsite-git-main-….vercel.app)
 */
function previewOrigins() {
  if (process.env.VERCEL_ENV !== 'preview') return [];
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .filter(Boolean)
    .map((host) => `https://${host}`);
}

/** True when the Origin header is present and not one of ours. */
function isDisallowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = ALLOWED_ORIGINS.concat(previewOrigins());
  return !allowed.includes(String(origin));
}

/**
 * Builds a per-IP rate limiter. In-memory, so it is per warm container and resets on cold
 * start — it raises the cost of casual scripted abuse but is NOT a defense against a
 * distributed or determined attacker. For that, back it with a shared store (Vercel KV /
 * Upstash); callers do not need to change.
 *
 * Each route gets its own limiter instance, so quiz traffic cannot exhaust the signup budget.
 *
 * `hit(ip)` returns 0 when allowed, or the seconds to wait when blocked. An unknown IP is
 * never limited: every such request would otherwise share one bucket and lock each other out.
 */
function createRateLimiter({ windowMs, max, maxTrackedIps = 5000 }) {
  /** ip -> array of request timestamps inside the current window. */
  const recentRequests = new Map();

  return function hit(ip) {
    if (!ip) return 0;

    const now = Date.now();
    const cutoff = now - windowMs;

    // Prune expired entries. The map only holds active IPs, so this stays cheap.
    for (const [key, times] of recentRequests) {
      const live = times.filter((t) => t > cutoff);
      if (live.length) recentRequests.set(key, live);
      else recentRequests.delete(key);
    }

    // Map iterates in insertion order, so the first key is the least recently added.
    while (recentRequests.size >= maxTrackedIps) {
      const oldest = recentRequests.keys().next().value;
      if (oldest === undefined) break;
      recentRequests.delete(oldest);
    }

    const times = recentRequests.get(ip) || [];
    if (times.length >= max) {
      return Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
    }

    times.push(now);
    recentRequests.set(ip, times);
    return 0;
  };
}

/**
 * Reads the Mailchimp env vars and derives everything a request needs from them.
 * Returns { ok: false } when the function is misconfigured, so the caller can answer with a
 * generic 500 rather than leaking which variable is missing.
 *
 * The datacenter is the suffix of the API key (e.g. '...-us18'); there is no separate var.
 */
function credentials() {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    console.error('Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID.');
    return { ok: false };
  }

  const datacenter = apiKey.split('-')[1];
  if (!datacenter) {
    console.error('MAILCHIMP_API_KEY has no datacenter suffix (expected e.g. "...-us18").');
    return { ok: false };
  }

  return {
    ok: true,
    audienceId,
    base: `https://${datacenter}.api.mailchimp.com/3.0`,
    auth: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
  };
}

/** Mailchimp addresses a contact by the MD5 of its lowercased email. */
function subscriberHash(email) {
  return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
}

/**
 * Fetches an existing contact, or null when they are not on the list yet.
 * A 404 is the normal "new person" answer, not an error worth logging.
 */
async function getMember({ base, auth, audienceId }, hash, fields) {
  try {
    const query = fields ? `?fields=${encodeURIComponent(fields)}` : '';
    const res = await fetch(`${base}/lists/${audienceId}/members/${hash}${query}`, {
      headers: { Authorization: auth },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error('Mailchimp member lookup failed:', res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('Mailchimp member lookup threw:', err);
    return null;
  }
}

module.exports = {
  ALLOWED_ORIGINS,
  CONTACT_EMAIL,
  clean,
  clientIp,
  createRateLimiter,
  credentials,
  getMember,
  isDisallowedOrigin,
  looksLikeEmail,
  mailchimpTimestamp,
  subscriberHash,
};
