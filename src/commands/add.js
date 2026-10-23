import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { trust } from '../services/channelControls.js';

export default {
  name: 'add',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    const targetId = extractUserId(message, args);
    await trust(ctx, targetId);
  },
};
