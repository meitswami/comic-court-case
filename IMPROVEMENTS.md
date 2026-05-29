# 🛠️ eNyayaSetu — Improvements & Bug Report

This document tracks issues identified by:
- Static analysis of the code at this commit, and
- Probing the live deployment at https://enyayasetu.vercel.app/.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low / Polish

---

## 🔴 Critical

### 🔴 Rotate exposed database and JWT credentials

The repository previously committed:

- The production **MySQL password** for `<YOUR_DB_USER_OR_NAME>@<YOUR_DB_HOST>`
  in `.env`, `.env.example`, and six `*.md` docs.
- The production **`JWT_SECRET`** used to sign every user token.

These leaks have been redacted in this PR, but anyone who cloned the
public repo before the merge has them. **Treat them as compromised.**

**Action items (manual, by the repo owner):**

1. Hostinger → *Databases → MySQL Databases* → **Change Password** for
   the affected DB user.
2. Generate a new JWT secret:

   ```bash
   openssl rand -base64 32
   ```

3. Update Vercel **Settings → Environment Variables** with the new
   values for **all** environments (Production, Preview, Development).
4. Redeploy. All existing user sessions will be invalidated by the new
   JWT secret — communicate this to active users if needed.
5. (Optional but recommended) Remove the old credentials from git
   history with `git filter-repo` or BFG Repo-Cleaner.

### 🔴 `/api/*` returned `FUNCTION_INVOCATION_FAILED` (login & register broken)

**Symptom (before this PR):**

```bash
$ curl https://enyayasetu.vercel.app/api/health
A server error has occurred
FUNCTION_INVOCATION_FAILED
```

Every backend endpoint — including `/api/auth/signup` and
`/api/auth/signin` — returned 500. **Login and registration were
completely non-functional in production.**

**Root cause:** `api/index.js` (Vercel serverless) imported
`server/routes/*.js`, which in turn imported `.ts` files in `src/`.
Vercel's `@vercel/node@3` runtime doesn't transpile `.ts` files
imported across directories from a `.js` entry, so the function crashed
at module load.

**Fix shipped in this PR:** plain-JS copies live under `server/lib/`:

- `server/lib/mysql.js` ← mirrors `src/integrations/mysql/client.ts`
- `server/lib/auth.js` ← mirrors `src/services/auth.ts`

All `server/routes/*.js`, `server/middleware/*.js`, `server/index.js`
and `scripts/*.js` now import from `server/lib/*.js`.

**Verify after deploy:**

```bash
curl https://enyayasetu.vercel.app/api/health
# expected: {"status":"ok",...}

curl -X POST https://enyayasetu.vercel.app/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"qa@test.com","password":"StrongPass!23"}'
# expected: { "user": {...}, "session": {...} }
```

### 🔴 SPA routing 404

**Symptom (before this PR):**

```bash
$ curl -o /dev/null -w "%{http_code}\n" https://enyayasetu.vercel.app/auth
404
$ curl -o /dev/null -w "%{http_code}\n" https://enyayasetu.vercel.app/dashboard
404
```

Every deep route returned Vercel's `NOT_FOUND` page because the SPA
rewrite was missing. This silently broke:

- Bookmarking any page other than `/`.
- Refreshing during a hearing or while filling a form.
- Email-verification links (`/auth?type=signup&...`).
- Password-reset links.
- Social shares of `/court/:sessionId` URLs.

**Fix shipped in this PR:** `vercel.json` now contains an SPA rewrite
that forwards all non-API paths to `index.html`, plus a default set of
security headers.

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

### 🔴 Email verification & password reset

Same root cause as the SPA-404 above — fixed by the same rewrite. After
this PR, walk through a real signup and a real password reset
end-to-end to confirm.

---

## 🟠 High

### 🟠 `og:image` and `og:url` use unreachable URLs

In `index.html`:

```html
<meta property="og:image" content="/src/assets/logo.png" />
<meta property="og:url"   content="https://enyayasetu.com" />
```

- `/src/assets/logo.png` only exists during `vite dev`. In production
  the asset is hashed (`/assets/logo-<hash>.png`), so previews on
  WhatsApp / Twitter / LinkedIn show a broken image.
- `https://enyayasetu.com` does not resolve.

**Fix:** put a static, non-hashed file at `public/og-image.png` and:

```html
<meta property="og:image" content="https://enyayasetu.vercel.app/og-image.png" />
<meta property="og:url"   content="https://enyayasetu.vercel.app/" />
```

### 🟠 `.env` was tracked in git

Even after credential rotation, having `.env` tracked invites future
mistakes. Fixed in this PR by:

- Adding `.env`, `.env.local`, `.env.*.local`, `.env.production`,
  `.env.development` and `.vercel` to `.gitignore`.
- `git rm --cached .env` (file remains on disk locally).

### 🟠 `.env.example` was UTF-16-LE encoded

`dotenv` only parses UTF-8. The Windows-saved `.env.example` therefore
silently failed to load on every machine. Fixed in this PR by rewriting
the file in UTF-8 with placeholder values.

### 🟠 Weak default password policy

`useAuth.signUp` does not enforce length / complexity client-side, and
the server stores anything that bcrypt accepts. For a platform handling
legal data, raise the minimum to **at least 10 characters** with a mix
of cases, digits and symbols, and surface the policy in the UI.

### 🟠 No rate limiting on auth endpoints

`/api/auth/signin` and `/api/auth/signup` accept unlimited requests.
Add per-IP rate limiting (e.g. `express-rate-limit` with a memory store
locally and Upstash Redis on Vercel). Same for `/api/authenticator/*`
to prevent TOTP brute force.

### 🟠 JWT signed with HS256 + shared secret

Acceptable for a single-monolith deployment, but if you ever introduce
a second service (mobile API, public API), switch to RS256 with a
KMS-managed key pair so verifiers don't need the signing secret.

---

## 🟡 Medium

### 🟡 `/sitemap.xml` returns 404

`robots.txt` allows crawling but no sitemap is shipped. SEO will be
poor without one. Add `public/sitemap.xml` listing the public routes
(`/`, `/auth`, `/pricing`, `/rti`).

### 🟡 PDF invoices generated client-side only

Invoices use `jsPDF` in the browser. If a user clears storage or
switches device they cannot re-download an invoice. **Fix:** generate
the PDF in `/api/invoices/*`, persist to Supabase Storage, and expose
a signed URL.

### 🟡 OCR / AI gateway calls have no usage cap

`ai_usage_logs` exists but there is no enforcement layer. A malicious
user could rack up significant Gemini / GPT-4 spend. Add per-user
daily token budgets, return 429 when exceeded.

### 🟡 Audio cues hard-coded to `cdn.freesound.org`

The frontend plays gavel / ambient sounds from preview URLs on
`cdn.freesound.org`. These are *previews* — they can change or rate
limit. Self-host the (CC-licensed) clips under `public/audio/` and
include attribution.

### 🟡 Mobile responsiveness

The hero "JUSTICE AWAITS!" CTA and the New Features cards overflow on
screens narrower than ~360 px. Audit at 320 / 360 / 414 px widths and
fix with Tailwind's `sm:` / `md:` breakpoints.

### 🟡 Accessibility

- Buttons rely on color + emoji only ("⚖️ AI-Powered Analysis"). Add
  `aria-label`s.
- Body-text contrast on the dark theme dips below 4.5:1 in places — fix
  to meet WCAG 2.1 AA.
- Form fields on `/auth` lack visible focus rings.

### 🟡 Two parallel "auth" code paths

`src/services/auth.ts` and `src/integrations/mysql/auth-client.ts`
remain alongside the new `server/lib/auth.js`. The TS files are no
longer imported by the running code (frontend uses `fetch`), so they
should either be:

- Deleted, or
- Converted to thin re-exports of `server/lib/auth.js` for type sharing.

### 🟡 Test/admin-bootstrap helpers shipped in production bundle

Production strings include "Could not login as admin.", "Login as Super
Admin", "Could not login with test account.". Gate these behind
`import.meta.env.DEV` or a feature flag, and ensure the underlying
seeded credentials only exist in non-production environments.

---

## 🟢 Low / Polish

### 🟢 Inconsistent button casing

"EXAMPLE CASES", "FILE NEW CASE", "JUSTICE AWAITS!" are all-caps; "View
Pricing & Plans" is title case. Pick one style guide.

### 🟢 No Sentry / log aggregation

There's no client-side error reporting and Vercel function logs aren't
forwarded anywhere. Wire Sentry for the React app and Logflare /
Datadog for the function.

### 🟢 README and project metadata

- `package.json` `homepage` field is unset. Add `"homepage":
  "https://enyayasetu.vercel.app"`.
- The GitHub repo description and topics are empty. Suggested topics:
  `legal-tech` · `ai-judge` · `virtual-courtroom` · `indian-law` ·
  `mysql` · `react` · `vite` · `vercel`.

### 🟢 Type safety on database calls

The `query()` helper returns `any`. Generate per-table TS types (or
move to Drizzle / Kysely) so each `.from("cases")` call is typed.

### 🟢 Move `src/services/auth.ts` and `src/integrations/mysql/client.ts` out

Now that the canonical implementations live in `server/lib/*.js`, the
TS twins are dead weight. Remove them in a follow-up once nothing
imports them.

### 🟢 Add a build-time secret scan

A pre-commit hook (or a simple CI step) using `gitleaks` or
`detect-secrets` would have caught the leaked `.env`. Add one.

---

## ✅ Manual QA checklist (run after this PR is deployed)

- [ ] Rotate DB password and `JWT_SECRET` in Hostinger and Vercel.
- [ ] `/auth`, `/dashboard`, `/court`, `/rti`, `/pricing`, `/admin`,
      `/PASSWORD_RECOVERY` all return **200** when accessed directly.
- [ ] Sign up with a fresh email → click confirmation link → land on
      `/dashboard` (not 404).
- [ ] Forgot password → email link → set new password → log in.
- [ ] Login with wrong credentials shows the friendly error, not a stack
      trace.
- [ ] Wallet top-up → invoice PDF → still downloadable from
      `/dashboard` after a hard refresh.
- [ ] File a case → upload PDF → OCR text appears in case detail.
- [ ] Start a hearing → AI judge speaks (TTS), audio cues play.
- [ ] Hand-raise + witness request actions persist in DB.
- [ ] RTI tutorial loads (no "Could not load tutorial" toast).
- [ ] Admin can create / disable a promo code; promo redeems on a payment.
- [ ] Lighthouse on `/`: Performance ≥ 80, Accessibility ≥ 90, SEO = 100.
- [ ] `curl https://enyayasetu.vercel.app/api/health` returns 200 JSON.
