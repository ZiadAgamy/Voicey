import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { unban } from '../services/channelControls.js';

export default {
  name: 'unban',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await unban(ctx, extractUserId(message, args));
  },
};
