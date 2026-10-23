import { EmbedBuilder } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { formatDuration } from '../utils/formatDuration.js';
import { embedWithAsset } from '../utils/embedAssets.js';

export default {
  name: 'uptime',
  async execute({ message, locale, client }) {
    const uptimeMs = Date.now() - client.readyAt.getTime();
    const embed = new EmbedBuilder()
      .setTitle(`${Emojis.clock} ${t(locale, 'uptime.title')}`)
      .setDescription(t(locale, 'uptime.description', { uptime: formatDuration(uptimeMs) }))
      .setColor(0x4641d9);

    await message.reply(await embedWithAsset(embed, 'uptime.png'));
  },
};
