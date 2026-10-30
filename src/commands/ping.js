
import { EmbedBuilder } from '@fluxerjs/core';
import { t } from '../i18n/index.js';

export default {
  name: 'ping',

  async execute({ message, locale }) {
    const start = Date.now();

    // Send a temporary message to measure API response time
    const pongMessage = await message.reply('🏓 Pinging...');

    const latency = Date.now() - start;

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setDescription(
        t(locale, 'ping.result', {
          ms: latency,
        }),
      )
      .setColor(0x4641d9);

    return pongMessage.edit({ embeds: [embed] });
  },
};
