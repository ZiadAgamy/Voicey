import { isEmoji } from '../config/emojis.js';

export async function askConfirm(prompt, { userId, yes, no, time = 30_000 }) {
  const pending = prompt.awaitReactions({
    filter: (reaction, user) =>
      user.id === userId && (isEmoji(reaction.emoji, yes) || isEmoji(reaction.emoji, no)),
    max: 1,
    time,
  });

  let reactFailed = false;
  for (const emoji of [yes, no]) {
    try {
      await prompt.react(emoji);
    } catch (err) {
      reactFailed = true;
      console.warn(
        `[Voicey] Could not add reaction ${emoji} (does the bot have "Add Reactions" and "Read Message History"?):`,
        err?.message ?? err,
      );
    }
  }

  const collected = await pending;
  const hit = collected.first();
  if (!hit) return { result: 'timeout', reactFailed };
  return { result: isEmoji(hit.reaction.emoji, yes) ? 'yes' : 'no', reactFailed };
}
