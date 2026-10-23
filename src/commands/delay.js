import { PermissionFlags } from '@fluxerjs/core';
import { getGuildSettings, setGuildDeletionDelay } from '../db/index.js';
import { t } from '../i18n/index.js';

export default {
  name: 'delay',
  aliases: ['grace'],
  async execute({ message, args, locale, prefix }) {
    if (!message.guildId) return message.reply(t(locale, 'common.dm_only_in_guild'));
    const guild = await message.resolveGuild();
    if (!guild) return message.reply(t(locale, 'common.error'));

    const member = guild.members.get(message.author.id) ??
      (await guild.fetchMember(message.author.id).catch(() => null));
    if (guild.ownerId !== message.author.id && !member?.permissions?.has(PermissionFlags.ManageGuild)) {
      return message.reply(t(locale, 'delay.no_permission'));
    }

    if (!args[0]) {
      const settings = getGuildSettings(guild.id);
      return message.reply(t(locale, 'delay.current', {
        seconds: settings?.deletion_delay ?? 60,
        prefix,
      }));
    }

    const seconds = Number(args[0]);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
      return message.reply(t(locale, 'delay.invalid', { prefix }));
    }

    setGuildDeletionDelay(guild.id, seconds);
    await message.reply(t(locale, 'delay.success', { seconds }));
  },
};
