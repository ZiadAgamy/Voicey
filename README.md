<div align="center">

<img src="src/web/public/voicey-logo.png" alt="Voicey Bot logo" width="140" />

# Voicey - Temporary Voice Channels Manager

**An easy-to-create temporary voice channel bot** that comes with easy setup, channel management, and dashboard.

[![Invite Bot](https://img.shields.io/badge/Invite-Voicey%20On%20Fluxer-4641d9?style=for-the-badge)](https://fluxer.com/oauth2/authorize?client_id=1553833004374175744&scope=bot&permissions=18014398862969936) [![Support Guild](https://img.shields.io/badge/Support-Voicey%20Guild-4641d9?style=for-the-badge)](https://fluxer.gg/JHqdSzV4) [![Website](https://img.shields.io/badge/Website-voicey.bot-4641d9?style=for-the-badge)](https://voicey.bot)

</div>

---
## Jump To
- [What is Voicey?](#what-is-voicey?)
- [Self Hosting on Instances](#self-hosting-on-instances)
- [Requirements](#requirements)
- [Setup](#setup)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Structures](#structures)
- [Contributing](#Contributing)
- [LICENSE](#LICENSE)

---
## What is Voicey?
**Voicey** is a [Fluxer](https://fluxer.com) application bot that makes for your server a Join-to-Create temporary voice channel. A member join the made channel, the bot moves them to their owned voice channel.
A member can customize their voice channel freely with simple commands.
Once the member leaves their voice channel, it gets deleted after 60 seconds (by default).
Voicey allows you to use in various multi-languages, letting anyone be able to understand more of Voicey. It has `English (default)`, `Arabic`, `German`, `Spanish`, and `French`.
Voicey also allows you to change their prefix, `!` by default, into any prefix you want per-server.
Voicey has an easy-to-use dashboard website, that lets you setup a temporary channel very easily with just a few clicks. 
You can change its profile picture, banner, bio & display name from the dashboard.
And, enable or disable a specific command or make only roles can use the commands.

---

## Self Hosting on Instances
Since Fluxer is an open source app, we've also made our bot open source. Meaning that you can host your own bot for your own self-hosted instance.

The default API services on `.env` refers to the main Fluxer instance.
| Variable | Default |
| --- | --- |
| `FLUXER_API_BASE` | `https://api.fluxer.app/v1` |

---

## Requirements
- **Node.js 22.13 or newer** (Voicey uses the built-in `node:sqlite`).
- A Fluxer bot token from the developer portal.

---

## Setup
```bash
git clone https://github.com/ZiadAgamy/Voicey.git voicey
cd voicey
npm install
cp .env.example .env     # edit .env and add FLUXER_BOT_TOKEN
npm start
```
For the dashboard settings, edit these in the `.env`:

```bash
# Set to true to start the dashboard inside the bot process.
DASHBOARD_ENABLED=false
# Port the dashboard listens on (hosts like Railway/Render set PORT for you).
DASHBOARD_PORT=3000
# Public URL of the dashboard, no trailing slash. The OAuth2 redirect URI you
# register in the Fluxer developer portal must be: <DASHBOARD_URL>/auth/callback
DASHBOARD_URL=http://localhost:3000
# OAuth2 application credentials (same application as the bot).
FLUXER_CLIENT_ID=
FLUXER_CLIENT_SECRET=
FLUXER_OAUTH_AUTHORIZE_URL=https://web.fluxer.app/oauth2/authorize
FLUXER_API_BASE=https://api.fluxer.app/v1
FLUXER_OAUTH_TOKEN_URL=https://api.fluxer.app/v1/oauth2/token
```

In your server, run `!setup` (or `!setup-wizard` for a guided setup).

---

## Commands
Default prefix is `!` (change per server with `!prefix`). Run `!help` in your server for the full list in your language.

| Area | Commands |
| --- | --- |
| Setup (needs Manage Server) | `setup`, `setup-wizard`, `delete-setup`, `settings`, `delay`, `language`, `prefix` |
| Your channel (channel owner only) | `name`, `limit`, `privacy`, `add`, `block`, `unblock`, `invite`, `kick`, `ban`, `unban`, `transfer`, `delete` |
| In a temp channel | `members`, `claim` (when the owner has left) |
| Info | `help`, `check`, `uptime`, `botinfo`, `ping` |

---

## Troubleshooting
| Problem | Solution |
| --- | --- |
| My bot is not online | Make sure you've added the correct token and added it in `FLUXER_BOT_TOKEN` env field, and install the latest dependencies. |
| Issue that bot doesn't react properly | Check if the bot has the correct permissions using `!check`, otherwise, it will log an error. |
| Bot failed to work on a hosted instance | Make sure to add your API link in `FLUXER_API_BASE` env field |
| Dashboard is working | Make sure you have set `DASHBOARD_ENABLED` to `true` and added the same port as your hosting (`3000` by default)

---

## Structures
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

---

## Contributing
If you'd like to support Voicey and add additional features, make sure you read [CONTRIBUTING.md](CONTRIBUTING.md).
To report a security problem, see [SECURITY.md](SECURITY.md).

---

## LICENSE
Voicey is under [MIT](LICENSE). Anyone can edit the code to however they want, just DON'T use Voicey as your bot's name.
