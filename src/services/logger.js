// src/services/logger.js

const WEBHOOK_URL = process.env.VOICEY_LOG_WEBHOOK_URL;
const BRAND_COLOR = 0x4641d9;

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let initialized = false;
let sending = false;

function stringify(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildEmbed(level, message) {
  const config = {
    log: {
      title: '📋 Voicey Log',
      color: BRAND_COLOR,
    },

    info: {
      title: 'ℹ️ Voicey Info',
      color: BRAND_COLOR,
    },

    warn: {
      title: '⚠️ Voicey Warning',
      color: 0xf5a623,
    },

    error: {
      title: '🔴 Voicey Error',
      color: 0xe74c3c,
    },
  };

  const selected = config[level] ?? config.log;

  let description = message;

  // Discord/Fluxer embeds have a description limit.
  if (description.length > 4000) {
    description = `${description.slice(0, 3990)}...`;
  }

  return {
    title: selected.title,
    description: `\`\`\`\n${description}\n\`\`\``,
    color: selected.color,
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Voicey Logger',
    },
  };
}

async function sendWebhook(level, ...values) {
  if (!WEBHOOK_URL || sending) {
    return;
  }

  const message = values.map(stringify).join(' ');

  if (!message.trim()) {
    return;
  }

  sending = true;

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'Voicey Logs',
        embeds: [buildEmbed(level, message)],
      }),
    });
  } catch (error) {
    // Never use console.error here because it would create a loop.
    originalConsole.error(
      '[Voicey] Failed to send log webhook:',
      error,
    );
  } finally {
    sending = false;
  }
}

export function initLogger() {
  if (initialized) {
    return;
  }

  if (!WEBHOOK_URL) {
    originalConsole.warn(
      '[Voicey] VOICEY_LOG_WEBHOOK_URL is missing. Webhook logging is disabled.',
    );

    return;
  }

  initialized = true;

  console.log = (...args) => {
    originalConsole.log(...args);
    void sendWebhook('log', ...args);
  };

  console.info = (...args) => {
    originalConsole.info(...args);
    void sendWebhook('info', ...args);
  };

  console.warn = (...args) => {
    originalConsole.warn(...args);
    void sendWebhook('warn', ...args);
  };

  console.error = (...args) => {
    originalConsole.error(...args);
    void sendWebhook('error', ...args);
  };

  originalConsole.log(
    '[Voicey] Webhook logging initialized.',
  );

  void sendWebhook(
    'info',
    'Webhook logging initialized successfully.',
  );
}

export function log(...args) {
  return sendWebhook('log', ...args);
}

export function logInfo(...args) {
  return sendWebhook('info', ...args);
}

export function logWarn(...args) {
  return sendWebhook('warn', ...args);
}

export function logError(...args) {
  return sendWebhook('error', ...args);
}