import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { askConfirm } from '../utils/confirm.js';
import { getGuildSettings, clearSetup, tempChannelsForGuild, deleteTempChannel } from '../db/index.js';

/** Delete a channel by id; a channel that's already gone counts as success. */
async function removeChannel(client, id) {
  if (!id) return;
  const channel = client.channels.get(id) ?? (await client.channels.fetch(id).catch(() => null));
  if (channel) await channel.delete().catch(() => {});
}

export default {
  name: 'delete-setup',
  aliases: ['deletesetup', 'resetsetup'],
  async execute({ client, message, locale, prefix }) {
    if (!message.guildId) return message.reply(t(locale, 'common.dm_only_in_guild'));

    const guild = await message.resolveGuild();
    if (!guild) return message.reply(t(locale, 'common.error'));

    const member = guild.members.get(message.author.id) ??
      (await guild.fetchMember(message.author.id).catch(() => null));
    const isOwner = guild.ownerId === message.author.id;
    if (!isOwner && !member?.permissions?.has(PermissionFlags.ManageGuild)) {
      return message.reply(t(locale, 'deletesetup.no_permission'));
    }

    const settings = getGuildSettings(guild.id);
    const temps = tempChannelsForGuild(guild.id);
    if (!settings?.join_channel_id && !settings?.category_id && temps.length === 0) {
      return message.reply(t(locale, 'deletesetup.nothing'));
    }

    const prompt = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(t(locale, 'deletesetup.title'))
          .setDescription(
            t(locale, 'deletesetup.confirm', {
              success: Emojis.success,
              error: Emojis.error,
              count: temps.length,
            }),
          )
          .setColor(0x4641d9),
      ],
    });

    const { result, reactFailed } = await askConfirm(prompt, {
      userId: message.author.id,
      yes: Emojis.success,
      no: Emojis.error,
      time: 60_000,
    });

    if (reactFailed) await message.reply(t(locale, 'common.cannot_react')).catch(() => {});
    if (result === 'timeout') return message.reply(t(locale, 'common.cancelled'));
    if (result === 'no') return message.reply(t(locale, 'deletesetup.declined'));

    try {
      // 1) every temp channel Voicey created (and forget them)
      for (const row of temps) {
        await removeChannel(client, row.channel_id);
        deleteTempChannel(row.channel_id);
      }

      // 2) the "Join to Create" channel, then the category Voicey made
      await removeChannel(client, settings?.join_channel_id);
      await removeChannel(client, settings?.category_id);

      // 3) the "setup complete" message, which now points at a deleted channel
      if (settings?.dashboard_channel_id && settings?.dashboard_message_id) {
        const old = await client.channels
          .fetchMessage(settings.dashboard_channel_id, settings.dashboard_message_id)
          .catch(() => null);
        await old?.delete?.().catch(() => {});
      }

      // 4) forget it in the database (the server's language is kept)
      clearSetup(guild.id);
    } catch (err) {
      console.error('[Voicey] !delete-setup failed:', err);
      return message
        .reply(t(locale, 'setup.failed', { reason: err?.message ?? 'unknown error', prefix }))
        .catch(() => {});
    }

    // The command may have been typed inside a temp channel that no longer
    // exists, in which case this reply has nowhere to go — that's fine.
    await message
      .reply(t(locale, 'deletesetup.done', { prefix }))
      .catch(() => {});
  },
};
