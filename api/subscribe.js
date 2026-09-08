/**
 * POST /api/subscribe — adds an early-tester signup to the Go Figure Mailchimp audience.
 *
 * Single opt-in: contacts are created as 'subscribed' with no confirmation email. That is
 * only defensible because the form captures an explicit, unchecked consent checkbox and we
 * store the consent evidence Mailchimp provides (ip_signup + timestamp_signup, plus GDPR
 * marketing permissions when the audience has them enabled).
 *
 * CommonJS on purpose: package.json sets "type": "commonjs", so `export default` in a .js
 * file would fail at runtime. No npm deps — Node 18+ on Vercel has global fetch, and MD5
 * comes from the built-in crypto module.
 *
 * Env vars (Vercel → Settings → Environment Variables):
 *   MAILCHIMP_API_KEY      e.g. abc123...def-us18   (the -us18 suffix is the datacenter)
 *   MAILCHIMP_AUDIENCE_ID  e.g. f1542cb5bf
 */

const crypto = require('crypto');

/**
 * The Mailchimp *merge tag* for the "Role" dropdown — NOT the field label.
 * Audience → Settings → Audience fields and |MERGE| tags shows the tag on the right.
 */
const ROLE_MERGE_TAG = 'ROLE';

/**
 * 'subscribed' — added to the list immediately, no confirmation email (requires the
 *                consent checkbox below, which is enforced server-side).
 * 'pending'    — double opt-in: Mailchimp emails a confirmation link first.
 *
 * This is only what we ask for. If the audience has double opt-in enabled, Mailchimp
 * overrides it to 'pending' and the contact stays off the list until they click the
 * confirmation link — so the status we report to the browser is read back off the
 * response, never assumed from this constant.
 */
const NEW_MEMBER_STATUS = 'subscribed';

/**
 * The exact consent wording shown next to the checkbox. Kept here so the server records
 * what was actually agreed to; if you change the form copy, change this to match.
 */
const CONSENT_TEXT =
  'Yes, email me about Go Figure tester access and product updates. I can unsubscribe anytime.';

/** Stable prefix so we can recognize a consent note we already wrote and not duplicate it. */
const CONSENT_NOTE_PREFIX = 'Consent via gofigureapp.io tester form:';

/** Must match the dropdown choices in Mailchimp exactly, or the value is rejected. */
const ROLES = ['Coach', 'Parent of Skater', 'Adult Skater (18+)', 'Other'];

const CONTACT_EMAIL = 'contact@gofigureapp.io';

/**
 * Origins allowed to POST here. A missing Origin header is allowed through: some clients
 * omit it on same-origin form posts, and blocking those would cost real signups to stop an
 * attacker who can trivially omit the header anyway. Rate limiting below is the real defense;
 * this only turns away casual cross-site abuse.
 */
const ALLOWED_ORIGINS = [
  'https://gofigureapp.io',
  'https://www.gofigureapp.io',
  'http://localhost:3000',
];

/**
 * Per-IP rate limit. In-memory, so it is per warm container and resets on cold start — it
 * raises the cost of casual scripted abuse but is NOT a defense against a distributed or
 * determined attacker. For that, swap `hitRateLimit` for a shared store (Vercel KV / Upstash);
 * the rest of the handler does not need to change.
 *
 * 10 per 10 minutes is far above what a real person does (including retyping a bad address)
 * and low enough to make bulk list-stuffing tedious. Every request counts toward it, including
 * honeypot hits and validation failures, so probing is not free.
 */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
/** Bounds memory if a botnet cycles IPs; oldest entries are dropped first. */
const RATE_LIMIT_MAX_TRACKED_IPS = 5000;

/** ip -> array of request timestamps inside the current window. */
const recentRequests = new Map();

/** Cached per warm container. null until a lookup succeeds; then an array, possibly empty. */
let cachedEmailPermissionIds = null;

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
 * Records a request and reports whether this IP is over its limit. An unknown IP is never
 * limited: every such request would otherwise share one bucket and lock each other out.
 * Returns 0 when allowed, or the seconds to wait when blocked.
 */
function hitRateLimit(ip) {
  if (!ip) return 0;

  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  // Prune expired entries. The map only holds active IPs, so this stays cheap.
  for (const [key, times] of recentRequests) {
    const live = times.filter((t) => t > cutoff);
    if (live.length) recentRequests.set(key, live);
    else recentRequests.delete(key);
  }

  // Map iterates in insertion order, so the first key is the least recently added.
  while (recentRequests.size >= RATE_LIMIT_MAX_TRACKED_IPS) {
    const oldest = recentRequests.keys().next().value;
    if (oldest === undefined) break;
    recentRequests.delete(oldest);
  }

  const times = recentRequests.get(ip) || [];
  if (times.length >= RATE_LIMIT_MAX) {
    return Math.max(1, Math.ceil((times[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
  }

  times.push(now);
  recentRequests.set(ip, times);
  return 0;
}

/** True when the Origin header is present and not one of ours. */
function isDisallowedOrigin(req) {
  const origin = req.headers.origin;
  return Boolean(origin) && !ALLOWED_ORIGINS.includes(String(origin));
}

/**
 * Marketing-permission IDs are per-audience GUIDs that only exist once GDPR fields are
 * switched on, and there is no endpoint that lists them — they show up on member records.
 * So read them off any member.
 *
 * A successful lookup is cached even when it finds nothing, because the audience currently
 * has GDPR fields off and re-asking on every signup added a round trip per request for a
 * result that never changes. The trade: turning those fields on takes effect at the next cold
 * start rather than the next signup. Failed lookups are not cached, so a blip self-corrects.
 *
 * Only email permissions are returned: the checkbox asks about email, so consenting on the
 * visitor's behalf to any other channel Mailchimp offers would misrepresent what they ticked.
 */
async function emailPermissionIds(base, auth, audienceId) {
  if (cachedEmailPermissionIds !== null) return cachedEmailPermissionIds;
  try {
    const res = await fetch(
      `${base}/lists/${audienceId}/members?count=1&fields=members.marketing_permissions`,
      { headers: { Authorization: auth } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const permissions =
      (json.members && json.members[0] && json.members[0].marketing_permissions) || [];
    const ids = permissions
      .filter((p) => /e-?mail/i.test(p.text || ''))
      .map((p) => p.marketing_permission_id);
    cachedEmailPermissionIds = ids;
    return ids;
  } catch (err) {
    console.error('Could not read marketing permissions:', err);
    return [];
  }
}

/**
 * A contact the PUT just created carries a created_at within seconds of now. Used to skip the
 * "do they already have a consent note?" lookup on the common path — a first-time signup
 * cannot have one. If the field is missing or unparseable we fall through to the lookup,
 * which is correct, just one call slower.
 */
function wasJustCreated(member) {
  const created = Date.parse(member.created_at || '');
  return Number.isFinite(created) && Date.now() - created < 2 * 60 * 1000;
}

/**
 * Whether a consent note is already on file. On a failed lookup this returns false, so we
 * write a second note rather than risk leaving a re-consent unrecorded — a duplicate note is
 * the cheaper mistake.
 */
async function hasConsentNote(base, auth, audienceId, hash) {
  try {
    const res = await fetch(
      `${base}/lists/${audienceId}/members/${hash}/notes?count=100&fields=notes.note`,
      { headers: { Authorization: auth } }
    );
    if (!res.ok) return false;
    const json = await res.json();
    return (json.notes || []).some(
      (n) => typeof n.note === 'string' && n.note.startsWith(CONSENT_NOTE_PREFIX)
    );
  } catch (err) {
    console.error('Could not read existing notes:', err);
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  if (isDisallowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }

  const ip = clientIp(req);

  const retryAfter = hitRateLimit(ip);
  if (retryAfter) {
    console.error('Rate limit hit for', ip);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: `Too many signups from this connection. Please wait a moment, or email ${CONTACT_EMAIL}.`,
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // Honeypot: bots fill this hidden field, humans never see it. Look successful, do nothing.
  if (clean(body.company, 100)) {
    return res.status(200).json({ ok: true });
  }

  const email = clean(body.email, 200).toLowerCase();
  const firstName = clean(body.firstName, 100);
  const lastName = clean(body.lastName, 100);
  const role = ROLES.includes(clean(body.role, 100)) ? clean(body.role, 100) : 'Other';

  if (!looksLikeEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  // Enforced here as well as in the browser: without this check, anyone POSTing straight to
  // the endpoint would be subscribed with no consent, and the audit trail below would be a lie.
  if (body.consent !== true) {
    return res.status(400).json({
      ok: false,
      error: 'Please tick the box to confirm you’d like to receive email from us.',
    });
  }

  const apiKey = process.env.MAILCHIMP_API_KEY;
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    console.error('Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID.');
    return res.status(500).json({
      ok: false,
      error: `Something went wrong on our end. Please email ${CONTACT_EMAIL}.`,
    });
  }

  const datacenter = apiKey.split('-')[1];
  if (!datacenter) {
    console.error('MAILCHIMP_API_KEY has no datacenter suffix (expected e.g. "...-us18").');
    return res.status(500).json({
      ok: false,
      error: `Something went wrong on our end. Please email ${CONTACT_EMAIL}.`,
    });
  }

  const base = `https://${datacenter}.api.mailchimp.com/3.0`;
  const auth = `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`;
  const hash = crypto.createHash('md5').update(email).digest('hex');

  try {
    const permissionIds = await emailPermissionIds(base, auth, audienceId);

    // PUT upserts, so a repeat submitter gets updated instead of a "Member Exists" 400.
    // `status` is deliberately omitted: only `status_if_new` is sent, so re-submitting can
    // never silently resurrect someone who previously unsubscribed.
    const payload = {
      email_address: email,
      status_if_new: NEW_MEMBER_STATUS,
      timestamp_signup: mailchimpTimestamp(new Date()),
      merge_fields: {
        FNAME: firstName,
        LNAME: lastName,
        [ROLE_MERGE_TAG]: role,
      },
    };
    if (ip) payload.ip_signup = ip;
    if (permissionIds.length) {
      payload.marketing_permissions = permissionIds.map((id) => ({
        marketing_permission_id: id,
        enabled: true,
      }));
    }

    let upsert = await fetch(`${base}/lists/${audienceId}/members/${hash}`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Mailchimp is picky about ip_signup (IPv6 in particular). A rejected IP must never cost
    // someone their signup, so drop it and retry once — timestamp and checkbox still stand.
    if (!upsert.ok && ip) {
      const detail = await upsert.clone().text();
      if (/ip_signup/i.test(detail)) {
        console.error('Mailchimp rejected ip_signup, retrying without it:', detail);
        delete payload.ip_signup;
        upsert = await fetch(`${base}/lists/${audienceId}/members/${hash}`, {
          method: 'PUT',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    }

    if (!upsert.ok) {
      const detail = await upsert.text();
      console.error('Mailchimp upsert failed:', upsert.status, detail);

      if (/compliance state/i.test(detail)) {
        return res.status(400).json({
          ok: false,
          error: `This address can't be re-added automatically. Email us at ${CONTACT_EMAIL} and we'll sort it out.`,
        });
      }
      // Only blame the address when Mailchimp actually blamed the address. 'Invalid Resource'
      // on its own is its generic 400 for any field, so matching it alone told people their
      // good email was bad when the real fault was ours.
      if (/looks fake or invalid/i.test(detail) || /"field"\s*:\s*"email_address"/i.test(detail)) {
        return res.status(400).json({
          ok: false,
          error: 'Please double-check that email address.',
        });
      }
      return res.status(502).json({
        ok: false,
        error: `We couldn't add you just now. Please try again or email ${CONTACT_EMAIL}.`,
      });
    }

    // Mailchimp decides the final status, and it does not always honor status_if_new: an
    // audience with double opt-in switched on creates the contact as 'pending' regardless.
    // (list.double_optin in the API reports false even then, so it cannot be trusted.) Read
    // the status back off the response rather than assuming NEW_MEMBER_STATUS held.
    const member = await upsert.json().catch(() => ({}));
    let memberStatus = member.status || '';

    // 'unsubscribed' and 'cleaned' reach here because the PUT omits `status` on purpose, so a
    // past unsubscribe survives a re-submit. Return before the tag and note writes below:
    // re-tagging someone we are about to tell we can't add would be writing to a record we
    // just decided not to touch.
    if (memberStatus === 'unsubscribed' || memberStatus === 'cleaned') {
      return res.status(200).json({ ok: true, status: memberStatus, blocked: true });
    }

    // Mailchimp sometimes creates the contact as 'pending' even though we asked for
    // 'subscribed' and the audience reports double_optin: false. 'pending' means the contact
    // has never confirmed and has never unsubscribed, so promoting them is exactly the single
    // opt-in the consent checkbox authorizes — and it is the only status we promote, which is
    // what keeps a past 'unsubscribed' or 'cleaned' untouched.
    if (memberStatus === 'pending') {
      const promote = await fetch(`${base}/lists/${audienceId}/members/${hash}`, {
        method: 'PATCH',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'subscribed' }),
      });
      if (promote.ok) {
        const promoted = await promote.json().catch(() => ({}));
        memberStatus = promoted.status || memberStatus;
      } else {
        // Not fatal: they are on the list as pending and Mailchimp will have sent them a
        // confirmation link, so the browser is told to expect it rather than told they're in.
        console.error('Could not promote pending to subscribed:', promote.status, await promote.text());
      }
    }

    // Tags passed in a PUT body are only honored when the member is created, so repeat
    // submitters need this separate call to stay tagged correctly.
    //
    // Every role is sent every time — the chosen one active, the rest inactive — because tags
    // are additive: someone who first signed up as "Parent of Skater" and later re-submits as
    // "Coach" would otherwise carry both forever and be double-counted in any segment.
    // Deactivating a tag the member does not have is a no-op.
    const tagged = await fetch(`${base}/lists/${audienceId}/members/${hash}/tags`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: [
          { name: 'early-tester', status: 'active' },
          ...ROLES.map((name) => ({ name, status: name === role ? 'active' : 'inactive' })),
        ],
      }),
    });

    // Tagging is a nice-to-have; the signup itself already succeeded, so don't fail on it.
    if (!tagged.ok) {
      console.error('Mailchimp tagging failed:', tagged.status, await tagged.text());
    }

    // Records the exact wording consented to, which ip/timestamp alone can't show. Written
    // once per contact, not once per submission — but keyed on the note actually being on
    // file rather than on this being a new contact, so an imported contact with no consent
    // evidence still gets a real record the first time they fill the form in themselves.
    // Best effort: a missing note is not a reason to tell someone their signup failed.
    const needsNote =
      wasJustCreated(member) || !(await hasConsentNote(base, auth, audienceId, hash));

    if (needsNote) {
      const noted = await fetch(`${base}/lists/${audienceId}/members/${hash}/notes`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: `${CONSENT_NOTE_PREFIX} "${CONSENT_TEXT}"`.slice(0, 1000),
        }),
      });
      if (!noted.ok) {
        console.error('Mailchimp note failed:', noted.status, await noted.text());
      }
    }

    return res.status(200).json({ ok: true, status: memberStatus, pending: memberStatus === 'pending' });
  } catch (err) {
    console.error('Mailchimp request threw:', err);
    return res.status(502).json({
      ok: false,
      error: `We couldn't add you just now. Please try again or email ${CONTACT_EMAIL}.`,
    });
  }
};
