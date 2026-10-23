import { Events } from '@fluxerjs/core';

/**
 * Tracks which voice channel each user is currently connected to.
 *
 * Shape:
 * Map<guildId, Map<userId, { channelId, connectionId }>>
 */
const voiceStates = new Map();

function guildMapFor(guildId) {
  let map = voiceStates.get(guildId);

  if (!map) {
    map = new Map();
    voiceStates.set(guildId, map);
  }

  return map;
}

function apply(map, userId, channelId, connectionId) {
  if (!userId) return;

  if (channelId) {
    map.set(String(userId), {
      channelId: String(channelId),
      connectionId: connectionId ?? null,
    });
  } else {
    map.delete(String(userId));
  }
}

function normalizeVoiceState(vs) {
  return {
    userId: vs?.user_id ?? vs?.userId ?? vs?.user?.id ?? null,
    channelId: vs?.channel_id ?? vs?.channelId ?? null,
    connectionId: vs?.connection_id ?? vs?.connectionId ?? null,
  };
}

export function initVoiceState(client) {
  /**
   * The gateway only sends VoiceStatesSync when at least one user is in voice.
   * A guild with nobody in voice therefore has no snapshot at all, which means
   * "empty", not "unknown". Mark the guild as known on GuildCreate so cleanup
   * of orphaned channels still works after a restart.
   */
  client.on(Events.GuildCreate, (guild) => {
    if (guild?.id && !voiceStates.has(String(guild.id))) {
      voiceStates.set(String(guild.id), new Map());
    }
  });

  /**
   * VoiceStatesSync is a complete snapshot.
   *
   * Replace the previous map instead of merging into it.
   * This prevents stale/ghost users after a reconnect.
   */
  client.on(Events.VoiceStatesSync, (data) => {
    const guildId = data?.guild_id ?? data?.guildId;
    if (!guildId) return;

    const map = new Map();
    voiceStates.set(String(guildId), map);

    const states =
      data?.voiceStates ??
      data?.voice_states ??
      data?.states ??
      [];

    for (const raw of states) {
      const vs = normalizeVoiceState(raw);
      apply(map, vs.userId, vs.channelId, vs.connectionId);
    }
  });

  /**
   * Registered before login so normal voice updates are tracked immediately.
   */
  client.on(Events.VoiceStateUpdate, (data) => {
    const guildId = data?.guild_id ?? data?.guildId;
    const vs = normalizeVoiceState(data);

    if (!guildId || !vs.userId) return;

    apply(
      guildMapFor(String(guildId)),
      vs.userId,
      vs.channelId,
      vs.connectionId,
    );
  });
}

export function getUserVoiceChannelId(guildId, userId) {
  return voiceStates.get(String(guildId))?.get(String(userId))?.channelId ?? null;
}

export function getUserConnectionId(guildId, userId) {
  return voiceStates.get(String(guildId))?.get(String(userId))?.connectionId ?? null;
}

export function isUserInChannel(guildId, userId, channelId) {
  return getUserVoiceChannelId(guildId, userId) === channelId;
}

export function hasGuildState(guildId) {
  return voiceStates.has(String(guildId));
}

/** Ids of every user currently connected to `channelId`. */
export function getUserIdsInChannel(guildId, channelId) {
  const map = voiceStates.get(String(guildId));
  if (!map) return [];
  const ids = [];
  for (const [userId, state] of map) {
    if (state.channelId === String(channelId)) ids.push(userId);
  }
  return ids;
}

export function countMembersInChannel(guild, channelId) {
  const map = voiceStates.get(String(guild.id));

  if (!map) return 0;

  let count = 0;

  for (const state of map.values()) {
    if (state.channelId === channelId) {
      count += 1;
    }
  }

  return count;
}

export function clearGuildVoiceState(guildId) {
  voiceStates.delete(String(guildId));
}