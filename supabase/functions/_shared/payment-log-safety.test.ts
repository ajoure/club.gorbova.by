const files = [
  ['../admin-manual-charge/index.ts', "console.log('bePaid response:', JSON.stringify(chargeResult))", "console.log('bePaid response received'"],
  ['../bepaid-create-token/index.ts', "console.log('bePaid subscription response:', JSON.stringify(bepaidData, null, 2))", "console.log('bePaid subscription response received'"],
  ['../bepaid-get-payment-docs/index.ts', "console.log('bePaid transaction response:', JSON.stringify(txData, null, 2))", "console.log('bePaid transaction response received'"],
  ['../bepaid-webhook/index.ts', "console.log('[WEBHOOK-BODY] bePaid webhook received:', JSON.stringify(body, null, 2))", "console.log('[WEBHOOK-BODY] bePaid webhook received'"],
  ['../subscription-admin-actions/index.ts', "console.log('bePaid refund response:', JSON.stringify(bepaidRefundResult))", "console.log('bePaid refund response received'"],
  ['../subscription-charge/index.ts', "console.log('bePaid charge result:', chargeResult)", "console.log('bePaid charge response received'"],
] as const;

Deno.test('bePaid handlers do not log full provider payloads', async () => {
  for (const [relativePath, forbidden, expected] of files) {
    const source = await Deno.readTextFile(new URL(relativePath, import.meta.url));
    if (source.includes(forbidden)) {
      throw new Error(`${relativePath} still contains a full provider payload log`);
    }
    if (!source.includes(expected)) {
      throw new Error(`${relativePath} is missing its metadata-only provider log`);
    }
  }
});
