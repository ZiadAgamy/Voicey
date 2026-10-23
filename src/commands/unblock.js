import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { unblock } from '../services/channelControls.js';

export default {
  name: 'unblock',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    const targetId = extractUserId(message, args);
    await unblock(ctx, targetId);
  },
};
