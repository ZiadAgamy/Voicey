import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import {
  getGuildSettings,
  setGuildDeletionDelay,
  setGuildNameTemplate,
} from '../db/index.js';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { embedWithAsset } from '../utils/embedAssets.js';

async function canManage(guild, userId) {
  if (guild.ownerId === userId) return true;
  const member = guild.members.get(userId) ??
    (await guild.fetchMember(userId).catch(() => null));
  return Boolean(member?.permissions?.has(PermissionFlags.ManageGuild));
}

function renderTemplate(template) {
  return `\`${String(template || '🔊 {user}\'s Channel').replaceAll('`', '\\`')}\``;
}

export default {
  name: 'settings',
  async execute({ message, args, locale, prefix, client }) {
    if (!message.guildId) return message.reply(t(locale, 'common.dm_only_in_guild'));

    const guild = await message.resolveGuild();
    if (!guild) return message.reply(t(locale, 'common.error'));

    if (!(await canManage(guild, message.author.id))) {
      return message.reply(t(locale, 'settings.no_permission'));
    }

    const settings = getGuildSettings(guild.id);
    const action = args[0]?.toLowerCase();

    if (action === 'delay') {
      const value = Number(args[1]);
      if (!Number.isInteger(value) || value < 0 || value > 3600) {
        return message.reply(t(locale, 'delay.invalid', { prefix }));
      }
      setGuildDeletionDelay(guild.id, value);
      return message.reply(t(locale, 'delay.success', { seconds: value }));
    }

    if (action === 'template') {
      const raw = args.slice(1).join(' ').trim();
      if (!raw) {
        return message.reply(t(locale, 'template.current', {
          template: settings.name_template || '🔊 {user}\'s Channel',
          prefix,
        }));
      }
      if (raw.toLowerCase() === 'reset') {
        setGuildNameTemplate(guild.id, '🔊 {user}\'s Channel');
        return message.reply(t(locale, 'template.success', {
          template: '🔊 {user}\'s Channel',
        }));
      }
      if (raw.length > 32) {
        return message.reply(t(locale, 'template.too_long'));
      }
      setGuildNameTemplate(guild.id, raw);
      return message.reply(t(locale, 'template.success', { template: raw }));
    }

    const join = settings?.join_channel_id
      ? client.channels.get(settings.join_channel_id) ??
        (await client.channels.fetch(settings.join_channel_id).catch(() => null))
      : null;
    const category = settings?.category_id
      ? client.channels.get(settings.category_id) ??
        (await client.channels.fetch(settings.category_id).catch(() => null))
      : null;

    const embed = new EmbedBuilder()
      .setTitle(`${Emojis.voicey} ${t(locale, 'settings.title')}`)
      .setDescription(t(locale, 'settings.description', { prefix }))
      .addFields(
        {
          name: t(locale, 'settings.setup'),
          value: [
            `${t(locale, 'settings.join')}: ${join ? `<#${join.id}>` : '❌'}`,
            `${t(locale, 'settings.category')}: ${category ? `<#${category.id}>` : '❌'}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: t(locale, 'settings.voice'),
          value: [
            `${t(locale, 'settings.template')}: ${renderTemplate(settings?.name_template)}`,
            `${t(locale, 'settings.delay')}: **${settings?.deletion_delay ?? 60}s**`,
          ].join('\n'),
          inline: true,
        },
        {
          name: t(locale, 'settings.general'),
          value: [
            `${t(locale, 'settings.language')}: **${settings?.language ?? 'en'}**`,
            `${t(locale, 'settings.prefix')}: \`${settings?.prefix ?? prefix}\``,
          ].join('\n'),
          inline: true,
        },
      )
      .setColor(0x4641d9)
      .setFooter({
        text: `${prefix}settings template <text> • ${prefix}settings delay <seconds>`,
      });

    await message.reply(await embedWithAsset(embed, 'control.png'));
  },
};
