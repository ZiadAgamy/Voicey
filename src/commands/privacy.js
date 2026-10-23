import { resolveControlContext } from '../utils/resolveControlContext.js';
import { privacy } from '../services/channelControls.js';

export default {
  name: 'privacy',
  async execute({ client, message, args, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await privacy(ctx, args[0]?.toLowerCase());
  },
};
