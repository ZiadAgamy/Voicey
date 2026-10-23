import { EmbedBuilder } from '@fluxerjs/core';
import { t, availableLocales } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { formatDuration } from '../utils/formatDuration.js';
import { allTempChannels } from '../db/index.js';
import { embedWithAsset } from '../utils/embedAssets.js';

export default {
  name: 'botinfo',
  async execute({ message, locale, client, prefix }) {
    const uptimeMs = Date.now() - client.readyAt.getTime();
    const guildCount = client.guilds?.size ?? 0; // GuildManager extends Collection directly
    const activeChannels = allTempChannels().length;
    const langs = availableLocales().map((l) => l.flag).join(' ');

    const embed = new EmbedBuilder()
      .setTitle(`${Emojis.voicey} ${t(locale, 'botinfo.title')}`)
      .setDescription(t(locale, 'botinfo.description'))
      .addFields(
        { name: t(locale, 'botinfo.field_servers'), value: String(guildCount), inline: true },
        { name: t(locale, 'botinfo.field_channels'), value: String(activeChannels), inline: true },
        { name: t(locale, 'botinfo.field_uptime'), value: formatDuration(uptimeMs), inline: true },
        { name: t(locale, 'botinfo.field_prefix'), value: `\`${prefix}\``, inline: true },
        { name: t(locale, 'botinfo.field_lang'), value: langs, inline: true },
      )
      .setColor(0x4641d9);

    await message.reply(await embedWithAsset(embed, 'botinfo.png'));
  },
};
