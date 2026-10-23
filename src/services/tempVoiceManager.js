import {
  ChannelType,
  OverwriteType,
  PermissionFlags,
  EmbedBuilder,
} from '@fluxerjs/core';

import {
  getGuildSettings,
  createTempChannel,
  getTempChannel,
  getTempChannelByOwner,
  deleteTempChannel,
  setChannelOwner,
  setGuildCategory,
  setTempChannelEmptySince,
  tempChannelsForGuild,
} from '../db/index.js';

import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { postDashboard } from './dashboard.js';

import {
  getUserVoiceChannelId,
  getUserConnectionId,
  countMembersInChannel,
  hasGuildState,
} from './voiceState.js';

/**
 * Grace period for a newly-created temporary channel.
 *
 * The channel is not deleted immediately if the move takes a moment.
 */
export const NEW_CHANNEL_GRACE_MS = 60_000;

const MAX_CHANNEL_NAME_LENGTH = 32;

function formatChannelName(template, displayName, memberCount = 1) {
  const safeName = String(displayName || 'user').trim() || 'user';
  const rendered = String(template || '🔊 {user}\'s Channel')
    .replaceAll('{user}', safeName)
    .replaceAll('{username}', safeName)
    .replaceAll('{count}', String(memberCount));
  // Array.from keeps emoji (surrogate pairs) intact when truncating.
  return Array.from(rendered).slice(0, MAX_CHANNEL_NAME_LENGTH).join('') || `🔊 ${safeName}'s Channel`;
}

/**
 * Prevents duplicate channel creation if multiple voice events arrive
 * while the same member is being moved.
 */
const creating = new Set();

/**
 * Creates a short description for API/SDK errors.
 */
export function describeError(err) {
  const parts = [
    err?.code,
    err?.statusCode,
    err?.message,
  ].filter(Boolean);

  const detail = Array.isArray(err?.errors)
    ? err.errors
        .map(
          (e) =>
            `${e.path ?? '?'}: ${e.message ?? e.code}`,
        )
        .join('; ')
    : '';

  return (
    parts.join(' | ') +
    (detail ? ` [${detail}]` : '')
  );
}

/**
 * Moves or disconnects a member.
 *
 * Fluxer voice sessions can provide a connection_id, so we try that first.
 */
export async function moveMember(guild, userId, channelId) {
  // Fluxer does not allow bots to move the actual server owner. A user who
  // owns a Voicey temporary channel is otherwise a normal member and MUST
  // still be moved. Do not confuse temp-channel ownership with guild ownership.
  if (guild.ownerId === userId) return false;

  const connectionId = getUserConnectionId(guild.id, userId);
  const attempts = connectionId
    ? [undefined, connectionId]
    : [undefined];

  for (const connection of attempts) {
    const member =
      guild.members.get(userId) ??
      (await guild.fetchMember(userId).catch(() => null));

    if (!member) return false;

    try {
      // The normal member move does not need a connection id. Try that first
      // because stale connection IDs can make an otherwise valid move fail.
      await member.move(channelId, connection);

      if (!channelId) return true;

      // Give the gateway a moment to publish the new voice state, then verify
      // that the member actually arrived. This prevents a false success.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (getUserVoiceChannelId(guild.id, userId) === channelId) {
          return true;
        }
      }

      // The API accepted the move but the gateway snapshot has not caught up
      // yet. Treat the API call as successful rather than repeatedly moving.
      return true;
    } catch (err) {
      console.warn(
        `[Voicey] Failed to move ${userId} to ${channelId}${connection ? ` (connection ${connection})` : ''}:`,
        describeError(err),
      );
    }
  }

  return false;
}

/**
 * VoiceStateUpdate handler.
 */
export async function handleVoiceStateUpdate(client, data) {
  const guildId = data?.guild_id;

  if (!guildId) return;

  const settings = getGuildSettings(guildId);

  if (!settings?.join_channel_id) return;

  const guild =
    client.guilds.get(guildId) ??
    (await client.guilds
      .fetch(guildId)
      .catch(() => null));

  if (!guild) return;

  const userId = data.user_id;
  const newChannelId = data.channel_id ?? null;
  const isBot = Boolean(data.member?.user?.bot ?? data.user?.bot);

  /**
   * User entered Join-to-Create.
   */
  if (newChannelId === settings.join_channel_id && !isBot) {
    const key = `${guildId}:${userId}`;

    if (!creating.has(key)) {
      creating.add(key);

      try {
        await createChannelForUser(
          client,
          guild,
          settings,
          userId,
        );
      } finally {
        creating.delete(key);
      }
    }
  }

  /**
   * Every voice event is an opportunity to clean up
   * empty temporary channels.
   */
  await sweepEmptyChannels(client, guild);
}

/**
 * Resolve the category where temporary channels should be created.
 */
async function resolveParentId(client, guild, settings) {
  if (!settings.category_id) {
    return undefined;
  }

  const category =
    client.channels.get(settings.category_id) ??
    (await client.channels
      .fetch(settings.category_id)
      .catch(() => null));

  if (category) {
    return settings.category_id;
  }

  setGuildCategory(guild.id, null);

  return undefined;
}

/**
 * Creates a voice channel.
 *
 * If the saved category disappeared, retry without it.
 */
async function createVoiceChannel(guild, options, parentId) {
  try {
    return await guild.createChannel({
      ...options,
      parentId,
    });
  } catch (err) {
    // Only retry without a parent when the saved category is invalid.
    // Permission/network errors should be surfaced instead of hidden.
    const code = String(err?.code ?? '');
    const message = String(err?.message ?? '').toLowerCase();
    const invalidParent =
      code === 'INVALID_FORM_BODY' ||
      code === 'INVALID_CHANNEL_TYPE' ||
      (message.includes('parent') && message.includes('invalid'));

    if (parentId && invalidParent) {
      return guild.createChannel({
        ...options,
        parentId: undefined,
      });
    }

    throw err;
  }
}

/**
 * Creates a temporary channel for a member.
 */
async function createChannelForUser(
  client,
  guild,
  settings,
  userId,
) {
  /**
   * Never create two temporary channels for the same owner.
   */
  const existing = getTempChannelByOwner(
    guild.id,
    userId,
  );

  if (existing) {
    const existingChannel =
      client.channels.get(existing.channel_id) ??
      (await client.channels
        .fetch(existing.channel_id)
        .catch(() => null));

    if (existingChannel) {
      await moveMember(
        guild,
        userId,
        existing.channel_id,
      );

      return;
    }

    deleteTempChannel(existing.channel_id);
  }

  const member =
    guild.members.get(userId) ??
    (await guild.fetchMember(userId).catch(() => null));

  const displayName =
    member?.displayName ?? 'user';

  const parentId = await resolveParentId(
    client,
    guild,
    settings,
  );

  const channel = await createVoiceChannel(
    guild,
    {
      type: ChannelType.GuildVoice,
      name: formatChannelName(
        settings.name_template ||
          t(settings.language, 'setup.default_channel_name', { name: displayName }),
        displayName,
        1,
      ),
      userLimit: 0,
    },
    parentId,
  );

  /**
   * Store immediately so the channel can be cleaned even
   * if a later operation fails.
   */
  createTempChannel(
    channel.id,
    guild.id,
    userId,
  );

  // Explicitly grant the temporary-channel owner access. This is important
  // when the server's default role/channel permissions deny Connect or View
  // Channel; ownership must never prevent the owner from entering their room.
  await channel.permissionOverwrites.edit(userId, {
    type: OverwriteType.Member,
    allow: [PermissionFlags.Connect, PermissionFlags.ViewChannel],
    deny: [],
  }).catch((err) => {
    console.warn(
      `[Voicey] Failed to grant temp-channel owner access for ${userId}:`,
      describeError(err),
    );
  });

  const isGuildOwner = guild.ownerId === userId;

  /**
   * A temporary-channel owner must be moved just like every other member.
   * The only user Fluxer refuses to move is the actual server owner.
   */
  if (isGuildOwner) {
    const joinNotice = new EmbedBuilder()
      .setTitle(`${Emojis.voicey} Voice channel ready`)
      .setDescription(
        `Your temporary channel ${
          channel.toString?.() ?? `<#${channel.id}>`
        } is ready.\n\n` +
        `Please join it manually because Fluxer does not allow bots to move the server owner.`,
      )
      .setColor(0x4641d9);

    const joinChannel =
      client.channels.get(settings.join_channel_id) ??
      (await client.channels.fetch(settings.join_channel_id).catch(() => null));

    await joinChannel?.send?.({ embeds: [joinNotice] }).catch(() => {});
  } else {
    let moved = await moveMember(guild, userId, channel.id);

    // Voice state/API propagation can lag immediately after channel creation.
    // Give Fluxer a short second chance before declaring the move failed.
    if (!moved) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      moved = await moveMember(guild, userId, channel.id);
    }

    if (!moved) {
      const joinNotice = new EmbedBuilder()
        .setTitle(`${Emojis.voicey} Voice channel ready`)
        .setDescription(
          `Your temporary channel ${
            channel.toString?.() ?? `<#${channel.id}>`
          } is ready, but Voicey could not move you automatically. ` +
          `Please join it manually.`,
        )
        .setColor(0x4641d9);

      await channel.send({ embeds: [joinNotice] }).catch(() => {});
    }
  }

  /**
   * The control panel is informational.
   *
   * Its image is now a remote URL, so no file upload
   * / ATTACH_FILES permission is needed.
   */
  await postDashboard(
    client,
    channel,
    settings.language,
    settings.prefix ?? '!',
  ).catch(() => {});

  /**
   * If the member was not successfully moved or left
   * immediately, clean the empty channel later.
   */
  setTimeout(() => {
    sweepEmptyChannels(
      client,
      guild,
    ).catch(() => {});
  }, NEW_CHANNEL_GRACE_MS + 2_000).unref?.();
}

/**
 * Deletes temporary channels that are confirmed empty.
 */
export async function sweepEmptyChannels(
  client,
  guild,
) {
  /**
   * Never delete anything if we haven't received a complete
   * voice-state snapshot for this guild.
   */
  if (!hasGuildState(guild.id)) {
    return;
  }

  const now = Date.now();

  for (const row of tempChannelsForGuild(
    guild.id,
  )) {
    const channel =
      client.channels.get(row.channel_id) ??
      (await client.channels
        .fetch(row.channel_id)
        .catch(() => null));

    /**
     * The channel was manually deleted.
     */
    if (!channel) {
      deleteTempChannel(row.channel_id);
      continue;
    }

    /**
     * Don't immediately delete a newly-created channel.
     */
    if (
      now - row.created_at * 1000 <
      NEW_CHANNEL_GRACE_MS
    ) {
      continue;
    }

    let memberCount = countMembersInChannel(guild, row.channel_id);

    // The dashboard and cleanup must never treat a temporary channel as
    // empty just because a voice-state snapshot briefly lagged behind.
    // The owner is a safe fallback: a temp channel cannot be considered
    // empty while its recorded owner is still in that channel.
    if (
      memberCount === 0 &&
      getUserVoiceChannelId(guild.id, row.owner_id) === row.channel_id
    ) {
      memberCount = 1;
    }

    if (memberCount !== 0) {
      if (row.empty_since) {
        setTempChannelEmptySince(row.channel_id, null);
      }
      continue;
    }

    const settings = getGuildSettings(guild.id);
    const delaySeconds = Math.max(0, Number(settings?.deletion_delay ?? 60));
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (!row.empty_since) {
      setTempChannelEmptySince(row.channel_id, nowSeconds);

      if (delaySeconds > 0) {
        setTimeout(() => {
          sweepEmptyChannels(client, guild).catch(() => {});
        }, (delaySeconds + 1) * 1000).unref?.();
        continue;
      }
    }

    if (nowSeconds - (row.empty_since ?? nowSeconds) < delaySeconds) {
      continue;
    }

    /**
     * Only remove the DB row after the API deletion succeeds.
     */
    try {
      await channel.delete();
      deleteTempChannel(row.channel_id);
    } catch {
      // Keep the DB row so a later sweep can retry.
    }
  }
}

/**
 * Resolve a temporary channel owned by a member.
 */
export function resolveOwnedChannel(
  guildId,
  userId,
) {
  return getTempChannelByOwner(
    guildId,
    userId,
  );
}

/**
 * Resolve the temporary channel the member
 * is currently inside.
 */
export function resolveCurrentChannel(
  guild,
  userId,
) {
  const channelId =
    getUserVoiceChannelId(
      guild.id,
      userId,
    );

  return channelId
    ? getTempChannel(channelId)
    : null;
}

/**
 * Transfer ownership.
 */
export async function transferOwnership(
  client,
  guild,
  tempChannel,
  newOwnerId,
) {
  const previousOwnerId =
    tempChannel.owner_id;

  setChannelOwner(
    tempChannel.channel_id,
    newOwnerId,
  );

  const channel =
    client.channels.get(
      tempChannel.channel_id,
    ) ??
    (await client.channels
      .fetch(tempChannel.channel_id)
      .catch(() => null));

  if (!channel) return;

  if (
    previousOwnerId &&
    previousOwnerId !== newOwnerId
  ) {
    await channel.permissionOverwrites
      .delete(previousOwnerId)
      .catch(() => {});
  }

  /**
   * Ownership permissions are deliberately limited.
   * Voicey performs channel management itself.
   */
  if (guild.ownerId !== newOwnerId) {
    await channel.permissionOverwrites
      .edit(newOwnerId, {
        type: OverwriteType.Member,
        allow: [
          PermissionFlags.Connect,
          PermissionFlags.ViewChannel,
        ],
      })
      .catch(() => {});
  }
}

export function buildErrorEmbed(
  locale,
  key,
  vars = {},
) {
  const prefix =
    vars.prefix ??
    process.env.BOT_PREFIX?.trim() ??
    '!';

  return new EmbedBuilder()
    .setDescription(
      `${Emojis.error} ${t(
        locale,
        key,
        {
          ...vars,
          prefix,
        },
      )}`,
    )
    .setColor(0x4641d9);
}

export function buildSuccessEmbed(
  locale,
  key,
  vars = {},
) {
  const prefix =
    vars.prefix ??
    process.env.BOT_PREFIX?.trim() ??
    '!';

  return new EmbedBuilder()
    .setDescription(
      `${Emojis.success} ${t(
        locale,
        key,
        {
          ...vars,
          prefix,
        },
      )}`,
    )
    .setColor(0x4641d9);
}