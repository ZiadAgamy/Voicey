import { isEmoji } from '../config/emojis.js';

/**
 * Asks the user to confirm something by reacting to `prompt` with `yes` or `no`.
 *
 * Returns { result, reactFailed } where result is 'yes' | 'no' | 'timeout'.
 *
 * Notes on how the SDK behaves (read from @fluxerjs/core itself):
 *  - awaitReactions resolves with a Collection of { reaction, user } pairs, NOT
 *    bare reactions, so the emoji is at `entry.reaction.emoji`.
 *  - Without `errors`, a timeout resolves with an EMPTY collection instead of
 *    throwing, so "nobody reacted" and "a real error" stay distinguishable.
 *
 * The collector is started BEFORE the bot adds its own reactions, so a fast
 * user can't react in the gap and be missed.
 */
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
