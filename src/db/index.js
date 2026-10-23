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

// node:sqlite returns null-prototype rows; copy into plain objects so the rest
// of the bot behaves exactly as it did with any other driver.
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
