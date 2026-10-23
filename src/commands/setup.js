import { ChannelType, EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { askConfirm } from '../utils/confirm.js';
import { getGuildSettings, saveSetup, clearSetup } from '../db/index.js';
import { postSetupDashboard } from '../services/dashboard.js';
import { embedWithAsset } from '../utils/embedAssets.js';

export default {
  name: 'setup',
  async execute({ message, locale, prefix, guildId = message.guildId, guild: guildArg }) {
    if (!message.guildId) {
      return message.reply(t(locale, 'common.dm_only_in_guild'));
    }

    const guild = guildArg ?? (await message.resolveGuild());
    if (!guild) return message.reply(t(locale, 'common.error'));

    const member = guild.members.get(message.author.id) ??
      (await guild.fetchMember(message.author.id).catch(() => null));
    const isOwner = guild.ownerId === message.author.id;
    if (!isOwner && !member?.permissions?.has(PermissionFlags.ManageGuild)) {
      return message.reply(t(locale, 'setup.no_permission'));
    }

    const existing = getGuildSettings(guild.id);
    if (existing?.join_channel_id) {
      // Only refuse if the Join-to-Create channel still exists. If someone
      // deleted it by hand, the saved setup is dead — forget it and rebuild.
      const joinStillExists = await message.client.channels
        .fetch(existing.join_channel_id)
        .catch(() => null);
      if (joinStillExists) return message.reply(t(locale, 'setup.already_exists', { prefix }));
      clearSetup(guild.id);
    }

    const confirmEmbed = new EmbedBuilder()
      .setTitle(t(locale, 'setup.title'))
      .setDescription(
        t(locale, 'setup.start', { success: Emojis.success, error: Emojis.error }),
      )
      .setColor(0x4641d9);

    const prompt = await message.reply(await embedWithAsset(confirmEmbed, 'setup.png'));

    const { result, reactFailed } = await askConfirm(prompt, {
      userId: message.author.id,
      yes: Emojis.success,
      no: Emojis.error,
      time: 60_000,
    });

    if (reactFailed) await message.reply(t(locale, 'common.cannot_react')).catch(() => {});
    if (result === 'timeout') return message.reply(t(locale, 'common.cancelled'));
    if (result === 'no') return message.reply(t(locale, 'setup.declined'));

    const created = [];
    try {
      await message.reply(t(locale, 'setup.creating'));

      const category = await guild.createChannel({
        type: ChannelType.GuildCategory,
        name: 'Voice Channels',
      });
      created.push(category);

      const joinChannel = await guild.createChannel({
        type: ChannelType.GuildVoice,
        name: `➕ Join to Create`,
        parentId: category.id,
      });
      created.push(joinChannel);

      const target = message.channel ?? (await message.resolveChannel());
      const dashboard = await postSetupDashboard(message.client, target, locale, joinChannel, prefix);

      saveSetup(guild.id, {
        categoryId: category.id,
        joinChannelId: joinChannel.id,
        dashboardChannelId: message.channelId,
        dashboardMessageId: dashboard?.id ?? null,
      });
    } catch (err) {
      console.error('[Voicey] !setup failed:', err);
      // Don't leave half a setup lying around.
      for (const ch of created.reverse()) await ch.delete().catch(() => {});
      clearSetup(guild.id);
      await message
        .reply(t(locale, 'setup.failed', { reason: err?.message ?? 'unknown error', prefix }))
        .catch(() => {});
    }
  },
};
