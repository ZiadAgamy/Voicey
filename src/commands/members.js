import { EmbedBuilder } from '@fluxerjs/core';
import { resolveControlContext } from '../utils/resolveControlContext.js';
import { countMembersInChannel, getUserIdsInChannel } from '../services/voiceState.js';
import { Emojis } from '../config/emojis.js';
import { t } from '../i18n/index.js';

export default {
  name: 'members',
  aliases: ['users'],
  async execute({ client, message, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;

    const members = [];
    for (const userId of getUserIdsInChannel(ctx.guild.id, ctx.channel.id)) {
      const member = ctx.guild.members.get(userId) ??
        (await ctx.guild.fetchMember(userId).catch(() => null));
      members.push({
        id: userId,
        name: member?.displayName ?? member?.user?.username ?? `<@${userId}>`,
      });
    }

    const lines = members.length
      ? members.map((m) =>
          m.id === ctx.tempChannel.owner_id
            ? `👑 ${m.name} — ${t(locale, 'members.owner')}`
            : `🟢 ${m.name}`,
        )
      : [t(locale, 'members.empty')];

    const embed = new EmbedBuilder()
      .setTitle(`${Emojis.voicey} ${t(locale, 'members.title')}`)
      .setDescription(lines.join('\n'))
      .addFields({
        name: t(locale, 'members.count'),
        value: String(countMembersInChannel(ctx.guild, ctx.channel.id)),
        inline: true,
      })
      .setColor(0x4641d9);

    await ctx.channel.send({ embeds: [embed] }).catch(() => {});
  },
};
