# Go Figure — Website

The marketing site for [Go Figure](https://gofigureapp.io), an iOS reference app for
figure skaters. Plain HTML, CSS, and one serverless function — no build step, no
framework. Deployed on Vercel.

The iOS app itself lives in a separate repository.

## ⚠️ This repository is public, and most of it is served

There is no build step. Vercel skips a known set of root-level files — `README.md`,
`package.json`, lockfiles, `vercel.json`, dotfiles — and compiles `api/` into functions
rather than serving the source. **Everything else is served verbatim**, including
arbitrary files in subdirectories.

That exclusion list is implicit and easy to over-trust. It is why `README.md` is not
downloadable but `context/business-overview.md` was, at
`gofigureapp.io/context/business-overview.md`, until it was removed. Adding a directory
nobody thought about publishes its contents with no warning and no signal.

Before adding a file, ask whether you would publish it on the website. If the answer is
no, it belongs in the private app repository or in Notion — not here. That includes:

- business, strategy, and roadmap documents
- security notes, audits, and anything describing an unfixed weakness
- infrastructure details, architecture notes, and internal runbooks
- anything about the iOS app or its Supabase backend

Secrets never belong in any repository. `.env*` is gitignored; keep Vercel's environment
variables as the source of truth and use `vercel env pull` rather than a long-lived local
copy.

## Layout

```
index.html            Landing page, including the tester signup form
privacy.html          Privacy policy      → /privacy
terms.html            Terms of service    → /terms
styles.css            All styling, including the quiz banner and overlay
assets/               Logos and imagery
quiz-config.js        Quiz copy, scoring weights, results and Mailchimp tags
quiz.js               Quiz banner + overlay UI, injected into every page
api/subscribe.js      POST /api/subscribe   — tester signups (see below)
api/quiz-submit.js    POST /api/quiz-submit — quiz results (see below)
api/_mailchimp.js     Shared request/Mailchimp helpers. NOT a route, NOT served —
                      see the note on the underscore below.
vercel.json           cleanUrls, so /privacy serves privacy.html
```

`api/_mailchimp.js` is inside `api/` and underscore-prefixed on purpose. Vercel compiles
`api/` rather than serving it, and skips underscore-prefixed files when creating functions
— so the file ships inside the function bundle without being routed or published. The same
helpers at `lib/mailchimp.js` were downloadable at `gofigureapp.io/lib/mailchimp.js`, which
is precisely the trap described above.

Run `npx vercel build` and look at `.vercel/output/` to see exactly what is served: files
under `static/` are public, `functions/` are compiled. Worth doing before adding any file
you are unsure about.

## Skating-parent quiz

A slim sticky banner on every page opens a full-screen, two-question quiz that scores the
visitor into one of six parent archetypes, collects an email, and tags the contact in
Mailchimp so an automation can follow up. Most traffic arrives by QR code at a rink, so
`?quiz=open` on any URL skips the banner and opens the quiz immediately — that is what the
printed codes link to.

**All copy lives in `quiz-config.js`.** Questions, answers, point weights, result titles and
descriptions, tie-break order and Mailchimp tags are one exported object. Editing copy, adding
a question or adding an archetype needs no changes to `quiz.js` or `api/quiz-submit.js`; the
progress indicator, scoring and tie-break all read the arrays. The file validates itself on
load and logs any problem to the console — a weight pointing at a deleted archetype, a result
missing from the tie-break, a duplicated option id.

The browser scores locally only so it can show a result instantly. `api/quiz-submit.js`
**re-scores the submitted answers server-side** and applies the tag it computed, so a crafted
POST cannot pick its own archetype or trigger an arbitrary automation.

Banner dismissal is stored in `sessionStorage`, so it returns on the next visit — a QR
scanner should not be able to hide it permanently by accident.

### Repeat takers

Someone retaking the quiz is not a duplicate signup. Their email is remembered in
`localStorage` after a successful save, so a retake skips the form and records the new result
silently; a "use a different email" link clears it for shared phones. In Mailchimp:

| What | Where | Behaviour |
| --- | --- | --- |
| Every archetype they have ever landed on | tags | Accumulates. Result tags are never deactivated, unlike the mutually-exclusive role tags in `subscribe.js`. |
| Their current archetype | `QUIZLAST` | Overwritten each run. Segment on this for "whatever they are now". |
| How many times they have played | `QUIZCOUNT` | Read back and incremented per run. |
| Ordered history | `QUIZHIST` | e.g. `coach,zen,coach`, newest last, trimmed to fit. |
| Which quiz version they took | `QUIZVER` | From `QUIZ.version` in `quiz-config.js`. |

Create those merge fields under Audience → Settings → Audience fields and |MERGE| tags, with
these exact types (verified end-to-end against a test audience):

| Merge tag | Field type |
| --- | --- |
| `QUIZLAST` | Text |
| `QUIZCOUNT` | Number |
| `QUIZHIST` | Text |
| `QUIZVER` | Number |

They are optional. Mailchimp silently ignores merge fields an audience does not define — it
does not error and does not discard the rest of the update — so without them the contact,
tags and consent note still land; only the reporting is lost.

**The live audience does not have them yet.** Until it does, `QUIZLAST` / `QUIZCOUNT` /
`QUIZHIST` / `QUIZVER` are dropped and repeat takers are only distinguishable by their
accumulated tags.

### Contacts Mailchimp will not take back

A contact that was *permanently deleted* ("forgotten") can never be re-added through the API —
only the person themselves can re-subscribe. Mailchimp answers with
`Forgotten Email Not Subscribed ... cannot be re-imported`. The route detects that, along with
a compliance hold, and returns `blocked: true`; the quiz then shows the result with an
explanation and **no retry button**, because retrying could never succeed. Worth knowing before
you permanently delete anyone rather than archiving them.

**Design your automation around this:** Mailchimp fires a tag-based automation when a tag is
*added*, and re-adding a tag someone already has is a no-op. A repeat taker who lands on the
same archetype twice will not get that email again. If you want it to re-fire, trigger off a
`QUIZCOUNT` change rather than making the route remove-and-re-add the tag — that would also
re-fire for anyone who simply refreshes.

Quiz submissions are rate limited to 30 per IP per 10 minutes, deliberately looser than the
signup limit: a QR code at a rink means many parents submitting from one shared connection.

### Testing on a preview deployment

Both routes reject requests whose `Origin` is not gofigureapp.io or localhost. A preview
deployment is served from a generated hostname, so that check would 403 every submission and
make previews untestable. `api/_mailchimp.js` therefore also accepts the deployment's own
hostnames — read from Vercel's `VERCEL_URL` and `VERCEL_BRANCH_URL`, and only when
`VERCEL_ENV` is `preview`. It is deliberately not a `*.vercel.app` wildcard, which would let
any Vercel-hosted site post here.

`api/subscribe.js` keeps its own older copy of the origin check and does **not** have this,
so the tester signup form still 403s on preview deployments. Worth knowing if you test that
form on a preview URL; production is unaffected.

## Tester signup

The form in `index.html` posts to `api/subscribe.js`, which adds the contact to the Go
Figure Mailchimp audience as a single opt-in subscriber.

Single opt-in is only defensible because of what surrounds it, so take care when changing
any of this:

- The consent checkbox ships **unchecked** and is enforced **server-side** — posting
  directly to the endpoint without it is rejected.
- Consent evidence is recorded on the contact: signup IP, timestamp, and a note quoting
  the exact checkbox wording. `CONSENT_TEXT` in `api/subscribe.js` must stay in sync with
  the copy in `index.html`.
- The upsert sends `status_if_new` and never `status`, so re-submitting can never
  resurrect someone who previously unsubscribed.
- The final status is read back from Mailchimp's response rather than assumed, so the
  page never tells someone they are subscribed when they are not.

Signups are rate limited to 10 per IP per 10 minutes. The limiter is in-memory, so it is
per-container and resets on cold start — it raises the cost of casual abuse but is not a
defense against a distributed attacker. `hitRateLimit` is isolated so a shared store
(Vercel KV, Upstash) can replace it without touching the handler.

### Environment variables

Set in Vercel → Settings → Environment Variables:

| Variable | Notes |
| --- | --- |
| `MAILCHIMP_API_KEY` | The `-us18` style suffix is the datacenter; the code parses it out. |
| `MAILCHIMP_AUDIENCE_ID` | Audience → Settings → Audience name and defaults. |

Both routes read the same two variables. The quiz did not add any configuration.

Mailchimp API keys are unscoped — one key can read and export the entire audience. Treat
it accordingly.

## Local development

```bash
npm install
npm start        # vercel dev, so /api/subscribe and /api/quiz-submit work locally
```

The script is deliberately **not** called `dev`. With no Development Command set in the
project settings, `vercel dev` runs `package.json`'s `dev` script — so a `dev` script that
runs `vercel dev` makes the CLI invoke itself and it exits with
"`vercel dev` must not recursively invoke itself". Naming it `start` breaks the loop.

Opening `index.html` directly also works for pure markup and styling changes, but the signup
form and the quiz's final submit will fail because there is no function host. The quiz itself
— banner, questions, scoring, result — runs fine without one; only the Mailchimp save needs it,
and it degrades to the on-screen retry.

Add `?quiz=open` to any local URL to jump straight into the quiz the way a QR scan does.
