import { describe, expect, it } from 'vitest';
import { authenticateBepaidWebhookRequest } from '../../supabase/functions/_shared/bepaid-webhook-auth';

const body = JSON.stringify({ transaction: { uid: 'tx-1', status: 'successful' } });
const endpoint = 'https://example.test/functions/v1/payment-methods-webhook';

function toBase64(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function createRsaFixture() {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const publicKey = `-----BEGIN PUBLIC KEY-----\n${toBase64(spki)}\n-----END PUBLIC KEY-----`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keys.privateKey,
    new TextEncoder().encode(body),
  ));
  return { publicKey, signature: toBase64(signature) };
}

describe('authenticateBepaidWebhookRequest', () => {
  const credentials = { shopId: 'shop-1', secretKey: 'secret-1', publicKey: null };

  it('accepts matching Basic authentication', async () => {
    const req = new Request(endpoint, {
      headers: { Authorization: `Basic ${btoa('shop-1:secret-1')}` },
    });
    await expect(authenticateBepaidWebhookRequest(req, body, credentials))
      .resolves.toEqual({ ok: true, method: 'basic' });
  });

  it('rejects invalid and missing Basic authentication', async () => {
    const invalid = new Request(endpoint, {
      headers: { Authorization: `Basic ${btoa('shop-1:wrong-secret')}` },
    });
    await expect(authenticateBepaidWebhookRequest(invalid, body, credentials))
      .resolves.toEqual({ ok: false, reason: 'invalid_basic_auth' });
    await expect(authenticateBepaidWebhookRequest(new Request(endpoint), body, credentials))
      .resolves.toEqual({ ok: false, reason: 'missing_auth' });
  });

  it('accepts a valid RSA signature and rejects a modified body', async () => {
    const rsa = await createRsaFixture();
    const req = new Request(endpoint, { headers: { 'Content-Signature': rsa.signature } });
    const rsaCredentials = { ...credentials, publicKey: rsa.publicKey };

    await expect(authenticateBepaidWebhookRequest(req, body, rsaCredentials))
      .resolves.toEqual({ ok: true, method: 'rsa' });
    await expect(authenticateBepaidWebhookRequest(req, `${body} `, rsaCredentials))
      .resolves.toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('fails closed when a signature arrives without a configured public key', async () => {
    const req = new Request(endpoint, { headers: { 'Content-Signature': 'not-a-signature' } });
    await expect(authenticateBepaidWebhookRequest(req, body, credentials))
      .resolves.toEqual({ ok: false, reason: 'missing_public_key' });
  });
});
