import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { kick } from '../services/channelControls.js';

export default {
  name: 'kick',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await kick(ctx, extractUserId(message, args));
  },
};
