import { PermissionFlags } from '@fluxerjs/core';
import { getGuildSettings, getTempChannel, tempChannelsForGuild } from '../db/index.js';
import { hasGuildState } from './voiceState.js';

const CHECKS = [
  ['View Channel', PermissionFlags.ViewChannel],
  ['Send Messages', PermissionFlags.SendMessages],
  ['Embed Links', PermissionFlags.EmbedLinks],
  ['Manage Channels', PermissionFlags.ManageChannels],
  ['Manage Permissions', PermissionFlags.ManagePermissions],
  ['Move Members', PermissionFlags.MoveMembers],
  ['Create Invite', PermissionFlags.CreateInstantInvite],
  ['Connect', PermissionFlags.Connect],
  ['Add Reactions', PermissionFlags.AddReactions],
  ['Read Message History', PermissionFlags.ReadMessageHistory],
];

export async function getBotPermissionChecks(guild, channel = null) {
  const botMember =
    guild.members.me ??
    (await guild.fetchMember?.(guild.client?.user?.id).catch(() => null));

  if (!botMember) {
    return CHECKS.map(([name]) => ({ name, ok: false, reason: 'Bot member unavailable' }));
  }

  return CHECKS.map(([name, flag]) => {
    try {
      const permissions = channel && typeof botMember.permissionsIn === 'function'
        ? botMember.permissionsIn(channel)
        : botMember.permissions;
      return { name, ok: permissions?.has(flag) === true };
    } catch {
      return { name, ok: false };
    }
  });
}

export async function diagnoseGuild(guild, client) {
  const settings = getGuildSettings(guild.id);
  const joinChannel = settings?.join_channel_id
    ? client.channels.get(settings.join_channel_id) ??
      (await client.channels.fetch(settings.join_channel_id).catch(() => null))
    : null;

  const category = settings?.category_id
    ? client.channels.get(settings.category_id) ??
      (await client.channels.fetch(settings.category_id).catch(() => null))
    : null;

  const permissionChecks = await getBotPermissionChecks(guild, joinChannel);
  const configured = Boolean(settings?.join_channel_id && settings?.category_id);
  const channels = tempChannelsForGuild(guild.id);

  const checks = [
    { name: 'Database', ok: Boolean(settings) },
    { name: 'Join-to-Create setup', ok: configured },
    { name: 'Join channel exists', ok: Boolean(joinChannel) },
    { name: 'Category exists', ok: Boolean(category) },
    { name: 'Voice state sync', ok: hasGuildState(guild.id) },
    ...permissionChecks,
    { name: 'Temp channel records', ok: channels.every((row) => Boolean(getTempChannel(row.channel_id))) },
  ];

  const failed = checks.filter((check) => !check.ok);

  return {
    healthy: failed.length === 0,
    checks,
    failed,
    settings,
    tempChannelCount: channels.length,
  };
}
