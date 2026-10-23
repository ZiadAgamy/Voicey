import { EmbedBuilder } from '@fluxerjs/core';
import { ensureGuild, markWelcomeSent, getGuildSettings } from '../db/index.js';
import { DEFAULT_LOCALE, t } from '../i18n/index.js';
import { embedWithAsset } from '../utils/embedAssets.js';

function sortedTextChannels(guild) {
  return [...guild.channels.values()]
    .filter((channel) => channel?.isText?.())
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Send the first successful welcome message after Voicey joins a server.
 * We try channels in their visible order until one accepts a message.
 * The database flag prevents the message from being sent again on restart.
 */
export async function sendGuildWelcome(guild) {
  if (!guild?.id) return false;

  const settings = ensureGuild(guild.id);
  if (settings?.welcome_sent_at) return false;

  const locale = settings?.language ?? DEFAULT_LOCALE;
  const prefix = settings?.prefix ?? '!';

  const embed = new EmbedBuilder()
    .setTitle(`🎙️ ${t(locale, 'welcome.title')}`)
    .setDescription(t(locale, 'welcome.description', { prefix }))
    .addFields(
      {
        name: t(locale, 'welcome.get_started_title'),
        value: t(locale, 'welcome.get_started_value', { prefix }),
      },
      {
        name: t(locale, 'welcome.owner_title'),
        value: t(locale, 'welcome.owner_value', { prefix }),
      },
      {
        name: t(locale, 'welcome.support_title'),
        value: process.env.SUPPORT_SERVER_URL
          ? t(locale, 'welcome.support_value', { url: process.env.SUPPORT_SERVER_URL })
          : t(locale, 'welcome.support_missing'),
      },
    )
    .setColor(0x4641d9)
    .setFooter({ text: t(locale, 'welcome.footer') });

  const payload = await embedWithAsset(embed, 'welcome.png');

  for (const channel of sortedTextChannels(guild)) {
    try {
      await channel.send(payload);
      markWelcomeSent(guild.id);
      return true;
    } catch {
      // No Send Messages permission here. Try the next text channel.
    }
  }

  console.warn(`[Voicey] Joined "${guild.name}" but could not send the welcome message.`);
  return false;
}
