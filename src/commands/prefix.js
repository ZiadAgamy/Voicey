import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import { setGuildPrefix } from '../db/index.js';
import { t } from '../i18n/index.js';
import { embedWithAsset } from '../utils/embedAssets.js';

const MAX_PREFIX_LENGTH = 5;

function isValidPrefix(value) {
  return Boolean(
    value &&
    value.length <= MAX_PREFIX_LENGTH &&
    !/\s/.test(value) &&
    !/[<@>]/.test(value)
  );
}

export default {
  name: 'prefix',

  async execute({ message, args, locale, prefix }) {
    if (!message.guildId) {
      return message.reply(t(locale, 'common.dm_only_in_guild'));
    }

    const guild = await message.resolveGuild();

    if (!guild) {
      return message.reply(t(locale, 'common.error'));
    }

    // Resolve the member so we can check their permissions.
    const member =
      guild.members.get(message.author.id) ??
      (await guild.fetchMember(message.author.id).catch(() => null));

    const isOwner = guild.ownerId === message.author.id;
    const canManagePrefix =
      isOwner ||
      member?.permissions?.has(PermissionFlags.ManageGuild) === true;

    if (!canManagePrefix) {
      return message.reply(t(locale, 'prefix.no_permission'));
    }

    const requested = args[0];

    // Show the current prefix.
    if (!requested) {
      const embed = new EmbedBuilder()
        .setTitle(t(locale, 'prefix.title'))
        .setDescription(t(locale, 'prefix.current', { prefix }))
        .setColor(0x4641d9)
        .setFooter({
          text: t(locale, 'prefix.usage', { prefix }),
        });

      return message.reply(
        await embedWithAsset(embed, 'prefix.png')
      );
    }

    // Reset to the default prefix.
    if (requested.toLowerCase() === 'reset') {
      const nextPrefix = process.env.BOT_PREFIX?.trim() || '!';

      setGuildPrefix(guild.id, nextPrefix);

      return message.reply(
        t(locale, 'prefix.changed', { prefix: nextPrefix })
      );
    }

    // Validate the new prefix.
    if (!isValidPrefix(requested)) {
      return message.reply(
        t(locale, 'prefix.invalid', {
          prefix,
          max: MAX_PREFIX_LENGTH,
        })
      );
    }

    setGuildPrefix(guild.id, requested);

    const embed = new EmbedBuilder()
      .setTitle(t(locale, 'prefix.title'))
      .setDescription(
        t(locale, 'prefix.changed', { prefix: requested })
      )
      .setColor(0x4641d9);

    return message.reply(
      await embedWithAsset(embed, 'prefix.png')
    );
  },
};