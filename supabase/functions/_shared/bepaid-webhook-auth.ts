export interface BepaidWebhookAuthCredentials {
  shopId: string;
  secretKey: string;
  publicKey: string | null;
}

export type BepaidWebhookAuthResult =
  | { ok: true; method: 'basic' | 'rsa' }
  | { ok: false; reason: 'missing_auth' | 'invalid_basic_auth' | 'missing_public_key' | 'invalid_signature' };

function normalizePemPublicKey(rawKey: string | null): string | null {
  if (!rawKey) return null;

  const key = rawKey
    .trim()
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/[\r\n\s]/g, '');

  if (!key) return null;

  const lines: string[] = [];
  for (let i = 0; i < key.length; i += 64) lines.push(key.substring(i, i + 64));
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let i = 0; i < length; i += 1) {
    mismatch |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
  }

  return mismatch === 0;
}

async function verifyRsaSignature(body: string, signature: string, publicKey: string): Promise<boolean> {
  try {
    const normalizedKey = normalizePemPublicKey(publicKey);
    if (!normalizedKey) return false;

    const signatureBytes = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0));
    const pemContents = normalizedKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    const keyBytes = Uint8Array.from(atob(pemContents), (char) => char.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes,
      new TextEncoder().encode(body),
    );
  } catch {
    return false;
  }
}

export async function authenticateBepaidWebhookRequest(
  req: Request,
  rawBody: string,
  credentials: BepaidWebhookAuthCredentials,
): Promise<BepaidWebhookAuthResult> {
  const authorization = req.headers.get('Authorization');
  let basicAuthInvalid = false;

  if (authorization?.startsWith('Basic ')) {
    try {
      const decoded = atob(authorization.slice('Basic '.length));
      const separator = decoded.indexOf(':');
      const suppliedShopId = separator >= 0 ? decoded.slice(0, separator) : '';
      const suppliedSecret = separator >= 0 ? decoded.slice(separator + 1) : '';

      if (
        constantTimeEqual(suppliedShopId, credentials.shopId) &&
        constantTimeEqual(suppliedSecret, credentials.secretKey)
      ) {
        return { ok: true, method: 'basic' };
      }
      basicAuthInvalid = true;
    } catch {
      basicAuthInvalid = true;
    }
  }

  const signature = req.headers.get('Content-Signature')
    ?? req.headers.get('X-Signature')
    ?? req.headers.get('X-Webhook-Signature');

  if (signature) {
    if (!credentials.publicKey) return { ok: false, reason: 'missing_public_key' };
    const verified = await verifyRsaSignature(rawBody, signature, credentials.publicKey);
    return verified
      ? { ok: true, method: 'rsa' }
      : { ok: false, reason: 'invalid_signature' };
  }

  return basicAuthInvalid
    ? { ok: false, reason: 'invalid_basic_auth' }
    : { ok: false, reason: 'missing_auth' };
}
