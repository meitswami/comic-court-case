# Vercel 500 Error - Troubleshooting

> **NOTE:** Earlier versions of this file contained real database
> credentials. Those credentials must be rotated immediately on Hostinger
> and a new `JWT_SECRET` generated. See
> [SECURITY: Rotate exposed credentials](./IMPROVEMENTS.md#-rotate-exposed-database-and-jwt-credentials)
> for the full action list.

## Root Cause (fixed in this PR)

Every `/api/*` request returned `FUNCTION_INVOCATION_FAILED` because
`api/index.js` (run by Vercel's `@vercel/node@3` runtime) imported
`server/routes/*.js`, which in turn imported TypeScript files
(`src/services/auth.ts`, `src/integrations/mysql/client.ts`).

The Node serverless runtime **cannot resolve `.ts` imports across
directories**, so the function crashed at module load.

**Fix:** plain-JS copies live in `server/lib/`:

- `server/lib/mysql.js` (mirrors `src/integrations/mysql/client.ts`)
- `server/lib/auth.js` (mirrors `src/services/auth.ts`)

All server-side code (`server/routes/*.js`, `server/middleware/*.js`,
`server/index.js`, `scripts/*.js`) now imports from `server/lib/*.js`.

After deploying this PR you should see:

```bash
$ curl https://enyayasetu.vercel.app/api/health
{"status":"ok","timestamp":"..."}

$ curl -o /dev/null -w "%{http_code}\n" https://enyayasetu.vercel.app/auth
200
```

## Other Things to Verify on Vercel

### 1. All environment variables are set

Vercel Dashboard → your project → **Settings → Environment Variables**.
Every key from `.env.example` must be present (using **your own**, freshly
rotated values):

- `DB_HOST`
- `DB_PORT` (`3306`)
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET` (generate with `openssl rand -base64 32`)
- `JWT_EXPIRES_IN` (`7d`)
- `API_PORT` (`3000`)
- `NODE_ENV` (`production`)

### 2. Hostinger MySQL allows remote connections

Vercel egress IPs are dynamic. In Hostinger's hPanel:

1. Open **Databases → Remote MySQL**.
2. Add the wildcard host `%` (or a list of Vercel IP ranges) for the
   database user.
3. Confirm SSL is enabled — `server/lib/mysql.js` already passes
   `ssl: { rejectUnauthorized: false }` for `*.hstgr.io` hosts.

### 3. Check function logs

Vercel Dashboard → **Functions** tab → `api/index.js` → **Logs**.

Common errors after this PR is merged:

| Log line                                              | Meaning                              |
| ----------------------------------------------------- | ------------------------------------ |
| `ECONNREFUSED` / `ENOTFOUND`                          | DB host unreachable / wrong          |
| `ER_ACCESS_DENIED_ERROR`                              | DB user / password wrong             |
| `ER_DBACCESS_DENIED_ERROR`                            | DB user lacks privileges on the DB   |
| `JWT_SECRET is not set`                               | Missing env var                      |
| `Cannot find module '../../src/...'`                  | Should not happen after this PR      |

### 4. Quick endpoint tests

```bash
# Health
curl https://enyayasetu.vercel.app/api/health

# Env presence (booleans only - safe)
curl https://enyayasetu.vercel.app/api/test-env

# Sign up
curl -X POST https://enyayasetu.vercel.app/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"StrongPass!23"}'

# Sign in
curl -X POST https://enyayasetu.vercel.app/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"StrongPass!23"}'
```

If `/api/test-env` reports any variable as `NOT SET`, fix that in Vercel
**before** debugging anything else.
