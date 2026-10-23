const STATUS_EMOJI_ID = process.env.VOICEY_STATUS_EMOJI_ID?.trim() || null;

export function updatePresence(client) {
  const count = client.guilds?.size ?? 0;

  const customStatus = {
    text: `Voicing ${count.toLocaleString('en-US')} servers`,
  };

  // Optional custom emoji next to the status text.
  if (STATUS_EMOJI_ID) customStatus.emojiId = STATUS_EMOJI_ID;

  return client.user?.setPresence?.({
    status: 'online',
    customStatus,
  });
}

export function startPresence(client) {
  return updatePresence(client);
}
