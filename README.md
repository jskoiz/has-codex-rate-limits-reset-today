# Codex Limit

This was a fun project I made in Codex because the Codex limits keep generously getting reset.

Thanks to the good folks at OpenAI, including [@thsottiaux](https://x.com/thsottiaux), who helps make sure users have the best experience possible.

## Built With Codex

I put the whole thing together in Codex as a small end-to-end project: UI, API routes, admin flow, state storage, and deployment setup.

## Stack

- Static frontend with plain HTML, CSS, and JavaScript
- Vercel serverless functions for the API
- GitHub Actions for the automated tweet monitor
- GitHub as the backing store for the shared public site state
- Cookie-based admin auth for the config page

## How It Works

- `/` shows the public Yes/No status
- `/api/status` reads the current state from `data/site-state.json`
- `/config` is the admin page for updating the state and timer
- `/api/admin/session` handles login/logout
- `/api/admin/config` reads and writes config after auth
- `/api/admin/automation` manually runs the tweet monitor from the admin panel
- `/api/automation/poll` checks new `@thsottiaux` tweets, classifies them with OpenAI, and can switch the public state to `yes`

When the state is set to `yes`, the app also stores a reset time so it can automatically fall back to `no` after the configured number of hours.
When the AI is uncertain about a new tweet, the app emails a review link to the configured address and leaves the public state unchanged.
The tracked `data/site-state.json` file now contains only the public status fields plus an encrypted private blob for admin sessions and automation internals, so raw auth and review metadata are not exposed if the repo is public.

## Deployment

The site is deployed on Vercel. The frontend is served statically, and the API runs through Vercel functions.

## Configuration

The app is connected to a GitHub repository for persistent state. Deployment expects these environment variables:

- `GITHUB_TOKEN`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_REPO_BRANCH`
- `GITHUB_COMMIT_NAME`
- `GITHUB_COMMIT_EMAIL`
- `SITE_ADMIN_PASSWORD`
- `SITE_SESSION_SECRET`
- `SITE_PRIVATE_STATE_SECRET`
- `RETTIWT_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_REASONING_MODEL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `AI_REVIEW_EMAIL`
- `SITE_BASE_URL`
- `CRON_SECRET`

The tracked public state lives in `data/site-state.json`.
The included GitHub Actions workflow polls `/api/automation/poll` every 5 minutes.

`RETTIWT_API_KEY` is used to search `@thsottiaux` tweets from the past day, which is more reliable than the guest timeline feed for this monitor.

## License

Open source under the MIT License. See `LICENSE`.
