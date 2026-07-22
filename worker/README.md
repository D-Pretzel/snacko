# Snacko menu editor Worker

This Worker is the only thing that holds the GitHub token. `admin.html` sends it a
password and a menu; it checks the password, re-validates the menu, and commits
`menu.json` to `main`. The customer page never talks to it.

## What you need first

- A GitHub **fine-grained** personal access token, scoped to the `D-Pretzel/snacko`
  repository only, with **Contents: Read and write**, and an explicit expiration
  date. Write that date down somewhere you will actually see it — when the token
  expires, saving stops working and the error will not say why.
- A Cloudflare account (the free plan is plenty).
- `wrangler` installed: `npm install -g wrangler`

## Deploy

```bash
cd worker
wrangler login
wrangler secret put GH_TOKEN
wrangler secret put EDIT_PASSWORD
wrangler deploy
```

`wrangler deploy` prints the Worker URL. For this account it is
`https://snacko.petzoldavid02.workers.dev`, which is already wired into the
`WORKER_URL` constant at the top of the script block in `admin.html`.

The `name` in `wrangler.toml` must match the Worker's name on the Cloudflare
account exactly. If they differ, `wrangler secret put` fails with
`This Worker does not exist on your account. [code: 10007]` — it is a name
mismatch, not an authentication problem.

## Configuration

| Binding | Type | Contents |
| :---- | :---- | :---- |
| `GH_TOKEN` | secret | Fine-grained PAT, `D-Pretzel/snacko` only, Contents read and write |
| `EDIT_PASSWORD` | secret | The shared password you give the snacko |
| `ALLOWED_ORIGIN` | var (`wrangler.toml`) | `https://d-pretzel.github.io` |
| `GH_REPO` | var (`wrangler.toml`) | `D-Pretzel/snacko` |

If you fork the project or host the page somewhere else, change `ALLOWED_ORIGIN`
and `GH_REPO` in `wrangler.toml` and redeploy. `ALLOWED_ORIGIN` is an origin only:
scheme and host, no trailing path.

## Rotating secrets

Handing over the snacko job, or think the password got out:

```bash
wrangler secret put EDIT_PASSWORD
```

Type the new one, press enter, done — no redeploy needed. Anyone still signed in
on the old password gets bounced back to the login screen the next time they save.

Rotating the GitHub token is the same command with `GH_TOKEN`. Revoke the old
token on GitHub afterwards.

## Endpoints

`POST /verify` — body `{ "pass": "..." }`. Returns 200 on a match, 401 otherwise.
Repeated failures from one IP get a short lockout.

`POST /save` — body `{ "pass": "...", "menu": {...}, "summary": "..." }`. Returns
200 with `{ "commit": "<sha>" }`. The menu is validated against the schema again
here; the browser's validation is a convenience, not a control.

## Notes for whoever maintains this

- Every response, including errors and the `OPTIONS` preflight, carries CORS
  headers. A missing CORS header on the error path is the classic failure in this
  design — the browser then reports a generic network error and hides the real
  message.
- The write reads the file's `sha` immediately before the `PUT`, and retries once
  with a fresh `sha` on a 409, which is what a concurrent edit looks like.
- GitHub rejects requests with no `User-Agent`, with a 403 that does not explain
  itself. The header is set explicitly in `ghHeaders()`.
- The `/verify` rate limit lives in isolate memory, so it is a speed bump rather
  than a guarantee. Promoting it to a Durable Object or KV is the upgrade path if
  it ever matters.

## Local testing

```bash
wrangler dev
```

Then point `WORKER_URL` in a local copy of `admin.html` at `http://localhost:8787`
and set `ALLOWED_ORIGIN` to your local server's origin (for example
`http://localhost:8000`) while testing. Put both back before deploying.
