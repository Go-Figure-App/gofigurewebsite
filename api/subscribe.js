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
 */
const NEW_MEMBER_STATUS = 'subscribed';

/**
 * The exact consent wording shown next to the checkbox. Kept here so the server records
 * what was actually agreed to; if you change the form copy, change this to match.
 */
const CONSENT_TEXT =
  'Yes, email me about Go Figure tester access and product updates. I can unsubscribe anytime.';

/** Must match the dropdown choices in Mailchimp exactly, or the value is rejected. */
const ROLES = ['Coach', 'Parent of Skater', 'Adult Skater (18+)', 'Other'];

const CONTACT_EMAIL = 'contact@gofigureapp.io';

/** Cached per warm container so we do the discovery GET once per cold start, not per signup. */
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
 * Marketing-permission IDs are per-audience GUIDs that only exist once GDPR fields are
 * switched on, and there is no endpoint that lists them — they show up on member records.
 * So read them off any member. Returns [] when GDPR fields are off, which makes this a
 * no-op until the audience setting is flipped (no redeploy needed).
 *
 * Only email permissions are returned: the checkbox asks about email, so consenting on the
 * visitor's behalf to any other channel Mailchimp offers would misrepresent what they ticked.
 */
async function emailPermissionIds(base, auth, audienceId) {
  if (cachedEmailPermissionIds) return cachedEmailPermissionIds;
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
    if (ids.length) cachedEmailPermissionIds = ids;
    return ids;
  } catch (err) {
    console.error('Could not read marketing permissions:', err);
    return [];
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
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
  const ip = clientIp(req);

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

    // Tags passed in a PUT body are only honored when the member is created, so repeat
    // submitters need this separate call to stay tagged correctly.
    const tagged = await fetch(`${base}/lists/${audienceId}/members/${hash}/tags`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tags: [
          { name: 'early-tester', status: 'active' },
          { name: role, status: 'active' },
        ],
      }),
    });

    // Tagging is a nice-to-have; the signup itself already succeeded, so don't fail on it.
    if (!tagged.ok) {
      console.error('Mailchimp tagging failed:', tagged.status, await tagged.text());
    }

    // Records the exact wording consented to, which ip/timestamp alone can't show. Best
    // effort: a missing note is not a reason to tell someone their signup failed.
    const noted = await fetch(`${base}/lists/${audienceId}/members/${hash}/notes`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: `Consent via gofigureapp.io tester form: "${CONSENT_TEXT}"`.slice(0, 1000),
      }),
    });
    if (!noted.ok) {
      console.error('Mailchimp note failed:', noted.status, await noted.text());
    }

    return res.status(200).json({ ok: true, pending: NEW_MEMBER_STATUS === 'pending' });
  } catch (err) {
    console.error('Mailchimp request threw:', err);
    return res.status(502).json({
      ok: false,
      error: `We couldn't add you just now. Please try again or email ${CONTACT_EMAIL}.`,
    });
  }
};
