import { resolveControlContext } from '../utils/resolveControlContext.js';
import { limit } from '../services/channelControls.js';

export default {
  name: 'limit',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await limit(ctx, args[0]);
  },
};
