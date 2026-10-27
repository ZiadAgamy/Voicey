import 'dotenv/config';
import { Client, Events } from '@fluxerjs/core';

import { loadLocales } from './i18n/index.js';
import { loadCommands, attachCommandHandler } from './handlers/commandHandler.js';
import { initVoiceState, clearGuildVoiceState } from './services/voiceState.js';
import { handleVoiceStateUpdate, sweepEmptyChannels } from './services/tempVoiceManager.js';
import { sendGuildWelcome } from './services/welcome.js';
import { clearWelcomeSent } from './db/index.js';
import { startPresence, updatePresence } from './services/presence.js';
import { initLogger } from './services/logger.js';

const token = process.env.FLUXER_BOT_TOKEN;

if (!token) {
  console.error(
    '[Voicey] Missing FLUXER_BOT_TOKEN. Copy .env.example to .env and fill in your bot token from the Fluxer developer portal.',
  );
  process.exit(1);
}

loadLocales();

const client = new Client();

// Must be registered before login so it captures VoiceStatesSync from
// READY/GUILD_CREATE.
initVoiceState(client);

let booted = false;

client.on(Events.Ready, async () => {
  // Ready can fire again after a full re-identify. Everything below must only
  // be wired once, otherwise every command would run twice.
  if (booted) {
    updatePresence(client);
    return;
  }
  booted = true;

  initLogger();

  console.log(
    `[Voicey] Logged in as ${client.user?.username ?? 'Voicey'}.`,
  );

  const commands = await loadCommands();
  attachCommandHandler(client, commands);

  startPresence(client);

  // Clean up temp channels that went empty while Voicey was offline.
  setTimeout(() => {
    for (const guild of client.guilds.values()) {
      sweepEmptyChannels(client, guild).catch(() => {});
    }
  }, 5_000).unref?.();
});

client.on(Events.GuildCreate, (guild) => {
  updatePresence(client);

  sendGuildWelcome(guild).catch((err) => {
    console.error(
      `[Voicey] Failed to send join welcome in ${guild?.id}:`,
      err,
    );
  });
});

client.on(Events.GuildDelete, (guild) => {
  clearGuildVoiceState(guild.id);
  updatePresence(client);

  // If Voicey is invited back later, it should send the join instructions again.
  clearWelcomeSent(guild.id);
});

client.on(Events.VoiceStateUpdate, (data) => {
  handleVoiceStateUpdate(client, data).catch((err) => {
    console.error('[Voicey] Error handling VoiceStateUpdate:', err);
  });
});

client.on(Events.Error, (err) => {
  console.error('[Voicey] Client error:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[Voicey] Unhandled rejection:', err);
});
// allows the bot to auto reconnect without a restart
client.on(Events.Resumed, () => {
  console.log('Bot should be recomnnected')
})

await client.login(token);
