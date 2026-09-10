/**
 * POST /api/quiz-submit — records a "What type of skating coach or parent are you?" result in
 * Mailchimp.
 *
 * Same single opt-in posture as api/subscribe.js: contacts are created as 'subscribed' with no
 * confirmation email, which is only defensible because the quiz form carries an explicit,
 * unchecked consent checkbox (enforced server-side below) and we store the evidence Mailchimp
 * accepts — ip_signup + timestamp_signup, plus a note quoting the exact wording agreed to.
 *
 * The archetype is RECOMPUTED here from the submitted answers using the shared quiz-config.js.
 * The browser's own result is never trusted, so nobody can POST themselves an arbitrary tag and
 * fire an automation they were not scored into.
 *
 * ── Repeat takers ────────────────────────────────────────────────────────────────────────────
 * The brief: the FIRST completed attempt is someone's true type and is the only one that emails
 * a result. Retakes are logged for our own information — count and history — but never tag a
 * new archetype and never fire a second automation.
 *
 *   result tag    added ONLY on a first attempt (see isFirstAttempt below). A retake that lands
 *                 on a different archetype does NOT get that archetype's tag, specifically so it
 *                 cannot fire that automation. A contact only ever holds one result tag.
 *   quiz-taken    added on every attempt, including retakes. This is also the FIRST-ATTEMPT
 *                 SIGNAL: whether a contact already has it is how isFirstAttempt is decided, so
 *                 it must never gate an automation of its own — it exists purely to remember
 *                 "already sent a result email", and Mailchimp's tag automations only fire on a
 *                 tag actually being added, so a repeat retake (already carrying the tag) is a
 *                 no-op re-add.
 *   QUIZTYPE      the archetype from the first attempt. Set once and never overwritten by a
 *                 retake — this is "their true type" for segmenting.
 *   QUIZCOUNT     how many times they have taken it, read back and incremented per run.
 *   QUIZHIST      the ordered history, e.g. "coach,zen,coach", newest last — every attempt,
 *                 including retakes, so nothing about what they explored is lost.
 *
 * isFirstAttempt is read from whether the contact already carries the quiz-taken TAG, not from
 * a merge field — tags always exist with no Audience configuration, so the one-email guarantee
 * holds even before QUIZTYPE/QUIZCOUNT/QUIZHIST are set up in Mailchimp.
 *
 * The merge fields are optional: create QUIZTYPE / QUIZCOUNT / QUIZHIST / QUIZVER in
 * Audience → Settings → Audience fields and |MERGE| tags to get this data. If they do not
 * exist, the upsert below quietly retries without them and tagging still works.
 *
 * Env vars — the SAME ones the tester signup already uses. Nothing new to configure:
 *   MAILCHIMP_API_KEY      e.g. abc123...def-us18   (the -us18 suffix is the datacenter)
 *   MAILCHIMP_AUDIENCE_ID  e.g. f1542cb5bf
 */

const {
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
} = require('./_mailchimp');

const quiz = require('../quiz-config');

/** Mailchimp *merge tags* — the |TAG| on the right in Audience fields, not the field label. */
const MERGE_FIRST_NAME = 'FNAME';
const MERGE_LAST_NAME = 'LNAME';
const MERGE_ROLE = 'ROLE';
const MERGE_QUIZ_TYPE = 'QUIZTYPE';
const MERGE_QUIZ_COUNT = 'QUIZCOUNT';
const MERGE_QUIZ_HISTORY = 'QUIZHIST';
const MERGE_QUIZ_VERSION = 'QUIZVER';

/** Applied to everyone who finishes, so "has taken the quiz" is one segment. */
const TAKEN_TAG = 'quiz-taken';

/**
 * The quiz's first question ("I am a: Parent / Coach") tells us which the taker is, so a
 * brand-new contact is labelled from that answer's branch. But an existing contact who takes
 * the quiz for the other role must not be relabelled, so this is only written when the contact
 * has no role on file. See applyRole below.
 */
const IMPLIED_ROLE_BY_FLOW = {
  parent: 'Parent of Skater',
  coach: 'Coach',
};

/** Must match the dropdown choices in Mailchimp exactly, or the value is rejected. */
const KNOWN_ROLES = ['Coach', 'Parent of Skater', 'Adult Skater (18+)', 'Other'];

/** Stable prefix so we can recognize a consent note we already wrote and not duplicate it. */
const CONSENT_NOTE_PREFIX = 'Consent via gofigureapp.io skating-parent quiz:';

/** Mailchimp text merge fields hold 255 characters; leave headroom for the separator. */
const HISTORY_MAX_CHARS = 250;

/**
 * Deliberately looser than the signup limit: a QR code at a rink means many people submitting
 * from one venue's shared IP in a short window, and rate-limiting a real queue of parents would
 * be worse than the abuse it prevents. Still low enough to make bulk list-stuffing tedious.
 * Every request counts, including honeypot hits and validation failures, so probing is not free.
 */
const hitRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });

/** Cached per warm container. null until a lookup succeeds; then an array, possibly empty. */
let cachedEmailPermissionIds = null;

/**
 * Marketing-permission IDs are per-audience GUIDs that only exist once GDPR fields are switched
 * on, and no endpoint lists them — they appear on member records, so read them off any member.
 * A successful lookup is cached even when it finds nothing, since re-asking every submission
 * costs a round trip for an answer that does not change. Failed lookups are not cached, so a
 * blip self-corrects. Only email permissions are returned: the checkbox asks about email, so
 * consenting on the visitor's behalf to any other channel would misrepresent what they ticked.
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
 * Whether a consent note is already on file. On a failed lookup this returns false, so we write
 * a second note rather than risk leaving a re-consent unrecorded — a duplicate note is the
 * cheaper mistake.
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

/**
 * Builds Mailchimp's name merge fields from the form's separate first/last inputs. Only sets a
 * key that actually has a value, so an empty field never blanks out a name already on file.
 */
function nameFields(firstName, lastName) {
  const fields = {};
  if (firstName) fields[MERGE_FIRST_NAME] = firstName;
  if (lastName) fields[MERGE_LAST_NAME] = lastName;
  return fields;
}

/**
 * Appends the new archetype to the history, trimming the OLDEST entries when the field would
 * overflow. Losing ancient history is preferable to Mailchimp rejecting the whole update.
 */
function appendHistory(existing, resultId) {
  const entries = String(existing || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  entries.push(resultId);

  while (entries.length > 1 && entries.join(',').length > HISTORY_MAX_CHARS) {
    entries.shift();
  }
  return entries.join(',').slice(0, HISTORY_MAX_CHARS);
}

/** Mailchimp returns merge fields as strings; a first-timer has no count at all. */
function nextCount(existing) {
  const current = parseInt(existing, 10);
  return (Number.isFinite(current) && current > 0 ? current : 0) + 1;
}

/**
 * Only claims the contact as the role their quiz answer implies when Mailchimp has no role for
 * them. An existing Coach, Parent, or Adult Skater keeps the role they chose; a contact with a
 * blank or unrecognized role gets the one the quiz's "I am a:" answer implies.
 */
function applyRole(existingMergeFields, impliedRole) {
  const current = clean((existingMergeFields || {})[MERGE_ROLE], 100);
  if (KNOWN_ROLES.includes(current)) return {};
  return impliedRole ? { [MERGE_ROLE]: impliedRole } : {};
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
    console.error('Quiz rate limit hit for', ip);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: `Too many submissions from this connection. Please wait a moment, or email ${CONTACT_EMAIL}.`,
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
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => clean(a, 60)) : [];

  if (!looksLikeEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  // Enforced here as well as in the browser: without this check, anyone POSTing straight to the
  // endpoint would be subscribed with no consent, and the consent note below would be a lie.
  if (body.consent !== true) {
    return res.status(400).json({
      ok: false,
      error: 'Please tick the box to confirm you’d like to receive email from us.',
    });
  }

  // Scored server-side from the answer ids, never read off the request. A submission whose
  // answers don't line up with the current quiz-config is rejected rather than guessed at.
  if (!quiz.answersAreWellFormed(answers)) {
    return res.status(400).json({ ok: false, error: 'That quiz submission looks incomplete.' });
  }

  const result = quiz.score(answers);
  if (!result) {
    console.error('Well-formed answers scored to nothing:', answers);
    return res.status(400).json({ ok: false, error: 'That quiz submission looks incomplete.' });
  }

  const config = credentials();
  if (!config.ok) {
    return res.status(500).json({
      ok: false,
      error: `Something went wrong on our end. Please email ${CONTACT_EMAIL}.`,
    });
  }

  const { base, auth, audienceId } = config;
  const hash = subscriberHash(email);

  try {
    const [permissionIds, existing] = await Promise.all([
      emailPermissionIds(base, auth, audienceId),
      // Read before write so the run count increments instead of resetting, and so we can tell
      // an established contact's role apart from a blank one.
      getMember(config, hash, 'merge_fields,status,created_at,tags'),
    ]);

    const existingMerge = (existing && existing.merge_fields) || {};

    // The one thing that decides whether this run emails a result. Based on the quiz-taken TAG,
    // not a merge field, so it holds even before QUIZTYPE/QUIZCOUNT/QUIZHIST exist in the
    // Audience — see the "Repeat takers" note at the top of this file.
    const isFirstAttempt = !(
      existing &&
      Array.isArray(existing.tags) &&
      existing.tags.some((t) => t.name === TAKEN_TAG)
    );

    // Split into two objects so a Mailchimp audience without the quiz merge fields can still
    // record the signup: if the upsert complains, we retry with `baseMerge` only.
    const baseMerge = Object.assign(
      {},
      nameFields(firstName, lastName),
      applyRole(existingMerge, IMPLIED_ROLE_BY_FLOW[result.flow])
    );

    const quizMerge = {
      [MERGE_QUIZ_COUNT]: nextCount(existingMerge[MERGE_QUIZ_COUNT]),
      [MERGE_QUIZ_HISTORY]: appendHistory(existingMerge[MERGE_QUIZ_HISTORY], result.id),
      [MERGE_QUIZ_VERSION]: quiz.QUIZ.version,
    };
    // Locked in on the first attempt only — a retake must never overwrite someone's true type.
    if (isFirstAttempt) quizMerge[MERGE_QUIZ_TYPE] = result.id;

    // PUT upserts, so a repeat taker gets updated instead of a "Member Exists" 400.
    // `status` is deliberately omitted: only `status_if_new` is sent, so retaking the quiz can
    // never silently resurrect someone who previously unsubscribed.
    const payload = {
      email_address: email,
      status_if_new: 'subscribed',
      timestamp_signup: mailchimpTimestamp(new Date()),
      merge_fields: Object.assign({}, baseMerge, quizMerge),
    };
    if (ip) payload.ip_signup = ip;
    if (permissionIds.length) {
      payload.marketing_permissions = permissionIds.map((id) => ({
        marketing_permission_id: id,
        enabled: true,
      }));
    }

    const put = () =>
      fetch(`${base}/lists/${audienceId}/members/${hash}`, {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    let upsert = await put();

    // Mailchimp is picky about ip_signup (IPv6 in particular). A rejected IP must never cost
    // someone their result, so drop it and retry once — timestamp and checkbox still stand.
    if (!upsert.ok && ip) {
      const detail = await upsert.clone().text();
      if (/ip_signup/i.test(detail)) {
        console.error('Mailchimp rejected ip_signup, retrying without it:', detail);
        delete payload.ip_signup;
        upsert = await put();
      }
    }

    // The quiz merge fields are optional extras. If the audience does not have them — or one is
    // configured as a type that rejects our value — fall back to a plain upsert so the contact
    // and their tag still land. The tag is what triggers the automation; the merge fields are
    // reporting.
    if (!upsert.ok) {
      const detail = await upsert.clone().text();
      if (/merge/i.test(detail)) {
        console.error(
          'Mailchimp rejected the quiz merge fields, retrying without them. ' +
            'Create QUIZTYPE/QUIZCOUNT/QUIZHIST/QUIZVER in the audience to capture this data:',
          detail
        );
        payload.merge_fields = baseMerge;
        upsert = await put();
      }
    }

    if (!upsert.ok) {
      const detail = await upsert.text();
      console.error('Mailchimp quiz upsert failed:', upsert.status, detail);

      // Mailchimp blocks both of these permanently, so "try again" would be a lie: a compliance
      // hold, and an address that was permanently deleted ("forgotten"), which the API can
      // never re-add — only the person themselves can re-subscribe. Say so instead of offering
      // a retry that is guaranteed to fail. Seen for real: a deleted test address returned
      // "Forgotten Email Not Subscribed ... cannot be re-imported".
      if (/compliance state/i.test(detail) || /forgotten email/i.test(detail) || /cannot be re-imported/i.test(detail)) {
        return res.status(400).json({
          ok: false,
          error: `This address can't be re-added automatically. Email us at ${CONTACT_EMAIL} and we'll sort it out.`,
          blocked: true,
        });
      }
      // Only blame the address when Mailchimp actually blamed the address. 'Invalid Resource' on
      // its own is its generic 400 for any field.
      if (/looks fake or invalid/i.test(detail) || /"field"\s*:\s*"email_address"/i.test(detail)) {
        return res.status(400).json({ ok: false, error: 'Please double-check that email address.' });
      }
      return res.status(502).json({
        ok: false,
        error: `We couldn't save your result just now. Please try again or email ${CONTACT_EMAIL}.`,
      });
    }

    // Mailchimp decides the final status and does not always honor status_if_new: an audience
    // with double opt-in switched on creates the contact as 'pending' regardless, and
    // list.double_optin reports false even then. Read it back rather than assuming.
    const member = await upsert.json().catch(() => ({}));
    let memberStatus = member.status || '';

    // 'unsubscribed' and 'cleaned' reach here because the PUT omits `status` on purpose, so a
    // past unsubscribe survives a retake. Return before the tag and note writes: re-tagging
    // someone we are about to tell we can't add would be writing to a record we just decided
    // not to touch. The browser still shows them their result — it just isn't emailed.
    if (memberStatus === 'unsubscribed' || memberStatus === 'cleaned') {
      return res.status(200).json({
        ok: true,
        status: memberStatus,
        blocked: true,
        resultId: result.id,
      });
    }

    // 'pending' means the contact has never confirmed and has never unsubscribed, so promoting
    // them is exactly the single opt-in the consent checkbox authorizes — and it is the only
    // status we promote, which is what keeps a past 'unsubscribed' or 'cleaned' untouched.
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
        // Not fatal: they are on the list as pending and Mailchimp will have sent a confirmation
        // link, so the browser is told to expect it rather than told they're in.
        console.error(
          'Could not promote pending to subscribed:',
          promote.status,
          await promote.text()
        );
      }
    }

    // Tags in a PUT body are only honored when the member is created, so this separate call is
    // what tags a repeat taker at all. The result tag is added ONLY on a first attempt — that is
    // what stops a retake into a different archetype from firing that automation too. quiz-taken
    // is added every time, which is a no-op re-add on a retake (it is already active).
    const tags = [{ name: TAKEN_TAG, status: 'active' }];
    if (isFirstAttempt) tags.push({ name: result.tag, status: 'active' });

    const tagged = await fetch(`${base}/lists/${audienceId}/members/${hash}/tags`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    });

    // Tagging drives the automation, so a failure here matters more than it does on the signup
    // form — but the contact IS saved, and telling them their result failed would be wrong.
    // Logged loudly, and reported to the browser so it can offer a retry.
    let tagFailed = false;
    if (!tagged.ok) {
      tagFailed = true;
      console.error('Mailchimp quiz tagging failed:', tagged.status, await tagged.text());
    }

    // Records the exact wording consented to, which ip/timestamp alone can't show. Written once
    // per contact, not once per submission — keyed on the note actually being on file, so a
    // contact imported without consent evidence still gets a real record the first time they
    // opt in here. Best effort: a missing note is not a reason to fail someone's result.
    if (!existing || !(await hasConsentNote(base, auth, audienceId, hash))) {
      const noted = await fetch(`${base}/lists/${audienceId}/members/${hash}/notes`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: `${CONSENT_NOTE_PREFIX} "${quiz.QUIZ.form.consentText}"`.slice(0, 1000),
        }),
      });
      if (!noted.ok) {
        console.error('Mailchimp quiz note failed:', noted.status, await noted.text());
      }
    }

    return res.status(200).json({
      ok: true,
      status: memberStatus,
      pending: memberStatus === 'pending',
      tagFailed,
      resultId: result.id,
    });
  } catch (err) {
    console.error('Mailchimp quiz request threw:', err);
    return res.status(502).json({
      ok: false,
      error: `We couldn't save your result just now. Please try again or email ${CONTACT_EMAIL}.`,
    });
  }
};
