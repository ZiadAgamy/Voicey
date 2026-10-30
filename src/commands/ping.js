import { EmbedBuilder } from '@fluxerjs/core';
import { t } from '../i18n/index.js';

export default {
  name: 'ping',

  async execute({ message, locale }) {
    const start = Date.now();

    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setDescription(
        t(locale, 'ping.result', {
          ms: Date.now() - start,
        }),
      )
      .setColor(0x4641d9);

    return message.reply({
      embeds: [embed],
    });
  },
};
