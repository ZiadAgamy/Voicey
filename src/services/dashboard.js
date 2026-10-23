import { EmbedBuilder } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import { embedWithAsset } from '../utils/embedAssets.js';

export async function buildDashboardEmbed(locale, prefix = '!') {
  const embed = new EmbedBuilder()
    .setTitle(`${Emojis.voicey} ${t(locale, 'dashboard.title')}`)
    .setDescription(
      t(locale, 'dashboard.description', { prefix }),
    )
    .addFields(
      {
        name: t(locale, 'dashboard.field_basic'),
        value: [
          `\`${prefix}name <text>\``,
          `\`${prefix}limit <0-99>\``,
          `\`${prefix}privacy <lock|unlock>\``,
          `\`${prefix}members\``,
        ].join('\n'),
        inline: true,
      },
      {
        name: t(locale, 'dashboard.field_members'),
        value: [
          `\`${prefix}add <@user>\``,
          `\`${prefix}block <@user>\``,
          `\`${prefix}unblock <@user>\``,
          `\`${prefix}invite <@user>\``,
          `\`${prefix}kick <@user>\``,
          `\`${prefix}ban <@user>\``,
          `\`${prefix}unban <@user>\``,
        ].join('\n'),
        inline: true,
      },
      {
        name: t(locale, 'dashboard.field_owner'),
        value: [
          `\`${prefix}claim\``,
          `\`${prefix}transfer <@user>\``,
          `\`${prefix}delete\``,
        ].join('\n'),
        inline: true,
      },
    )
    .addFields({
      name: t(locale, 'dashboard.field_server'),
      value: [
        `\`${prefix}settings\``,
        `\`${prefix}delay <seconds>\``,
        `\`${prefix}settings template <text>\``,
        `\`${prefix}check\``,
      ].join('\n'),
      inline: false,
    })
    .setColor(0x4641d9)
    .setFooter({
      text: t(locale, 'dashboard.footer', { prefix }),
    });

  return embed;
}

export async function postDashboard(
  client,
  channel,
  locale,
  prefix = '!',
) {
  const embed = await buildDashboardEmbed(locale, prefix);

  return channel.send(
    await embedWithAsset(embed, 'control.png'),
  );
}

export async function postSetupDashboard(
  client,
  channel,
  locale,
  joinChannel,
  prefix = '!',
) {
  const embed = new EmbedBuilder()
    .setTitle(t(locale, 'setup.done_title'))
    .setDescription(
      t(locale, 'setup.done_desc', {
        joinChannel:
          joinChannel.toString?.() ?? `<#${joinChannel.id}>`,
        prefix,
      }),
    )
    .setColor(0x4641d9);

  return channel.send(
    await embedWithAsset(embed, 'setup.png'),
  );
}