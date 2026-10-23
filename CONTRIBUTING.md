# Contributing to Voicey

Thanks for helping out!

## Setup

1. Fork and clone the repo.
2. Use **Node.js 22.13+**, then run `npm install`.
3. `cp .env.example .env` and add a bot token for a **test bot in a test server** (never your production bot).
4. `npm run dev` restarts the bot when files change.

## Before opening a pull request

- Run `npm run check` (syntax check of every source file).
- If you add or rename a command message, add the key to **all five** files in `src/i18n/locales/`. A missing key shows the raw key to users.
- Keep each command in its own file under `src/commands/`, exporting `{ name, aliases?, execute }`.
- Never commit `.env`, `data/` or anything containing a token, webhook URL or personal data.
- Keep pull requests focused: one fix or feature each, with a short description of how you tested it.

## Reporting bugs

Open an issue with what you ran, what you expected, what happened, and any error from the console. Remove tokens and webhook URLs from anything you paste.
