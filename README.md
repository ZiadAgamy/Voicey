# 🎙️ [Voicey](https://web.fluxer.app/oauth2/authorize?client_id=1553833004374175744&scope=bot&permissions=18014398810778736)

**Easy temporary voice channels for [Fluxer](https://fluxer.app).**
Members join a **➕ Join to Create** channel and get their own voice room, which they control with simple prefix commands. When everyone leaves, the room is deleted automatically.

- 🗣️ Join-to-Create rooms with a configurable name template and deletion delay
- 🔒 Owner controls: rename, user limit, lock/unlock, trust, block, kick, ban, invite
- 👑 Claim or transfer ownership
- ⚙️ Per-server prefix and language (English, العربية, Deutsch, Español, Français)
- 🩺 `!check` health command that verifies setup and bot permissions
- 💾 Zero-setup storage: built-in SQLite, no external database

## Requirements

- **Node.js 22.13 or newer** (Voicey uses the built-in `node:sqlite`)
- A Fluxer bot token from the developer portal

## Quick start

```bash
git clone https://github.com/ZiadAgamy/Voicey.git voicey
cd voicey
npm install
cp .env.example .env     # then edit .env and add FLUXER_BOT_TOKEN
npm start
```

In your server, run `!setup` (or `!setup-wizard` for a guided setup).

## Web dashboard

Voicey ships with an optional dashboard that runs inside the bot process (it shares the bot's database and live voice state).

1. In the Fluxer developer portal, open your application and add the redirect URI `<DASHBOARD_URL>/auth/callback` (for local testing: `http://localhost:3000/auth/callback`). Copy the **Client ID** and **Client Secret**.
2. Add to `.env`: `DASHBOARD_ENABLED=true`, `DASHBOARD_URL`, `FLUXER_CLIENT_ID`, `FLUXER_CLIENT_SECRET` (see `.env.example`).
3. `npm install` then `npm start`, and open the dashboard URL.

Features: login with Fluxer, server sidebar (only servers where you have Manage Community; servers without Voicey are greyed out), per-server prefix / language / deletion delay / channel name template, live view of members in temporary channels, one-click setup, **per-server bot profile** (name, avatar, banner, bio with live preview) and **command control** (enable/disable every command, and restrict any command to specific roles/members).

Command access rules: an empty role/member list means the default — commands that need Manage Community stay manager-only, never public. Once you add roles/members, only they (plus the server owner and Administrators) can run that command, and listed members can use a Manage Community command without holding that permission. `@everyone` can never be added.

## Bot permissions

Invite the bot with these permissions. `!check` verifies them for you.

View Channel · Send Messages · Embed Links · Manage Channels · Manage Permissions · Move Members · Connect · Create Invite · Add Reactions · Read Message History

## Configuration

Everything is configured through environment variables in `.env`. See [`.env.example`](.env.example) for the full list. Only `FLUXER_BOT_TOKEN` is required.

Embed images and custom emoji are optional. Without them Voicey uses plain Unicode emoji and no thumbnails.

## Commands

Default prefix is `!` (change per server with `!prefix`). Run `!help` in your server for the full list in your language.

| Area | Commands |
| --- | --- |
| Setup (needs Manage Server) | `setup`, `setup-wizard`, `delete-setup`, `settings`, `delay`, `language`, `prefix` |
| Your channel (owner only) | `name`, `limit`, `privacy`, `add`, `block`, `unblock`, `invite`, `kick`, `ban`, `unban`, `transfer`, `delete` |
| In a temp channel | `members`, `claim` (when the owner has left) |
| Info | `help`, `check`, `uptime`, `botinfo`, `ping` |

## Project layout

```
src/
  index.js               entry point
  commands/              one file per command
  services/              temp-channel lifecycle, controls, voice state tracking
  db/                    SQLite schema and queries
  i18n/locales/          translations (en, ar, de, es, fr)
  config/                emoji and image configuration
```

Data is stored in `data/voicey.sqlite`, created on first run. Back this folder up if you care about server settings.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
# Voicey
Invite [Voicey](https://web.fluxer.app/oauth2/authorize?client_id=1553833004374175744&scope=bot&permissions=18014398810778736)
