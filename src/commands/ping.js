import { EmbedBuilder } from '@fluxerjs/core';
import { performance } from 'node:perf_hooks';

const STATUS_API_URL =
  process.env.STATUS_API_URL || 'https://status.voicey.bot/api/status'; //You API status link should be on the '.env' file.

async function getDashboardPing() {
  try {
    const response = await fetch(STATUS_API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const ping = data.bot?.ping;

    return typeof ping === 'number' && Number.isFinite(ping)
      ? ping
      : null;
  } catch {
    return null;
  }
}

export default {
  name: 'ping',

  async execute({ message }) {
    const start = performance.now();

    const initialEmbed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setDescription('Checking Voicey latency...')
      .setColor(0x4641d9);

    const pongMessage = await message.reply({
      embeds: [initialEmbed],
    });

    const responsePing = Math.round(performance.now() - start);
    const dashboardPing = await getDashboardPing();

    const finalEmbed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setDescription(
        [
          '🌐 **Dashboard Ping**',
          dashboardPing !== null ? `${dashboardPing} ms` : 'Unavailable',
          '',
          '📡 **Bot Response**',
          `${responsePing} ms`,
        ].join('\n'),
      )
      .setColor(0x4641d9)
      .setFooter({
        text: 'Voicey • Latency Diagnostics',
      });

    return pongMessage.edit({
      embeds: [finalEmbed],
    });
  },
};
