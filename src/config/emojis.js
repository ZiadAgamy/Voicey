function custom(name, id, fallback, animated = false) {
  if (!id) return fallback; // if not uploaded yet — a safe Unicode fallback
  return `<${animated ? 'a' : ''}:${name}:${id}>`;
}

// Fill these IDs in once Voicey's emoji pack / home guild exists.
// process.env lets you override any single emoji without touching code.
const ID = {
  lock: process.env.EMOJI_LOCK_ID ?? '',
  unlock: process.env.EMOJI_UNLOCK_ID ?? '',
  hidden: process.env.EMOJI_HIDDEN_ID ?? '',
  visible: process.env.EMOJI_VISIBLE_ID ?? '',
  limit: process.env.EMOJI_LIMIT_ID ?? '',
  name: process.env.EMOJI_NAME_ID ?? '',
  waiting: process.env.EMOJI_WAITING_ID ?? '',
  topic: process.env.EMOJI_TOPIC_ID ?? '',
  trust: process.env.EMOJI_TRUST_ID ?? '',
  untrust: process.env.EMOJI_UNTRUST_ID ?? '',
  invite: process.env.EMOJI_INVITE_ID ?? '',
  kick: process.env.EMOJI_KICK_ID ?? '',
  ban: process.env.EMOJI_BAN_ID ?? '',
  unban: process.env.EMOJI_UNBAN_ID ?? '',
  claim: process.env.EMOJI_CLAIM_ID ?? '',
  transfer: process.env.EMOJI_TRANSFER_ID ?? '',
  trash: process.env.EMOJI_TRASH_ID ?? '',
  success: process.env.EMOJI_SUCCESS_ID ?? '',
  error: process.env.EMOJI_ERROR_ID ?? '',
  info: process.env.EMOJI_INFO_ID ?? '',
  loading: process.env.EMOJI_LOADING_ID ?? '',
  voicey: process.env.EMOJI_VOICEY_ID ?? '',
  arrow: process.env.EMOJI_ARROW_ID ?? '',
  crown: process.env.EMOJI_CROWN_ID ?? '',
  globe: process.env.EMOJI_GLOBE_ID ?? '',
  clock: process.env.EMOJI_CLOCK_ID ?? '',
  gear: process.env.EMOJI_GEAR_ID ?? '',
};

export const Emojis = {
  lock: custom('voicey_lock', ID.lock, '🔒'),
  unlock: custom('voicey_unlock', ID.unlock, '🔓'),
  hidden: custom('voicey_hidden', ID.hidden, '🙈'),
  visible: custom('voicey_visible', ID.visible, '🙉'),
  limit: custom('voicey_limit', ID.limit, '👥'),
  name: custom('voicey_name', ID.name, '📝'),
  waiting: custom('voicey_waiting', ID.waiting, '⏳'),
  topic: custom('voicey_topic', ID.topic, '💬'),
  trust: custom('voicey_trust', ID.trust, '➕'),
  untrust: custom('voicey_untrust', ID.untrust, '➖'),
  invite: custom('voicey_invite', ID.invite, '📨'),
  kick: custom('voicey_kick', ID.kick, '📵'),
  ban: custom('voicey_ban', ID.ban, '🚫'),
  unban: custom('voicey_unban', ID.unban, '✅'),
  claim: custom('voicey_claim', ID.claim, '👑'),
  transfer: custom('voicey_transfer', ID.transfer, '🎗️'),
  trash: custom('voicey_trash', ID.trash, '🗑️'),
  success: custom('voicey_success', ID.success, '✅'),
  error: custom('voicey_error', ID.error, '❌'),
  info: custom('voicey_info', ID.info, 'ℹ️'),
  loading: custom('voicey_loading', ID.loading, '⏳', true),
  voicey: custom('voicey_logo', ID.voicey, '🎙️'),
  arrow: custom('voicey_arrow', ID.arrow, '➡️'),
  crown: custom('voicey_crown', ID.crown, '👑'),
  globe: custom('voicey_globe', ID.globe, '🌐'),
  clock: custom('voicey_clock', ID.clock, '🕐'),
  gear: custom('voicey_gear', ID.gear, '⚙️'),
};

export function isEmoji(reactionEmoji, registryEmoji) {
  if (!reactionEmoji || !registryEmoji) return false;
  const custom = /^<a?:(\w+):(\d+)>$/.exec(registryEmoji);
  if (custom) return reactionEmoji.id === custom[2];
  return reactionEmoji.name === registryEmoji;
}
