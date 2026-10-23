import { resolveControlContext } from '../utils/resolveControlContext.js';
import { claim } from '../services/channelControls.js';

export default {
  name: 'claim',
  async execute({ client, message, locale }) {
    const ctx = await resolveControlContext({ client, message, locale });
    if (!ctx) return;
    await claim(ctx);
  },
};
