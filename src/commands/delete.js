import { resolveControlContext } from '../utils/resolveControlContext.js';
import { del } from '../services/channelControls.js';

export default {
  name: 'delete',
  async execute({ client, message, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await del(ctx);
  },
};
