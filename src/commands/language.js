import { PermissionFlags, EmbedBuilder } from '@fluxerjs/core';
import { t, availableLocales, hasLocale } from '../i18n/index.js';
import { setGuildLanguage } from '../db/index.js';
import { embedWithAsset } from '../utils/embedAssets.js';

export default {
  name: 'language',
  aliases: ['lang'],
  async execute({ message, args, locale, prefix }) {
    if (!message.guildId) return message.reply(t(locale, 'common.dm_only_in_guild'));

    const guild = await message.resolveGuild();
    const member = guild?.members.get(message.author.id) ??
      (await guild?.fetchMember(message.author.id).catch(() => null));

    const code = args[0]?.toLowerCase();

    if (!code) {
      const list = availableLocales()
        .map((l) => `${l.flag} \`${l.code}\` — ${l.name}`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle(t(locale, 'language.title'))
        .setDescription(t(locale, 'language.list', { list, prefix }))
        .setColor(0x4641d9);

      return message.reply(await embedWithAsset(embed, 'language.png'));
    }

    const isOwner = guild?.ownerId === message.author.id;
    if (!isOwner && !member?.permissions?.has(PermissionFlags.ManageGuild)) {
      return message.reply(t(locale, 'language.no_permission'));
    }

    if (!hasLocale(code)) {
      return message.reply(t(locale, 'language.unknown', { code, prefix }));
    }

    setGuildLanguage(message.guildId, code);
    const langMeta = availableLocales().find((l) => l.code === code);
    await message.reply(t(code, 'language.set', { lang: langMeta?.name ?? code, prefix }));
  },
};
