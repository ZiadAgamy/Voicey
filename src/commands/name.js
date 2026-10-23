import { resolveControlContext } from '../utils/resolveControlContext.js';
import { rename } from '../services/channelControls.js';

export default {
  name: 'name',
  aliases: ['rename'],
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await rename(ctx, args.join(' '));
  },
};
