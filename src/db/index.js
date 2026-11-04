import { DatabaseSync } from 'node:sqlite'; // built into Node 22.5+, no native build needed
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'voicey.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id        TEXT PRIMARY KEY,
  language        TEXT NOT NULL DEFAULT 'en',
  prefix          TEXT NOT NULL DEFAULT '!',
  category_id     TEXT,
  join_channel_id TEXT,
  dashboard_channel_id TEXT,
  dashboard_message_id TEXT,
  deletion_delay INTEGER NOT NULL DEFAULT 60,
  name_template TEXT NOT NULL DEFAULT '🔊 {user}''s Channel',
  welcome_sent_at INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS temp_channels (
  channel_id   TEXT PRIMARY KEY,
  guild_id     TEXT NOT NULL,
  owner_id     TEXT NOT NULL,
  locked       INTEGER NOT NULL DEFAULT 0,
  wait_room    INTEGER NOT NULL DEFAULT 0,
  topic        TEXT,
  empty_since  INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  status     TEXT NOT NULL, -- 'trusted' | 'blocked'
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS web_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  avatar        TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS command_rules (
  guild_id TEXT NOT NULL,
  command  TEXT NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, command)
);

CREATE TABLE IF NOT EXISTS command_access (
  guild_id  TEXT NOT NULL,
  command   TEXT NOT NULL,
  kind      TEXT NOT NULL, -- 'role' | 'member'
  target_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, command, kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_temp_channels_guild ON temp_channels(guild_id);
CREATE INDEX IF NOT EXISTS idx_temp_channels_owner ON temp_channels(owner_id);
`);

/**
 * Lightweight migrations for Voicey installations created before per-server
 * prefixes and join-welcome tracking were added.
 */
for (const statement of [
  `ALTER TABLE guild_settings ADD COLUMN prefix TEXT NOT NULL DEFAULT '!'`,
  `ALTER TABLE guild_settings ADD COLUMN welcome_sent_at INTEGER`,
  `ALTER TABLE guild_settings ADD COLUMN deletion_delay INTEGER NOT NULL DEFAULT 60`,
  `ALTER TABLE guild_settings ADD COLUMN name_template TEXT NOT NULL DEFAULT '🔊 {user}''s Channel'`,
  `ALTER TABLE temp_channels ADD COLUMN empty_since INTEGER`,
]) {
  try {
    db.exec(statement);
  } catch (err) {
    if (!String(err?.message ?? '').toLowerCase().includes('duplicate column')) throw err;
  }
}

const plain = (row) => (row ? { ...row } : undefined);
const plainAll = (rows) => rows.map((r) => ({ ...r }));

// ---------- guild settings ----------

const DEFAULT_PREFIX = process.env.BOT_PREFIX?.trim() || '!';

const upsertGuildStmt = db.prepare(`
  INSERT INTO guild_settings (guild_id, language, prefix)
  VALUES (@guildId, 'en', @prefix)
  ON CONFLICT(guild_id) DO NOTHING
`);

export function ensureGuild(guildId) {
  upsertGuildStmt.run({ guildId, prefix: DEFAULT_PREFIX });
  return getGuildSettings(guildId);
}

export function getGuildSettings(guildId) {
  return plain(db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId));
}

export function setGuildLanguage(guildId, language) {
  ensureGuild(guildId);
  db.prepare('UPDATE guild_settings SET language = ? WHERE guild_id = ?').run(language, guildId);
}

export function setGuildPrefix(guildId, prefix) {
  ensureGuild(guildId);
  db.prepare('UPDATE guild_settings SET prefix = ? WHERE guild_id = ?').run(prefix, guildId);
}


export function setGuildDeletionDelay(guildId, seconds) {
  ensureGuild(guildId);
  db.prepare('UPDATE guild_settings SET deletion_delay = ? WHERE guild_id = ?').run(seconds, guildId);
}

export function setGuildNameTemplate(guildId, template) {
  ensureGuild(guildId);
  db.prepare('UPDATE guild_settings SET name_template = ? WHERE guild_id = ?').run(template, guildId);
}

export function markWelcomeSent(guildId) {
  ensureGuild(guildId);
  db.prepare('UPDATE guild_settings SET welcome_sent_at = unixepoch() WHERE guild_id = ?').run(guildId);
}

export function clearWelcomeSent(guildId) {
  ensureGuild(guildId);
  db.prepare('UPDATE guild_settings SET welcome_sent_at = NULL WHERE guild_id = ?').run(guildId);
}

export function saveSetup(guildId, { categoryId, joinChannelId, dashboardChannelId, dashboardMessageId }) {
  ensureGuild(guildId);
  db.prepare(
    `UPDATE guild_settings
     SET category_id = ?, join_channel_id = ?, dashboard_channel_id = ?, dashboard_message_id = ?
     WHERE guild_id = ?`,
  ).run(categoryId, joinChannelId, dashboardChannelId, dashboardMessageId, guildId);
}

/** Forget the Join-to-Create setup for a guild (keeps its language). */
export function clearSetup(guildId) {
  db.prepare(
    `UPDATE guild_settings
     SET category_id = NULL, join_channel_id = NULL,
         dashboard_channel_id = NULL, dashboard_message_id = NULL
     WHERE guild_id = ?`,
  ).run(guildId);
}

export function setGuildCategory(guildId, categoryId) {
  db.prepare('UPDATE guild_settings SET category_id = ? WHERE guild_id = ?').run(categoryId, guildId);
}

// ---------- temp channels ----------

export function createTempChannel(channelId, guildId, ownerId) {
  db.prepare(
    'INSERT INTO temp_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)',
  ).run(channelId, guildId, ownerId);
}

export function getTempChannel(channelId) {
  return plain(db.prepare('SELECT * FROM temp_channels WHERE channel_id = ?').get(channelId));
}

export function getTempChannelByOwner(guildId, ownerId) {
  return plain(
    db.prepare('SELECT * FROM temp_channels WHERE guild_id = ? AND owner_id = ?').get(guildId, ownerId),
  );
}

export function deleteTempChannel(channelId) {
  db.prepare('DELETE FROM temp_channels WHERE channel_id = ?').run(channelId);
  db.prepare('DELETE FROM channel_members WHERE channel_id = ?').run(channelId);
}

export function setChannelOwner(channelId, ownerId) {
  db.prepare('UPDATE temp_channels SET owner_id = ? WHERE channel_id = ?').run(ownerId, channelId);
}

export function setChannelLocked(channelId, locked) {
  db.prepare('UPDATE temp_channels SET locked = ? WHERE channel_id = ?').run(locked ? 1 : 0, channelId);
}

export function setChannelWaitRoom(channelId, enabled) {
  db.prepare('UPDATE temp_channels SET wait_room = ? WHERE channel_id = ?').run(
    enabled ? 1 : 0,
    channelId,
  );
}

export function setChannelTopic(channelId, topic) {
  db.prepare('UPDATE temp_channels SET topic = ? WHERE channel_id = ?').run(topic, channelId);
}

export function setTempChannelEmptySince(channelId, timestamp) {
  db.prepare('UPDATE temp_channels SET empty_since = ? WHERE channel_id = ?').run(timestamp, channelId);
}

export function tempChannelsForGuild(guildId) {
  return plainAll(db.prepare('SELECT * FROM temp_channels WHERE guild_id = ?').all(guildId));
}

export function allTempChannels() {
  return plainAll(db.prepare('SELECT * FROM temp_channels').all());
}

// ---------- per-channel member status (trusted / blocked) ----------

export function setMemberStatus(channelId, userId, status) {
  db.prepare(
    `INSERT INTO channel_members (channel_id, user_id, status)
     VALUES (?, ?, ?)
     ON CONFLICT(channel_id, user_id) DO UPDATE SET status = excluded.status`,
  ).run(channelId, userId, status);
}

export function clearMemberStatus(channelId, userId) {
  db.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').run(
    channelId,
    userId,
  );
}

export function getMemberStatus(channelId, userId) {
  const row = db
    .prepare('SELECT status FROM channel_members WHERE channel_id = ? AND user_id = ?')
    .get(channelId, userId);
  return row?.status ?? null;
}

export function getMembersByStatus(channelId, status) {
  return db
    .prepare('SELECT user_id FROM channel_members WHERE channel_id = ? AND status = ?')
    .all(channelId, status)
    .map((r) => r.user_id);
}

// ---------- dashboard web sessions ----------

export function createWebSession(s) {
  db.prepare(
    `INSERT INTO web_sessions (id, user_id, username, avatar, access_token, refresh_token, expires_at)
     VALUES (@id, @userId, @username, @avatar, @accessToken, @refreshToken, @expiresAt)`,
  ).run({ refreshToken: null, avatar: null, ...s });
}

export function getWebSession(id) {
  return plain(db.prepare('SELECT * FROM web_sessions WHERE id = ?').get(id));
}

export function updateWebSessionTokens(id, { accessToken, refreshToken, expiresAt }) {
  db.prepare(
    'UPDATE web_sessions SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?',
  ).run(accessToken, refreshToken ?? null, expiresAt, id);
}

export function deleteWebSession(id) {
  db.prepare('DELETE FROM web_sessions WHERE id = ?').run(id);
}

export function purgeOldWebSessions(maxAgeSeconds) {
  db.prepare('DELETE FROM web_sessions WHERE created_at < unixepoch() - ?').run(maxAgeSeconds);
}

// ---------- per-server command rules (enable/disable + role/member access) ----------

/** { enabled, roles: [roleId], members: [userId] } for one command (defaults when nothing is stored). */
export function getCommandRule(guildId, command) {
  const row = db
    .prepare('SELECT enabled FROM command_rules WHERE guild_id = ? AND command = ?')
    .get(guildId, command);
  const access = db
    .prepare('SELECT kind, target_id FROM command_access WHERE guild_id = ? AND command = ?')
    .all(guildId, command);
  return {
    enabled: row ? row.enabled === 1 : true,
    roles: access.filter((a) => a.kind === 'role').map((a) => a.target_id),
    members: access.filter((a) => a.kind === 'member').map((a) => a.target_id),
  };
}

/** Every stored rule of a guild, keyed by command name. Commands without rows use defaults. */
export function getGuildCommandRules(guildId) {
  const rules = {};
  const entry = (c) => (rules[c] ??= { enabled: true, roles: [], members: [] });
  for (const r of db.prepare('SELECT command, enabled FROM command_rules WHERE guild_id = ?').all(guildId)) {
    entry(r.command).enabled = r.enabled === 1;
  }
  for (const a of db
    .prepare('SELECT command, kind, target_id FROM command_access WHERE guild_id = ?')
    .all(guildId)) {
    entry(a.command)[a.kind === 'role' ? 'roles' : 'members'].push(a.target_id);
  }
  return rules;
}

export function setCommandRule(guildId, command, { enabled, roles, members }) {
  db.exec('BEGIN');
  try {
    if (enabled) {
      db.prepare('DELETE FROM command_rules WHERE guild_id = ? AND command = ?').run(guildId, command);
    } else {
      db.prepare(
        `INSERT INTO command_rules (guild_id, command, enabled) VALUES (?, ?, 0)
         ON CONFLICT(guild_id, command) DO UPDATE SET enabled = 0`,
      ).run(guildId, command);
    }
    db.prepare('DELETE FROM command_access WHERE guild_id = ? AND command = ?').run(guildId, command);
    const ins = db.prepare(
      'INSERT OR IGNORE INTO command_access (guild_id, command, kind, target_id) VALUES (?, ?, ?, ?)',
    );
    for (const id of roles) ins.run(guildId, command, 'role', id);
    for (const id of members) ins.run(guildId, command, 'member', id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function resetGuildCommandRules(guildId) {
  db.prepare('DELETE FROM command_rules WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM command_access WHERE guild_id = ?').run(guildId);
}
