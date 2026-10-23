import { resolveControlContext, extractUserId } from '../utils/resolveControlContext.js';
import { transfer } from '../services/channelControls.js';

export default {
  name: 'transfer',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await transfer(ctx, extractUserId(message, args));
  },
};
