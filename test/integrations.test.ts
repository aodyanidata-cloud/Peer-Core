import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../src/integrations/registry';
import {
  LoggingSmsProvider,
  LoggingMessagingProvider,
} from '../src/modules/channels/logging-adapters';
import { SmsOtpSender } from '../src/modules/channels/sms-otp-sender';
import type { SmsProvider } from '../src/modules/channels/contracts';
import type { PosProvider, PosMenuItem } from '../src/modules/channels/pos-provider';

describe('integration contracts + registry (B7)', () => {
  it('resolves an adapter by name and swaps by config', () => {
    const reg = new AdapterRegistry<SmsProvider>();
    reg.register('logging', new LoggingSmsProvider());
    expect(reg.get('logging').name).toBe('logging');
    expect(reg.names()).toEqual(['logging']);
  });

  it('throws for an unknown adapter name', () => {
    const reg = new AdapterRegistry<SmsProvider>();
    expect(() => reg.get('nope')).toThrow(/no adapter/);
  });

  it('refuses to double-register the same name', () => {
    const reg = new AdapterRegistry<SmsProvider>();
    reg.register('logging', new LoggingSmsProvider());
    expect(() => reg.register('logging', new LoggingSmsProvider())).toThrow(
      /already registered/,
    );
  });

  it('the SMS adapter satisfies the OtpSender seam (contracts compose)', async () => {
    const sms = new LoggingSmsProvider();
    const sender = new SmsOtpSender(sms);
    await sender.send('+966500000001', '123456');
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].to).toBe('+966500000001');
    expect(sms.sent[0].body).toContain('123456');
  });

  it('a messaging adapter records sends via the contract', async () => {
    const wa = new LoggingMessagingProvider();
    await wa.send({ to: '+966500000001', body: 'hi', channel: 'whatsapp' });
    expect(wa.sent[0].channel).toBe('whatsapp');
  });

  it('the PosProvider contract shape maps POS ids onto the catalog (R3-ready)', async () => {
    // A fake POS adapter proving the contract is usable before Foodics exists.
    const fakePos: PosProvider = {
      name: 'fake',
      async fetchMenu(): Promise<PosMenuItem[]> {
        return [{ externalRef: 'foodics-42', name: 'Shawarma', priceMinor: 1800 }];
      },
      async pushOrder() {
        return { externalRef: 'foodics-order-7' };
      },
    };
    const reg = new AdapterRegistry<PosProvider>().register('fake', fakePos);
    const menu = await reg.get('fake').fetchMenu({});
    expect(menu[0].externalRef).toBe('foodics-42');
    expect(menu[0].priceMinor).toBe(1800);
  });
});
