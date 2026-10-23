import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { block } from '../services/channelControls.js';

export default {
  name: 'block',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    const targetId = extractUserId(message, args);
    await block(ctx, targetId);
  },
};
