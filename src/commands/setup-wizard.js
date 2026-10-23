import { ChannelType, EmbedBuilder, Events, PermissionFlags } from '@fluxerjs/core';
import { t } from '../i18n/index.js';
import { Emojis } from '../config/emojis.js';
import {
  getGuildSettings,
  saveSetup,
  clearSetup,
  setGuildDeletionDelay,
  setGuildNameTemplate,
} from '../db/index.js';
import { postSetupDashboard } from '../services/dashboard.js';
import { embedWithAsset } from '../utils/embedAssets.js';

const DEFAULTS = {
  category: 'Voice Channels',
  join: '➕ Join to Create',
  template: "🔊 {user}'s Channel",
  delay: 60,
};

function createMessageWaiter(client, channelId, userId, timeout = 60_000) {
  let cancel;

  const promise = new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (typeof client.off === 'function') {
        client.off(Events.MessageCreate, onMessage);
      } else {
        client.removeListener(Events.MessageCreate, onMessage);
      }
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const onMessage = (incoming) => {
      if (!incoming || incoming.author?.bot) return;
      if (incoming.author?.id !== userId) return;

      const incomingChannelId = incoming.channelId ?? incoming.channel?.id;
      if (incomingChannelId !== channelId) return;

      finish(resolve, incoming);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('__TIMEOUT__'));
    }, timeout);

    cancel = () => finish(reject, new Error('__CANCELLED__'));

    // Register the listener BEFORE the prompt is sent. This prevents a fast
    // reply from arriving between channel.send() and awaitMessages setup.
    client.on(Events.MessageCreate, onMessage);
  });

  return { promise, cancel: () => cancel?.() };
}

async function ask(client, channel, userId, prompt, fallback) {
  // Start listening first so an immediate reply cannot be missed.
  const waiter = createMessageWaiter(client, channel.id, userId);

  try {
    await channel.send(prompt);
  } catch (error) {
    waiter.cancel();
    throw error;
  }

  const incoming = await waiter.promise;
  const answer = incoming.content?.trim();

  if (!answer) throw new Error('__TIMEOUT__');
  if (answer.toLowerCase() === 'skip') return fallback;
  if (answer.toLowerCase() === 'cancel') throw new Error('__CANCELLED__');

  return answer;
}

export default {
  name: 'setup-wizard',
  aliases: ['wizard'],
  async execute({ client, message, locale, prefix }) {
    if (!message.guildId) return message.reply(t(locale, 'common.dm_only_in_guild'));

    const guild = await message.resolveGuild();
    if (!guild) return message.reply(t(locale, 'common.error'));

    const member = guild.members.get(message.author.id) ??
      (await guild.fetchMember(message.author.id).catch(() => null));
    if (
      guild.ownerId !== message.author.id &&
      !member?.permissions?.has(PermissionFlags.ManageGuild)
    ) {
      return message.reply(t(locale, 'setup.no_permission'));
    }

    const existing = getGuildSettings(guild.id);
    if (existing?.join_channel_id) {
      const joinStillExists = await client.channels
        .fetch(existing.join_channel_id)
        .catch(() => null);
      if (joinStillExists) return message.reply(t(locale, 'setup.already_exists', { prefix }));
      clearSetup(guild.id); // the saved setup points at a deleted channel
    }

    const intro = new EmbedBuilder()
      .setTitle(`${Emojis.voicey} ${t(locale, 'setup_wizard.title')}`)
      .setDescription(t(locale, 'setup_wizard.intro', { prefix }))
      .setColor(0x4641d9);
    await message.reply(await embedWithAsset(intro, 'setup.png'));

    const created = [];

    try {
      const categoryName = (await ask(
        client,
        message.channel,
        message.author.id,
        t(locale, 'setup_wizard.category_prompt', { default: DEFAULTS.category }),
        DEFAULTS.category,
      )).slice(0, 100);

      const joinName = (await ask(
        client,
        message.channel,
        message.author.id,
        t(locale, 'setup_wizard.join_prompt', { default: DEFAULTS.join }),
        DEFAULTS.join,
      )).slice(0, 100);

      const template = (await ask(
        client,
        message.channel,
        message.author.id,
        t(locale, 'setup_wizard.template_prompt', { default: DEFAULTS.template }),
        DEFAULTS.template,
      )).slice(0, 32);

      const delayRaw = await ask(
        client,
        message.channel,
        message.author.id,
        t(locale, 'setup_wizard.delay_prompt', { default: DEFAULTS.delay }),
        String(DEFAULTS.delay),
      );
      const delay = Number(delayRaw);

      if (!Number.isInteger(delay) || delay < 0 || delay > 3600) {
        throw new Error(t(locale, 'setup_wizard.invalid_delay', { prefix }));
      }

      await message.channel.send(t(locale, 'setup.creating'));

      const category = await guild.createChannel({
        type: ChannelType.GuildCategory,
        name: categoryName,
      });
      created.push(category);

      const joinChannel = await guild.createChannel({
        type: ChannelType.GuildVoice,
        name: joinName,
        parentId: category.id,
      });
      created.push(joinChannel);

      setGuildDeletionDelay(guild.id, delay);
      setGuildNameTemplate(guild.id, template);

      const dashboard = await postSetupDashboard(
        client,
        message.channel,
        locale,
        joinChannel,
        prefix,
      );

      saveSetup(guild.id, {
        categoryId: category.id,
        joinChannelId: joinChannel.id,
        dashboardChannelId: message.channelId,
        dashboardMessageId: dashboard?.id ?? null,
      });

      const done = new EmbedBuilder()
        .setTitle(t(locale, 'setup_wizard.done_title'))
        .setDescription(
          t(locale, 'setup_wizard.done', {
            joinChannel: `<#${joinChannel.id}>`,
            category: `<#${category.id}>`,
            template,
            delay,
            prefix,
          }),
        )
        .setColor(0x4641d9);
      await message.channel.send({ embeds: [done] });
    } catch (err) {
      for (const ch of created.reverse()) await ch.delete().catch(() => {});
      clearSetup(guild.id);

      if (err?.message === '__CANCELLED__') {
        return message.channel.send(t(locale, 'setup_wizard.cancelled'));
      }
      if (err?.message === '__TIMEOUT__') {
        return message.channel.send(t(locale, 'setup_wizard.timeout'));
      }

      console.error('[Voicey] !setup-wizard failed:', err);
      await message.channel.send(
        t(locale, 'setup.failed', {
          reason: err?.message ?? 'unknown error',
          prefix,
        }),
      ).catch(() => {});
    }
  },
};
