import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelType } from '@fluxerjs/core';

import {
  createWebSession,
  getWebSession,
  updateWebSessionTokens,
  deleteWebSession,
  purgeOldWebSessions,
  getGuildSettings,
  ensureGuild,
  setGuildLanguage,
  setGuildPrefix,
  setGuildDeletionDelay,
  setGuildNameTemplate,
  saveSetup,
  clearSetup,
  tempChannelsForGuild,
  deleteTempChannel,
  getGuildCommandRules,
  setCommandRule,
  resetGuildCommandRules,
} from '../db/index.js';
import { COMMAND_CATEGORIES, getCommandMeta } from '../services/commandRegistry.js';
import { availableLocales, hasLocale } from '../i18n/index.js';
import { getGuildVoiceStates } from '../services/voiceState.js';
import { postSetupDashboard } from '../services/dashboard.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  fetchCurrentUser,
  fetchUserGuilds,
  canManageGuild,
  guildIconUrl,
  userAvatarUrl,
} from './fluxerApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const SESSION_COOKIE = 'voicey_session';
const STATE_COOKIE = 'voicey_oauth_state';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // seconds
const GUILD_CACHE_MS = 30_000;

// Same validation rules as the in-chat commands.
const MAX_PREFIX_LENGTH = 5;
const isValidPrefix = (v) =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_PREFIX_LENGTH && !/\s/.test(v) && !/[<@>]/.test(v);

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function makeVault(secret) {
  const key = crypto.createHash('sha256').update(`voicey-dashboard:${secret}`).digest();
  return {
    seal(plain) {
      if (plain == null) return null;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
    },
    open(sealed) {
      if (!sealed) return null;
      try {
        const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64'));
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref?.();
  return (req, res, next) => {
    const key = req.ip;
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: 'Too many requests, slow down.' });
    next();
  };
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

export function startWebDashboard(client) {
  if (String(process.env.DASHBOARD_ENABLED ?? '').toLowerCase() !== 'true') return null;

  const clientId = process.env.FLUXER_CLIENT_ID?.trim();
  const clientSecret = process.env.FLUXER_CLIENT_SECRET?.trim();
  const baseUrl = (process.env.DASHBOARD_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  const port = Number(process.env.DASHBOARD_PORT || process.env.PORT || 3000);

  if (!clientId || !clientSecret) {
    console.error(
      '[Voicey] Dashboard disabled: set FLUXER_CLIENT_ID and FLUXER_CLIENT_SECRET in .env (see .env.example).',
    );
    return null;
  }

  const redirectUri = `${baseUrl}/auth/callback`;
  const secureCookies = baseUrl.startsWith('https://');
  const vault = makeVault(clientSecret);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const smallJson = express.json({ limit: '16kb' });
  const bigJson = express.json({ limit: '24mb' });
  app.use((req, res, next) => (/^\/api\/guilds\/\d+\/profile$/.test(req.path) ? bigJson : smallJson)(req, res, next));

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
        "font-src 'self' https://unpkg.com https://fonts.gstatic.com",
        "img-src 'self' data: https://fluxerusercontent.com https://fluxerstatic.com",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    next();
  });

  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== baseUrl) return res.status(403).json({ error: 'Bad origin.' });
    next();
  });

  const cookieOpts = (maxAgeSeconds) => ({
    httpOnly: true,
    sameSite: 'Lax',
    secure: secureCookies,
    path: '/',
    maxAge: maxAgeSeconds,
  });
  const setCookie = (res, name, value, opts) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path}`, `Max-Age=${opts.maxAge}`, `SameSite=${opts.sameSite}`];
    if (opts.httpOnly) parts.push('HttpOnly');
    if (opts.secure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  };

  // ---------- auth ----------

  const authLimit = rateLimiter({ windowMs: 60_000, max: 30 });

  app.get('/auth/login', authLimit, (req, res) => {
    const state = crypto.randomBytes(24).toString('hex');
    setCookie(res, STATE_COOKIE, state, cookieOpts(600));
    res.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }));
  });

  app.get('/auth/callback', authLimit, async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const { code, state, error } = req.query;
    setCookie(res, STATE_COOKIE, '', cookieOpts(0));

    if (error) return res.redirect('/?login=denied');
    if (!code || !state || typeof state !== 'string' || state !== cookies[STATE_COOKIE]) {
      return res.redirect('/?login=failed');
    }

    try {
      const tokens = await exchangeCode({ clientId, clientSecret, redirectUri, code: String(code) });
      const user = await fetchCurrentUser(tokens.accessToken);

      const sessionId = crypto.randomBytes(32).toString('hex');
      createWebSession({
        id: sha256(sessionId),
        userId: String(user.id),
        username: user.global_name || user.username || 'User',
        avatar: user.avatar ?? null,
        accessToken: vault.seal(tokens.accessToken),
        refreshToken: vault.seal(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
      });
      purgeOldWebSessions(SESSION_MAX_AGE);

      setCookie(res, SESSION_COOKIE, sessionId, cookieOpts(SESSION_MAX_AGE));
      res.redirect('/');
    } catch (err) {
      console.error('[Voicey] Dashboard login failed:', err?.message ?? err);
      res.redirect('/?login=failed');
    }
  });

  app.post('/auth/logout', (req, res) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sid) deleteWebSession(sha256(sid));
    guildCache.delete(sid);
    setCookie(res, SESSION_COOKIE, '', cookieOpts(0));
    res.json({ ok: true });
  });

  // ---------- session middleware ----------
  const guildCache = new Map();

  async function requireSession(req, res, next) {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const row = sid ? getWebSession(sha256(sid)) : null;
    if (!row) return res.status(401).json({ error: 'Not logged in.' });

    let accessToken = vault.open(row.access_token);

    // Refresh shortly before expiry.
    if (row.expires_at - 60 < Math.floor(Date.now() / 1000)) {
      const refreshToken = vault.open(row.refresh_token);
      try {
        if (!refreshToken) throw new Error('no refresh token');
        const fresh = await refreshAccessToken({ clientId, clientSecret, refreshToken });
        updateWebSessionTokens(row.id, {
          accessToken: vault.seal(fresh.accessToken),
          refreshToken: vault.seal(fresh.refreshToken ?? refreshToken),
          expiresAt: fresh.expiresAt,
        });
        accessToken = fresh.accessToken;
      } catch {
        deleteWebSession(row.id);
        setCookie(res, SESSION_COOKIE, '', cookieOpts(0));
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    }

    if (!accessToken) {
      deleteWebSession(row.id);
      return res.status(401).json({ error: 'Session invalid. Please log in again.' });
    }

    req.session = { sid, userId: row.user_id, username: row.username, avatar: row.avatar, accessToken };
    next();
  }

  async function manageableGuilds(session, { force = false } = {}) {
    const cached = guildCache.get(session.sid);
    if (!force && cached && Date.now() - cached.at < GUILD_CACHE_MS) return cached.guilds;

    const all = await fetchUserGuilds(session.accessToken);
    const guilds = (Array.isArray(all) ? all : []).filter(canManageGuild);
    guildCache.set(session.sid, { at: Date.now(), guilds });
    return guilds;
  }

  async function requireGuild(req, res, next) {
    const guildId = String(req.params.guildId ?? '');
    if (!/^\d{5,25}$/.test(guildId)) return res.status(400).json({ error: 'Bad server id.' });

    try {
      const guilds = await manageableGuilds(req.session);
      const info = guilds.find((g) => String(g.id) === guildId);
      if (!info) return res.status(403).json({ error: 'You need the Manage Community permission in that server.' });

      req.guildId = guildId;
      req.guildInfo = info;
      req.botGuild = client.guilds.get(guildId) ?? null;
      next();
    } catch (err) {
      if (err?.status === 401) return res.status(401).json({ error: 'Session expired. Please log in again.' });
      console.error('[Voicey] Dashboard guild lookup failed:', err?.message ?? err);
      res.status(502).json({ error: 'Could not reach Fluxer. Try again in a moment.' });
    }
  }

  const requireBotInGuild = (req, res, next) =>
    req.botGuild ? next() : res.status(409).json({ error: 'Voicey is not in this server yet.' });

  const api = express.Router();
  api.use(rateLimiter({ windowMs: 10_000, max: 80 }));
  api.use(requireSession);

  // ---------- API: user + guild list ----------

  // The bot's public identity (name + picture) as shown in the dashboard sidebar.
  // Per server it follows the server nickname/avatar, falling back to the global profile.
  const identitySafe = (fn) => { try { return fn() ?? null; } catch { return null; } };
  const globalBotAvatar = () =>
    identitySafe(() => client.user?.displayAvatarURL?.({ size: 128 }) ?? client.user?.avatarURL?.({ size: 128 }));
  const globalIdentity = () => ({ name: client.user?.username ?? 'Voicey', avatarUrl: globalBotAvatar() });
  const identityOf = (me) => ({
    name: me?.nick || client.user?.username || 'Voicey',
    avatarUrl: identitySafe(() => me?.avatarURL?.({ size: 128 })) ?? globalBotAvatar(),
  });
  const IDENTITY_TTL_MS = 15_000;
  const identityCache = new Map(); // guildId -> { at, value }
  async function guildBotIdentity(botGuild) {
    const hit = identityCache.get(String(botGuild.id));
    if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.value;
    let value;
    try { value = identityOf(await botGuild.fetchMe()); } catch { value = hit?.value ?? globalIdentity(); }
    identityCache.set(String(botGuild.id), { at: Date.now(), value });
    return value;
  }

  api.get('/me', (req, res) => {
    res.json({
      id: req.session.userId,
      username: req.session.username,
      avatarUrl: userAvatarUrl(req.session.userId, req.session.avatar),
      inviteUrl: `https://web.fluxer.app/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot&permissions=${encodeURIComponent(process.env.INVITE_PERMISSIONS || '18014398862969936')}`,
      botName: client.user?.username ?? 'Voicey',
      bot: globalIdentity(),
    });
  });

  api.get('/guilds', async (req, res) => {
    try {
      const guilds = await manageableGuilds(req.session, { force: req.query.refresh === '1' });
      const list = guilds
        .map((g) => ({
          id: String(g.id),
          name: g.name,
          iconUrl: guildIconUrl(g.id, g.icon),
          botIn: client.guilds.has(String(g.id)),
        }))
        // Servers with Voicey first, then alphabetical.
        .sort((a, b) => Number(b.botIn) - Number(a.botIn) || a.name.localeCompare(b.name));
      res.json(list);
    } catch (err) {
      if (err?.status === 401) return res.status(401).json({ error: 'Session expired. Please log in again.' });
      res.status(502).json({ error: 'Could not load your servers from Fluxer.' });
    }
  });

  // ---------- API: one guild ----------

  api.get('/guilds/:guildId', requireGuild, requireBotInGuild, async (req, res) => {
    const { guildId, botGuild } = req;
    const settings = ensureGuild(guildId);

    let channels = [];
    try {
      const fetched = await botGuild.fetchChannels();
      channels = fetched.map((c) => ({
        id: String(c.id),
        name: c.name,
        type: c.type,
        parentId: c.parentId ? String(c.parentId) : null,
      }));
    } catch {

    }

    const nameOf = (id) => channels.find((c) => c.id === id)?.name ?? null;

    res.json({
      bot: await guildBotIdentity(botGuild),
      id: guildId,
      name: botGuild.name,
      iconUrl: guildIconUrl(guildId, botGuild.icon),
      settings: {
        prefix: settings.prefix,
        language: settings.language,
        deletionDelay: settings.deletion_delay,
        nameTemplate: settings.name_template,
      },
      setup: settings.join_channel_id
        ? {
            joinChannelId: settings.join_channel_id,
            joinChannelName: nameOf(settings.join_channel_id),
            categoryId: settings.category_id,
            categoryName: settings.category_id ? nameOf(settings.category_id) : null,
          }
        : null,
      channels: {
        categories: channels.filter((c) => c.type === ChannelType.GuildCategory),
        voice: channels.filter((c) => c.type === ChannelType.GuildVoice),
        text: channels.filter((c) => c.type === ChannelType.GuildText),
      },
      languages: availableLocales(),
    });
  });

  api.patch('/guilds/:guildId/settings', requireGuild, requireBotInGuild, (req, res) => {
    const { guildId } = req;
    const { prefix, language, deletionDelay, nameTemplate } = req.body ?? {};
    ensureGuild(guildId);

    if (prefix !== undefined) {
      if (!isValidPrefix(prefix)) {
        return res.status(400).json({ error: `Prefix must be 1–${MAX_PREFIX_LENGTH} characters with no spaces, <, > or @.` });
      }
    }
    if (language !== undefined && !hasLocale(language)) {
      return res.status(400).json({ error: 'Unknown language.' });
    }
    if (deletionDelay !== undefined) {
      if (!Number.isInteger(deletionDelay) || deletionDelay < 0 || deletionDelay > 3600) {
        return res.status(400).json({ error: 'Deletion delay must be a whole number between 0 and 3600 seconds.' });
      }
    }
    if (nameTemplate !== undefined) {
      if (typeof nameTemplate !== 'string' || !nameTemplate.trim() || Array.from(nameTemplate).length > 32) {
        return res.status(400).json({ error: 'Channel name template must be 1–32 characters.' });
      }
    }

    if (prefix !== undefined) setGuildPrefix(guildId, prefix);
    if (language !== undefined) setGuildLanguage(guildId, language);
    if (deletionDelay !== undefined) setGuildDeletionDelay(guildId, deletionDelay);
    if (nameTemplate !== undefined) setGuildNameTemplate(guildId, nameTemplate.trim());

    const s = getGuildSettings(guildId);
    res.json({
      prefix: s.prefix,
      language: s.language,
      deletionDelay: s.deletion_delay,
      nameTemplate: s.name_template,
    });
  });

  // ---------- API: setup ----------

  api.post('/guilds/:guildId/setup', requireGuild, requireBotInGuild, async (req, res) => {
    const { guildId, botGuild } = req;
    const settings = ensureGuild(guildId);
    const { mode, announceChannelId, joinChannelId, categoryId } = req.body ?? {};

    if (settings.join_channel_id) {
      const stillThere = await client.channels.fetch(settings.join_channel_id).catch(() => null);
      if (stillThere) return res.status(409).json({ error: 'This server is already set up. Remove the current setup first.' });
      clearSetup(guildId);
    }

    let channels;
    try {
      channels = await botGuild.fetchChannels();
    } catch {
      return res.status(502).json({ error: 'Voicey could not read this server\'s channels.' });
    }
    const byId = new Map(channels.map((c) => [String(c.id), c]));

    // Optional "setup complete" message in a text channel.
    let announce = null;
    if (announceChannelId) {
      const c = byId.get(String(announceChannelId));
      if (!c || c.type !== ChannelType.GuildText) return res.status(400).json({ error: 'Pick a text channel for the announcement.' });
      announce = c;
    }

    const created = [];
    try {
      let category;
      let joinChannel;

      if (mode === 'existing') {
        joinChannel = byId.get(String(joinChannelId));
        if (!joinChannel || joinChannel.type !== ChannelType.GuildVoice) {
          return res.status(400).json({ error: 'Pick an existing voice channel to use as Join to Create.' });
        }
        if (categoryId) {
          category = byId.get(String(categoryId));
          if (!category || category.type !== ChannelType.GuildCategory) {
            return res.status(400).json({ error: 'Pick a valid category.' });
          }
        } else if (joinChannel.parentId) {
          category = byId.get(String(joinChannel.parentId)) ?? null;
        }
      } else {
        category = await botGuild.createChannel({ type: ChannelType.GuildCategory, name: 'Voice Channels' });
        created.push(category);
        joinChannel = await botGuild.createChannel({
          type: ChannelType.GuildVoice,
          name: '➕ Join to Create',
          parentId: category.id,
        });
        created.push(joinChannel);
      }

      let messageId = null;
      if (announce) {
        const target = client.channels.get(announce.id) ?? (await client.channels.fetch(announce.id).catch(() => null));
        const msg = target
          ? await postSetupDashboard(client, target, settings.language, joinChannel, settings.prefix ?? '!').catch(() => null)
          : null;
        messageId = msg?.id ?? null;
      }

      saveSetup(guildId, {
        categoryId: category?.id ?? null,
        joinChannelId: joinChannel.id,
        dashboardChannelId: messageId ? announce.id : null,
        dashboardMessageId: messageId,
      });

      res.json({
        ok: true,
        joinChannelId: String(joinChannel.id),
        joinChannelName: joinChannel.name,
        categoryId: category ? String(category.id) : null,
        categoryName: category?.name ?? null,
      });
    } catch (err) {
      for (const ch of created.reverse()) await ch.delete().catch(() => {});
      clearSetup(guildId);
      console.error('[Voicey] Dashboard setup failed:', err?.message ?? err);
      res.status(500).json({
        error: 'Setup failed. Make sure Voicey has the Manage Channels and Manage Permissions permissions.',
      });
    }
  });

  api.delete('/guilds/:guildId/setup', requireGuild, requireBotInGuild, async (req, res) => {
    const { guildId } = req;
    const settings = getGuildSettings(guildId);
    if (!settings?.join_channel_id) return res.status(404).json({ error: 'This server has no setup to remove.' });

    if (req.query.channels === '1') {
      const remove = async (id) => {
        const ch = client.channels.get(id) ?? (await client.channels.fetch(id).catch(() => null));
        await ch?.delete?.().catch(() => {});
      };
      for (const row of tempChannelsForGuild(guildId)) {
        await remove(row.channel_id);
        deleteTempChannel(row.channel_id);
      }
      await remove(settings.join_channel_id);
    }
    clearSetup(guildId);
    res.json({ ok: true });
  });

  // ---------- API: live voice overview ----------

  const memberCache = new Map();
  const MEMBER_TTL = 5 * 60_000;

  async function resolveMember(guild, userId) {
    const key = `${guild.id}:${userId}`;
    const hit = memberCache.get(key);
    if (hit && Date.now() - hit.at < MEMBER_TTL) return hit.data;

    let member = guild.members.get(userId);
    if (!member) member = await guild.fetchMember(userId).catch(() => null);

    const user = member?.user;
    const data = {
      id: userId,
      name: member?.displayName ?? user?.globalName ?? user?.username ?? `User ${String(userId).slice(-4)}`,
      avatarUrl: userAvatarUrl(userId, user?.avatar ?? null, 64),
      bot: Boolean(user?.bot),
    };
    memberCache.set(key, { at: Date.now(), data });
    if (memberCache.size > 5000) memberCache.delete(memberCache.keys().next().value);
    return data;
  }

  api.get('/guilds/:guildId/voice', requireGuild, requireBotInGuild, async (req, res) => {
    const { guildId, botGuild } = req;
    const rows = tempChannelsForGuild(guildId);
    const states = getGuildVoiceStates(guildId);

    const byChannel = new Map();
    for (const s of states) {
      if (!byChannel.has(s.channelId)) byChannel.set(s.channelId, []);
      byChannel.get(s.channelId).push(s.userId);
    }

    const channels = [];
    for (const row of rows) {
      const live = client.channels.get(row.channel_id);
      const memberIds = byChannel.get(row.channel_id) ?? [];
      const ids = [...new Set([...memberIds, row.owner_id])].slice(0, 60);
      const resolved = await Promise.all(ids.map((id) => resolveMember(botGuild, id)));
      const byId = new Map(resolved.map((m) => [m.id, m]));

      channels.push({
        id: String(row.channel_id),
        name: live?.name ?? 'Temporary channel',
        locked: Boolean(row.locked),
        waitRoom: Boolean(row.wait_room),
        topic: row.topic ?? null,
        userLimit: live?.userLimit ?? 0,
        createdAt: row.created_at,
        emptySince: row.empty_since ?? null,
        owner: byId.get(row.owner_id) ?? { id: row.owner_id, name: 'Unknown' },
        members: memberIds.slice(0, 60).map((id) => ({ ...(byId.get(id) ?? { id, name: 'Unknown' }), isOwner: id === row.owner_id })),
        memberCount: memberIds.length,
      });
    }

    channels.sort((a, b) => b.memberCount - a.memberCount || a.createdAt - b.createdAt);
    res.json({
      bot: await guildBotIdentity(botGuild),
      channels,
      totals: {
        channels: channels.length,
        members: channels.reduce((n, c) => n + c.memberCount, 0),
      },
      updatedAt: Date.now(),
    });
  });


  // ---------- API: command toggles + role/member access ----------

  const ID_RE = /^\d{5,25}$/;

  api.get('/guilds/:guildId/commands', requireGuild, requireBotInGuild, async (req, res) => {
    const { guildId, botGuild } = req;
    const rules = getGuildCommandRules(guildId);

    let roles = [];
    try {
      roles = (await botGuild.fetchRoles())
        .filter((r) => String(r.id) !== guildId) // @everyone can never be granted a command
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: String(r.id), name: r.name, color: r.color ? `#${Number(r.color).toString(16).padStart(6, '0')}` : null }));
    } catch {

    }

    const memberIds = [...new Set(Object.values(rules).flatMap((r) => r.members))].slice(0, 200);
    const resolved = await Promise.all(memberIds.map((id) => resolveMember(botGuild, id)));

    res.json({
      categories: COMMAND_CATEGORIES.map((c) => ({
        id: c.id,
        label: c.label,
        icon: c.icon,
        commands: c.commands.map((cmd) => {
          const r = rules[cmd.name] ?? { enabled: true, roles: [], members: [] };
          return { ...cmd, enabled: r.enabled, roles: r.roles, members: r.members };
        }),
      })),
      roles,
      members: Object.fromEntries(resolved.map((m) => [m.id, { name: m.name, avatarUrl: m.avatarUrl }])),
    });
  });

  api.put('/guilds/:guildId/commands/:name', requireGuild, requireBotInGuild, async (req, res) => {
    const { guildId, botGuild } = req;
    const meta = getCommandMeta(String(req.params.name));
    if (!meta) return res.status(404).json({ error: 'Unknown command.' });

    const { enabled, roles, members } = req.body ?? {};
    const list = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : null);
    const roleIds = list(roles ?? []);
    const memberIds = list(members ?? []);

    if (typeof enabled !== 'boolean' || !roleIds || !memberIds) return res.status(400).json({ error: 'Invalid request.' });
    if (roleIds.length > 25 || memberIds.length > 50) return res.status(400).json({ error: 'Too many roles or members for one command.' });
    if (![...roleIds, ...memberIds].every((id) => ID_RE.test(id))) return res.status(400).json({ error: 'Invalid role or member id.' });
    // @everyone would silently make the command public — never allowed.
    if (roleIds.includes(guildId)) return res.status(400).json({ error: '@everyone cannot be added. Leave the list empty for the default behaviour.' });

    // Only keep roles that really exist in the server.
    try {
      const real = new Set((await botGuild.fetchRoles()).map((r) => String(r.id)));
      const bad = roleIds.filter((id) => !real.has(id));
      if (bad.length) return res.status(400).json({ error: 'One of the roles no longer exists.' });
    } catch {
      return res.status(502).json({ error: 'Could not verify roles with Fluxer. Try again.' });
    }

    setCommandRule(guildId, meta.name, { enabled, roles: roleIds, members: memberIds });
    res.json({ name: meta.name, enabled, roles: roleIds, members: memberIds });
  });

  api.delete('/guilds/:guildId/commands', requireGuild, requireBotInGuild, (req, res) => {
    resetGuildCommandRules(req.guildId);
    res.json({ ok: true });
  });

  api.get('/guilds/:guildId/members/search', requireGuild, requireBotInGuild, async (req, res) => {
    const { botGuild } = req;
    const q = String(req.query.q ?? '').trim().slice(0, 40);
    if (!q) return res.json([]);

    const ids = new Set();
    if (ID_RE.test(q)) ids.add(q);
    try {
      const found = await botGuild.members.search({ query: q, limit: 8 });
      for (const hit of found.members ?? []) ids.add(String(hit.userId));
    } catch {
      const needle = q.toLowerCase();
      for (const m of botGuild.members.values?.() ?? []) {
        if (ids.size >= 8) break;
        if ([m.displayName, m.user?.username].some((n) => String(n ?? '').toLowerCase().includes(needle))) ids.add(String(m.id));
      }
    }

    const out = [];
    for (const id of [...ids].slice(0, 8)) {
      const m = await resolveMember(botGuild, id);
      if (!m.bot) out.push({ id: m.id, name: m.name, avatarUrl: m.avatarUrl });
    }
    res.json(out);
  });

  // ---------- API: per-server bot profile (nickname, avatar, banner, bio) ----------

  const PROFILE_COOLDOWN_MS = 8_000;
  const profileLast = new Map();
  const IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_NICK = 32;
  const MAX_BIO = 190;

  const decodedSize = (dataUri) => Math.floor(((dataUri.length - dataUri.indexOf(',') - 1) * 3) / 4);

  async function readBotProfile(botGuild) {
    const me = await botGuild.fetchMe();
    const safe = (fn) => { try { return fn() ?? null; } catch { return null; } };
    const globalUser = client.user;
    return {
      username: globalUser?.username ?? 'Voicey',
      nick: me.nick ?? null,
      bio: me.bio ?? null,
      avatarUrl: safe(() => me.avatarURL({ size: 256 })),
      bannerUrl: safe(() => me.bannerURL({ size: 600 })),
      globalAvatarUrl: safe(() => globalUser?.displayAvatarURL?.({ size: 256 }) ?? globalUser?.avatarURL?.({ size: 256 })),
      bot: (() => {
        const value = identityOf(me);
        identityCache.set(String(botGuild.id), { at: Date.now(), value });
        return value;
      })(),
    };
  }

  api.get('/guilds/:guildId/profile', requireGuild, requireBotInGuild, async (req, res) => {
    try {
      res.json(await readBotProfile(req.botGuild));
    } catch (err) {
      console.error('[Voicey] Dashboard profile read failed:', err?.message ?? err);
      res.status(502).json({ error: 'Could not read Voicey’s profile from Fluxer.' });
    }
  });

  api.patch('/guilds/:guildId/profile', requireGuild, requireBotInGuild, async (req, res) => {
    const { guildId, botGuild } = req;
    const body = req.body ?? {};
    const edit = {};

    if ('nick' in body) {
      if (body.nick !== null && typeof body.nick !== 'string') return res.status(400).json({ error: 'Bad name.' });
      const nick = body.nick === null ? null : body.nick.trim();
      if (nick && Array.from(nick).length > MAX_NICK) return res.status(400).json({ error: `Name must be ${MAX_NICK} characters or fewer.` });
      edit.nick = nick || null;
    }
    if ('bio' in body) {
      if (body.bio !== null && typeof body.bio !== 'string') return res.status(400).json({ error: 'Bad bio.' });
      const bio = body.bio === null ? null : body.bio.trim();
      if (bio && Array.from(bio).length > MAX_BIO) return res.status(400).json({ error: `Bio must be ${MAX_BIO} characters or fewer.` });
      edit.bio = bio || null;
    }
    for (const key of ['avatar', 'banner']) {
      if (!(key in body)) continue;
      const v = body[key];
      if (v === null) { edit[key] = null; continue; }
      if (typeof v !== 'string' || !IMAGE_RE.test(v)) return res.status(400).json({ error: `The ${key} must be a PNG, JPEG, GIF or WebP image.` });
      if (decodedSize(v) > MAX_IMAGE_BYTES) return res.status(400).json({ error: `The ${key} is larger than 8 MB.` });
      edit[key] = v;
    }
    if (!Object.keys(edit).length) return res.status(400).json({ error: 'Nothing to save.' });

    if (Date.now() - (profileLast.get(guildId) ?? 0) < PROFILE_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Slow down — wait a few seconds between profile saves.' });
    }

    profileLast.set(guildId, Date.now());
    try {
      const me = await botGuild.fetchMe();
      await me.edit(edit);
      res.json(await readBotProfile(botGuild));
    } catch (err) {
      profileLast.delete(guildId);
      console.error('[Voicey] Dashboard profile update failed:', err?.message ?? err);
      res.status(502).json({ error: `Fluxer rejected the profile update${err?.message ? `: ${String(err.message).slice(0, 160)}` : '.'}` });
    }
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---------- static frontend ----------

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '5m' }));
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  const server = app.listen(port, () => {
    console.log(`[Voicey] Dashboard listening on port ${port} (${baseUrl}).`);
  });
  server.on('error', (err) => console.error('[Voicey] Dashboard server error:', err));
  return server;
}
