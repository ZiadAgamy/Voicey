import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { ban } from '../services/channelControls.js';

export default {
  name: 'ban',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await ban(ctx, extractUserId(message, args));
  },
};
