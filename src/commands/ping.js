import { EmbedBuilder } from '@fluxerjs/core';
import { t } from '../i18n/index.js';

export default {
  name: 'ping',

  async execute({ message, locale }) {
    const start = Date.now();

    const reply = await message.reply('🏓 Pinging...');

    const latency = Date.now() - start;

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setDescription(
        t(locale, 'ping.result', {
          ms: latency,
        }),
      )
      .setColor(0x4641d9);

    return reply.edit({ embeds: [embed] });
  },
};