import { randomBytes } from 'node:crypto';

/** Records the send and sends nothing — the behaviour the app has always had. */
export const simulatedProvider = {
  name: 'simulated',
  isConfigured: () => true,
  fromAddress: () => null,
  async send() {
    return { providerMessageId: `sim_${randomBytes(6).toString('hex')}`, status: 'simulated' };
  },
};
