import { t } from '../i18n/index.js';
import { getGuildSettings } from '../db/index.js';
import { resolveCurrentChannel } from '../services/tempVoiceManager.js';

/**
 * Every voice-control command (!name, !limit, !privacy, ...) needs the same
 * setup: the caller must be sitting in one of Voicey's temp channels right
 * now. This resolves that once so each command file stays short.
 * Returns null (and replies with the standard error) if the check fails.
 */
export async function resolveControlContext({ client, message, locale }) {
  if (!message.guildId) {
    await message.reply(t(locale, 'common.dm_only_in_guild'));
    return null;
  }

  const guild = await message.resolveGuild();
  if (!guild) {
    await message.reply(t(locale, 'common.error'));
    return null;
  }

  const tempChannel = resolveCurrentChannel(guild, message.author.id);
  if (!tempChannel) {
    await message.reply(t(locale, 'common.no_voice_channel'));
    return null;
  }

  const channel = client.channels.get(tempChannel.channel_id) ??
    (await client.channels.fetch(tempChannel.channel_id).catch(() => null));
  const member = guild.members.get(message.author.id) ??
    (await guild.fetchMember(message.author.id).catch(() => null));

  if (!channel || !member) {
    await message.reply(t(locale, 'common.error'));
    return null;
  }

  const settings = getGuildSettings(guild.id);
  const prefix = settings?.prefix ?? process.env.BOT_PREFIX?.trim() ?? '!';
  return { client, guild, channel, member, tempChannel, locale, prefix };
}

/** Extracts the first mentioned user id from a message's mentions, or args[0] stripped of <@!id> formatting. */
export function extractUserId(message, args) {
  const mentioned = message.mentions?.users?.first?.() ?? message.mentions?.members?.first?.()?.user;
  if (mentioned) return mentioned.id;

  const raw = args[0];
  if (!raw) return null;
  const match = raw.match(/^<@!?(\d+)>$/);
  if (match) return match[1];
  if (/^\d{5,}$/.test(raw)) return raw; // bare id
  return null;
}
