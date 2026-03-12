# Codex Limit

This was a fun project I made in Codex because the Codex limits keep generously getting reset.

Thanks to the good folks at OpenAI, including [@thsottiaux](https://x.com/thsottiaux), who helps make sure users have the best experience possible.

## Built With Codex

I put the whole thing together in Codex as a small end-to-end project: UI, API routes, admin flow, state storage, and deployment setup.

## Stack

- Static frontend with plain HTML, CSS, and JavaScript
- Vercel serverless functions for the API
- GitHub as the backing store for the shared site state
- Cookie-based admin auth for the config page

## How It Works

- `/` shows the public Yes/No status
- `/api/status` reads the current state from `data/site-state.json`
- `/config` is the admin page for updating the state and timer
- `/api/admin/session` handles login/logout
- `/api/admin/config` reads and writes config after auth

When the state is set to `yes`, the app also stores a reset time so it can automatically fall back to `no` after the configured number of hours.

## Deployment

The site is deployed on Vercel. The frontend is served statically, and the API runs through Vercel functions.

## Configuration

The app is connected to a GitHub repository for persistent state. Deployment expects these environment variables:

- `GITHUB_TOKEN`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_REPO_BRANCH`
- `SITE_ADMIN_PASSWORD`
- `SITE_SESSION_SECRET`

The tracked state lives in `data/site-state.json`.

## License

Open source under the MIT License. See `LICENSE`.
