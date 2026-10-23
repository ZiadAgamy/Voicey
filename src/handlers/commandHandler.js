import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Events, EmbedBuilder } from '@fluxerjs/core';
import { ensureGuild } from '../db/index.js';
import { DEFAULT_LOCALE, t } from '../i18n/index.js';
import { embedWithAsset } from '../utils/embedAssets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

export async function loadCommands() {
  const commands = new Map();
  const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(COMMANDS_DIR, file)).href);
    const cmd = mod.default;
    if (!cmd?.name || typeof cmd.execute !== 'function') {
      console.warn(`[Voicey] Skipping ${file}: missing name/execute export.`);
      continue;
    }
    commands.set(cmd.name, cmd);
    for (const alias of cmd.aliases ?? []) commands.set(alias, cmd);
  }

  return commands;
}

function isBotMentioned(message, client) {
  const botId = client.user?.id;
  if (!botId) return false;

  const mentioned =
    (typeof message.mentions?.users?.has === 'function' && message.mentions.users.has(botId)) ||
    (Array.isArray(message.mentions) && message.mentions.some((user) => user.id === botId)) ||
    new RegExp(`<@!?${botId}>`).test(message.content ?? '');

  const content = message.content?.trim().toLowerCase() ?? '';
  const username = client.user?.username?.toLowerCase();

  return Boolean(mentioned) || content === username || content === `@${username}`;
}

function removeBotMention(content, botId) {
  if (!content) return '';
  return content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();
}

async function sendMentionPrefix(message, prefix) {
  const embed = new EmbedBuilder()
    .setTitle('🎙️ Voicey')
    .setDescription(`My prefix for this server is \`${prefix}\`.\nUse \`${prefix}help\` to see my commands.`)
    .setColor(0x4641d9);

  await message.reply(await embedWithAsset(embed, 'prefix.png')).catch(() => {});
}

export function attachCommandHandler(client, commands) {
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author?.bot) return;

      const guildId = message.guildId ?? null;
      const settings = guildId ? ensureGuild(guildId) : null;
      const locale = settings?.language ?? DEFAULT_LOCALE;
      const prefix = settings?.prefix ?? process.env.BOT_PREFIX?.trim() ?? '!';

      // Mentioning Voicey is always a quick way to discover the current prefix.
      // A real prefix command still takes priority, so "!help @Voicey" is normal.
      if (guildId && isBotMentioned(message, client)) {
        const withoutMention = removeBotMention(message.content ?? '', client.user.id);
        if (!withoutMention.startsWith(prefix)) {
          await sendMentionPrefix(message, prefix);
          return;
        }
      }

      if (!message.content?.startsWith(prefix)) return;

      const args = message.content.slice(prefix.length).trim().split(/\s+/);
      const commandName = args.shift()?.toLowerCase();
      if (!commandName) return;

      const command = commands.get(commandName);
      if (!command) return;

      await command.execute({
        client,
        message,
        args,
        locale,
        prefix,
        settings,
      });
    } catch (err) {
      console.error('[Voicey] Error running command:', err);
      try {
        await message.reply('⚠️ Something went wrong running that command.');
      } catch {
        /* channel may be gone; ignore */
      }
    }
  });
}
