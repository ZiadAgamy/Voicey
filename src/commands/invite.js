import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { invite } from '../services/channelControls.js';

export default {
  name: 'invite',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    const targetId = extractUserId(message, args);
    await invite(ctx, targetId);
  },
};
