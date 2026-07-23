import { assertEquals } from 'jsr:@std/assert@1';
import {
  SAVED_CARDS_DISABLED,
  savedCardsDisabledResponse,
} from './saved-cards-disabled.ts';

Deno.test('saved-card kill switch returns a stable 410 contract', async () => {
  assertEquals(SAVED_CARDS_DISABLED, true);
  const response = savedCardsDisabledResponse({ 'Access-Control-Allow-Origin': '*' });
  assertEquals(response.status, 410);
  assertEquals(await response.json(), {
    success: false,
    error: 'saved_cards_disabled',
    message: 'Оплата сохранённой картой отключена. Используйте защищённую страницу оплаты.',
  });
});

Deno.test('customer-callable saved-card endpoints guard before database access', async () => {
  for (const relativePath of [
    '../payment-methods-tokenize/index.ts',
    '../public-charge-saved-card/index.ts',
    '../payment-dialog-create-bridge-link/index.ts',
  ]) {
    const source = await Deno.readTextFile(new URL(relativePath, import.meta.url));
    const guardIndex = source.indexOf('if (SAVED_CARDS_DISABLED)');
    const singleQuoteDatabaseIndex = source.indexOf("Deno.env.get('SUPABASE_URL')");
    const doubleQuoteDatabaseIndex = source.indexOf('Deno.env.get("SUPABASE_URL")');
    const databaseIndex =
      singleQuoteDatabaseIndex === -1 ? doubleQuoteDatabaseIndex : singleQuoteDatabaseIndex;

    assertEquals(guardIndex >= 0, true, `${relativePath}: missing kill switch`);
    assertEquals(
      databaseIndex === -1 || guardIndex < databaseIndex,
      true,
      `${relativePath}: database access happens before kill switch`,
    );
  }
});

Deno.test('consultation standard checkout preserves Stripe-only offer routing', async () => {
  const dialogSource = await Deno.readTextFile(
    new URL('../../../src/components/payment/PaymentDialog.tsx', import.meta.url),
  );
  const checkoutSource = await Deno.readTextFile(
    new URL('../bepaid-create-token/index.ts', import.meta.url),
  );

  assertEquals(dialogSource.includes('offerId,'), true);
  assertEquals(dialogSource.includes('useMitTokenization: shouldUseMitTokenization'), true);
  assertEquals(dialogSource.includes('const shouldUseMitTokenization = false'), true);
  assertEquals(
    checkoutSource.includes('allowedPaymentProviders.length === 1') &&
      checkoutSource.includes('effectiveProvider = allowedPaymentProviders[0]') &&
      checkoutSource.includes('provider: effectiveProvider'),
    true,
  );
  assertEquals(
    checkoutSource.indexOf('if (useMitTokenization)') <
      checkoutSource.indexOf('if (!productId || !customerEmail)'),
    true,
  );
});
