import { EmbedBuilder } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { embedWithAsset } from '../utils/embedAssets.js';
import { isCommandDisabled } from '../services/commandAccess.js';

function visibleLines(text, guildId, prefix) {
  if (!guildId) return text;
  return text
    .split('\n')
    .filter((line) => {
      if (!line.startsWith(`\`${prefix}`)) return true;
      const m = line.slice(prefix.length + 1).match(/^([a-z-]+)/i);
      return !(m && isCommandDisabled(guildId, m[1].toLowerCase()));
    })
    .join('\n');
}

export default {
  name: 'help',
  async execute({ message, locale, prefix }) {
    const gid = message.guildId ?? null;
    const embed = new EmbedBuilder()
      .setTitle(`${Emojis.voicey} ${t(locale, 'help.title')}`)
      .setDescription(t(locale, 'help.description', { prefix }))
      .addFields(
        { name: t(locale, 'help.field_setup'), value: visibleLines(t(locale, 'help.field_setup_value', { prefix }), gid, prefix) || '—' },
        { name: t(locale, 'help.field_control'), value: visibleLines(t(locale, 'help.field_control_value', { prefix }), gid, prefix) || '—' },
        { name: t(locale, 'help.field_info'), value: visibleLines(t(locale, 'help.field_info_value', { prefix }), gid, prefix) || '—' },
      )
      .setColor(0x4641d9)
      .setFooter({ text: t(locale, 'help.footer', { prefix }) });

    await message.reply(await embedWithAsset(embed, 'help.png'));
  },
};
