# Codex Limit

Static site on Vercel with a global Yes/No status backed by a single GitHub state file.

## Architecture

- `/` is a static page that fetches live status from `/api/status`
- `/config` is a hidden admin page that unlocks with a password
- `/api/status` reads the global state from GitHub
- `/api/admin/session` creates or clears the admin session cookie
- `/api/admin/config` reads and writes the global state after auth

The site stores:

- `currentState`
- `autoResetHours`
- `resetAt`
- `updatedAt`

The state file may also include internal `auth` metadata used for admin session revocation and login throttling. That data is managed by the API and should not be edited manually.

When state is `yes`, the public status automatically resolves to `no` once `resetAt` has passed. No cron job is required.

## Required Vercel Environment Variables

- `GITHUB_TOKEN`
  Token with `repo` scope so the Vercel functions can read and update the repository file.
- `GITHUB_REPO_OWNER`
  GitHub repository owner, for example `jskoiz`.
- `GITHUB_REPO_NAME`
  GitHub repository name, for example `codex-limit`.
- `GITHUB_REPO_BRANCH`
  Branch used for the state file, typically `main`.
- `SITE_ADMIN_PASSWORD`
  Password required to unlock `/config`.
- `SITE_SESSION_SECRET`
  Long random secret used to sign the admin session cookie.

## State File

The site reads and writes [data/site-state.json](/Users/jerry/Desktop/codex limit/data/site-state.json#L1).
