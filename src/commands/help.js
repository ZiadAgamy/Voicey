import { EmbedBuilder } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { embedWithAsset } from '../utils/embedAssets.js';

export default {
  name: 'help',
  async execute({ message, locale, prefix }) {
    const embed = new EmbedBuilder()
      .setTitle(`${Emojis.voicey} ${t(locale, 'help.title')}`)
      .setDescription(t(locale, 'help.description', { prefix }))
      .addFields(
        { name: t(locale, 'help.field_setup'), value: t(locale, 'help.field_setup_value', { prefix }) },
        { name: t(locale, 'help.field_control'), value: t(locale, 'help.field_control_value', { prefix }) },
        { name: t(locale, 'help.field_info'), value: t(locale, 'help.field_info_value', { prefix }) },
      )
      .setColor(0x4641d9)
      .setFooter({ text: t(locale, 'help.footer', { prefix }) });

    await message.reply(await embedWithAsset(embed, 'help.png'));
  },
};
