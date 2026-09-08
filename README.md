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
index.html          Landing page, including the tester signup form
privacy.html        Privacy policy      → /privacy
terms.html          Terms of service    → /terms
styles.css          All styling
assets/             Logos and imagery
api/subscribe.js    POST /api/subscribe — tester signups (see below)
vercel.json         cleanUrls, so /privacy serves privacy.html
```

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

Mailchimp API keys are unscoped — one key can read and export the entire audience. Treat
it accordingly.

## Local development

```bash
npm install
npm run dev      # vercel dev, so /api/subscribe works locally
```

Opening `index.html` directly also works for pure markup and styling changes, but the
signup form will fail because there is no function host.
