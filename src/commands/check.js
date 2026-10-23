import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import { diagnoseGuild } from '../services/diagnostics.js';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';

export default {
  name: 'check',
  aliases: ['permissions', 'health'],
  async execute({ message, locale, prefix }) {
    if (!message.guildId) {
      return message.reply(t(locale, 'common.dm_only_in_guild'));
    }

    const guild = await message.resolveGuild();
    if (!guild) return message.reply(t(locale, 'common.error'));

    const member = guild.members.get(message.author.id) ??
      (await guild.fetchMember(message.author.id).catch(() => null));
    if (
      guild.ownerId !== message.author.id &&
      !member?.permissions?.has(PermissionFlags.ManageGuild)
    ) {
      return message.reply(t(locale, 'diagnostics.no_permission'));
    }

    const result = await diagnoseGuild(guild, message.client);
    const embed = new EmbedBuilder()
      .setTitle(`${result.healthy ? '🟣' : '🟠'} ${t(locale, 'diagnostics.check_title')}`)
      .setDescription(t(locale, result.healthy ? 'diagnostics.check_healthy' : 'diagnostics.check_issues', { prefix }))
      .setColor(result.healthy ? 0x4641d9 : 0xf59e0b);

    // Separate fields avoid literal "\n" rendering on clients with inconsistent embed parsing.
    for (const check of result.checks) {
      embed.addFields({
        name: `${check.ok ? '✅' : '❌'} ${check.name}`,
        value: check.ok ? 'Passed' : 'Needs attention',
        inline: true,
      });
    }
    embed.addFields({
      name: t(locale, 'diagnostics.temp_channels'),
      value: `**${result.tempChannelCount}**`,
      inline: true,
    });
    embed.setFooter({ text: t(locale, 'diagnostics.check_footer') });

    await message.reply({ embeds: [embed] });
  },
};
