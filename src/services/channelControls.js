import { OverwriteType, PermissionFlags } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { askConfirm } from '../utils/confirm.js';
import {
  getTempChannel,
  setChannelLocked,
  setMemberStatus,
  clearMemberStatus,
  getMemberStatus,
  deleteTempChannel,
} from '../db/index.js';
import { buildErrorEmbed, buildSuccessEmbed, transferOwnership, moveMember } from './tempVoiceManager.js';
import { isUserInChannel } from './voiceState.js';

/**
 * Every function here takes the same `ctx` shape:
 *   { client, guild, channel, member, tempChannel, locale, args? }
 * and replies in the temporary voice channel.
 *
 * Ownership rule: unless noted, only tempChannel.owner_id may act.
 */

function isOwner(ctx) {
  return ctx.member.id === ctx.tempChannel.owner_id;
}

async function reply(ctx, embed) {
  await ctx.channel.send({ embeds: [embed] }).catch(() => {});
}

function error(ctx, key, vars = {}) {
  return buildErrorEmbed(ctx.locale, key, { ...vars, prefix: ctx.prefix });
}

function success(ctx, key, vars = {}) {
  return buildSuccessEmbed(ctx.locale, key, { ...vars, prefix: ctx.prefix });
}

function requireOwner(ctx) {
  if (isOwner(ctx)) return true;
  reply(ctx, error(ctx, 'common.not_owner'));
  return false;
}

// ---------------- individual actions ----------------

export async function rename(ctx, nameArg) {
  if (!requireOwner(ctx)) return;
  const name = nameArg?.trim();
  if (!name) return reply(ctx, error(ctx, 'name.usage'));
  if (name.length > 32) return reply(ctx, error(ctx, 'name.too_long'));

  try {
    await ctx.channel.edit({ name });
    await reply(ctx, success(ctx, 'name.success', { name }));
  } catch (err) {
    // The SDK already retries rate-limited requests; if one still fails
    // (e.g. Fluxer's channel-rename cooldown) tell the user instead of crashing.
    if (err?.name === 'RateLimitError' || err?.status === 429) {
      return reply(ctx, error(ctx, 'name.rate_limited'));
    }
    throw err;
  }
}

export async function limit(ctx, limitArg) {
  if (!requireOwner(ctx)) return;
  const n = Number(limitArg);
  if (limitArg === undefined || Number.isNaN(n)) {
    return reply(ctx, error(ctx, 'limit.usage'));
  }
  if (!Number.isInteger(n) || n < 0 || n > 99) return reply(ctx, error(ctx, 'limit.out_of_range'));

  await ctx.channel.edit({ userLimit: n });
  if (n === 0) {
    await reply(ctx, success(ctx, 'limit.success_unlimited'));
  } else {
    await reply(ctx, success(ctx, 'limit.success', { limit: n }));
  }
}

export async function privacy(ctx, modeArg) {
  if (!requireOwner(ctx)) return;
  let lock;
  if (modeArg === 'lock') lock = true;
  else if (modeArg === 'unlock') lock = false;
  else if (modeArg === undefined) lock = !ctx.tempChannel.locked;
  else return reply(ctx, error(ctx, 'privacy.usage'));

  if (lock) {
    await ctx.channel.permissionOverwrites.edit(ctx.guild.id, {
      type: OverwriteType.Role, // @everyone role id === guild id
      deny: [PermissionFlags.Connect],
      allow: [],
    });
  } else {
    // Remove the overwrite instead of explicitly allowing Connect, so the
    // channel goes back to inheriting the category/server rules rather than
    // becoming open to everyone.
    await ctx.channel.permissionOverwrites.delete(ctx.guild.id).catch(() => {});
  }

  setChannelLocked(ctx.channel.id, lock);
  await reply(ctx, success(ctx, lock ? 'privacy.locked' : 'privacy.unlocked'));
}

export async function trust(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'add.usage'));
  if (targetId === ctx.member.id) return reply(ctx, error(ctx, 'add.cannot_add_self'));

  clearMemberStatus(ctx.channel.id, targetId); // clear any prior block
  setMemberStatus(ctx.channel.id, targetId, 'trusted');

  await ctx.channel.permissionOverwrites.edit(targetId, {
    type: OverwriteType.Member,
    allow: [PermissionFlags.Connect, PermissionFlags.ViewChannel],
  });

  await reply(ctx, success(ctx, 'add.success', { user: `<@${targetId}>` }));
}

export async function untrust(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'unblock.usage'));
  clearMemberStatus(ctx.channel.id, targetId);
  await ctx.channel.permissionOverwrites.delete(targetId).catch(() => {});
}

export async function block(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'block.usage'));
  if (targetId === ctx.tempChannel.owner_id) {
    return reply(ctx, error(ctx, 'block.cannot_block_owner'));
  }
  if (targetId === ctx.guild.ownerId) {
    return reply(ctx, error(ctx, 'common.cannot_move_server_owner'));
  }
  if (targetId === ctx.member.id) return reply(ctx, error(ctx, 'block.cannot_block_self'));

  setMemberStatus(ctx.channel.id, targetId, 'blocked');

  await ctx.channel.permissionOverwrites.edit(targetId, {
    type: OverwriteType.Member,
    deny: [PermissionFlags.Connect, PermissionFlags.ViewChannel],
  });

  // Kick them out immediately if they're currently connected.
  if (isUserInChannel(ctx.guild.id, targetId, ctx.channel.id)) {
    await moveMember(ctx.guild, targetId, null);
  }

  await reply(ctx, success(ctx, 'block.success', { user: `<@${targetId}>` }));
}

export async function unblock(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'unblock.usage'));

  const status = getMemberStatus(ctx.channel.id, targetId);
  if (status !== 'blocked') {
    return reply(ctx, error(ctx, 'unblock.not_blocked', { user: `<@${targetId}>` }));
  }

  clearMemberStatus(ctx.channel.id, targetId);
  await ctx.channel.permissionOverwrites.delete(targetId).catch(() => {});
  await reply(ctx, success(ctx, 'unblock.success', { user: `<@${targetId}>` }));
}

export async function invite(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'invite.usage'));

  const targetMember = ctx.guild.members.get(targetId) ??
    (await ctx.guild.fetchMember(targetId).catch(() => null));
  if (!targetMember) return reply(ctx, error(ctx, 'common.error'));

  // Auto-trust invited users so they can get straight in.
  clearMemberStatus(ctx.channel.id, targetId);
  setMemberStatus(ctx.channel.id, targetId, 'trusted');
  await ctx.channel.permissionOverwrites.edit(targetId, {
    type: OverwriteType.Member,
    allow: [PermissionFlags.Connect, PermissionFlags.ViewChannel],
  });

  let inviteUrl = null;
  try {
    const inv = await ctx.channel.createInvite({
      maxAge: 3600,
      maxUses: 1,
    });
    inviteUrl = inv?.url ?? null;
  } catch (err) {
    console.warn('[Voicey] Could not create channel invite:', err?.message ?? err);
  }

  const dmText = t(ctx.locale, 'invite.dm_sent', {
    inviter: `<@${ctx.member.id}>`,
    channel: ctx.channel.toString?.() ?? `<#${ctx.channel.id}>`,
    link: inviteUrl ?? `<#${ctx.channel.id}>`,
  });

  try {
    const dm = await targetMember.user.createDM?.();
    await dm?.send?.(dmText);
    await reply(ctx, success(ctx, 'invite.success', {
      user: `<@${targetId}>`,
      link: inviteUrl ?? `<#${ctx.channel.id}>`,
    }));
  } catch {
    if (inviteUrl) {
      await reply(
        ctx,
        error(ctx, 'invite.dm_failed', { user: `<@${targetId}>`, link: inviteUrl }),
      );
      return;
    }

    await reply(ctx, error(ctx, 'invite.failed', { user: `<@${targetId}>` }));
  }
}

export async function kick(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'kick.usage'));

  const inChannel = isUserInChannel(ctx.guild.id, targetId, ctx.channel.id);

  if (!inChannel) {
    return reply(ctx, error(ctx, 'kick.user_not_in_channel', { user: `<@${targetId}>` }));
  }

  if (targetId === ctx.guild.ownerId) {
    return reply(ctx, error(ctx, 'common.cannot_move_server_owner'));
  }

  const removed = await moveMember(ctx.guild, targetId, null);
  if (!removed) return reply(ctx, error(ctx, 'common.error'));
  await reply(ctx, success(ctx, 'kick.success', { user: `<@${targetId}>` }));
}

export async function ban(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'ban.usage'));
  if (targetId === ctx.tempChannel.owner_id) {
    return reply(ctx, error(ctx, 'block.cannot_block_owner'));
  }
  if (targetId === ctx.member.id) return reply(ctx, error(ctx, 'block.cannot_block_self'));
  if (targetId === ctx.guild.ownerId) {
    return reply(ctx, error(ctx, 'common.cannot_move_server_owner'));
  }

  setMemberStatus(ctx.channel.id, targetId, 'blocked');
  await ctx.channel.permissionOverwrites.edit(targetId, {
    type: OverwriteType.Member,
    deny: [PermissionFlags.Connect, PermissionFlags.ViewChannel],
  });
  if (isUserInChannel(ctx.guild.id, targetId, ctx.channel.id)) {
    const removed = await moveMember(ctx.guild, targetId, null);
    if (!removed) return reply(ctx, error(ctx, 'common.error'));
  }
  await reply(ctx, success(ctx, 'ban.success', { user: `<@${targetId}>` }));
}

export async function unban(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'unban.usage'));
  const status = getMemberStatus(ctx.channel.id, targetId);
  if (status !== 'blocked') {
    return reply(ctx, error(ctx, 'unblock.not_blocked', { user: `<@${targetId}>` }));
  }
  clearMemberStatus(ctx.channel.id, targetId);
  await ctx.channel.permissionOverwrites.delete(targetId).catch(() => {});
  await reply(ctx, success(ctx, 'unban.success', { user: `<@${targetId}>` }));
}

export async function claim(ctx) {
  const currentOwnerInChannel = isUserInChannel(
    ctx.guild.id,
    ctx.tempChannel.owner_id,
    ctx.channel.id,
  );

  if (currentOwnerInChannel && ctx.tempChannel.owner_id !== ctx.member.id) {
    return reply(ctx, error(ctx, 'claim.owner_present'));
  }

  await transferOwnership(ctx.client, ctx.guild, ctx.tempChannel, ctx.member.id);
  await reply(ctx, success(ctx, 'claim.success', { user: `<@${ctx.member.id}>` }));
}

export async function transfer(ctx, targetId) {
  if (!requireOwner(ctx)) return;
  if (!targetId) return reply(ctx, error(ctx, 'transfer.usage'));

  const inChannel = isUserInChannel(ctx.guild.id, targetId, ctx.channel.id);

  if (!inChannel) {
    return reply(
      ctx,
      error(ctx, 'transfer.target_not_in_channel', { user: `<@${targetId}>` }),
    );
  }

  await transferOwnership(ctx.client, ctx.guild, ctx.tempChannel, targetId);
  await reply(ctx, success(ctx, 'transfer.success', { user: `<@${targetId}>` }));
}

export async function del(ctx) {
  if (!requireOwner(ctx)) return;

  const prompt = await ctx.channel.send({
    embeds: [
      error(ctx, 'delete.confirm', {
        success: Emojis.success,
        error: Emojis.error,
      }),
    ],
  });

  const { result, reactFailed } = await askConfirm(prompt, {
    userId: ctx.member.id,
    yes: Emojis.success,
    no: Emojis.error,
    time: 20_000,
  });

  if (reactFailed) {
    await reply(ctx, error(ctx, 'common.cannot_react'));
  }

  if (result === 'yes') {
    try {
      await ctx.channel.delete();
      deleteTempChannel(ctx.channel.id);
    } catch (err) {
      // Keep the DB row so the channel isn't orphaned and can still be cleaned up.
      console.warn('[Voicey] Could not delete temp channel:', err?.message ?? err);
      await reply(ctx, error(ctx, 'common.error'));
    }
    return;
  }

  if (result === 'no') {
    await reply(ctx, success(ctx, 'delete.cancelled'));
    return;
  }

  await reply(ctx, error(ctx, 'common.cancelled'));
}
