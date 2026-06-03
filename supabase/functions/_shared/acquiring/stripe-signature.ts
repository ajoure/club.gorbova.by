// Phase 2 — Stripe webhook signature verification.
// Implements `Stripe-Signature` header check using HMAC-SHA256 + tolerance window.
// Spec: https://docs.stripe.com/webhooks/signatures
//
// IMPORTANT: must be called with the RAW request body (string), NOT JSON-parsed.

const DEFAULT_TOLERANCE_SEC = 300;

function parseSigHeader(header: string): { t: number | null; v1: string[] } {
  const parts = header.split(',').map((p) => p.trim());
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) t = parsed;
    } else if (key === 'v1') {
      v1.push(value);
    }
  }
  return { t, v1 };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export interface VerifyStripeSignatureResult {
  valid: boolean;
  reason?: 'no_header' | 'no_timestamp' | 'no_v1' | 'mismatch' | 'expired';
  timestamp?: number;
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSec = DEFAULT_TOLERANCE_SEC,
): Promise<VerifyStripeSignatureResult> {
  if (!signatureHeader) return { valid: false, reason: 'no_header' };
  const { t, v1 } = parseSigHeader(signatureHeader);
  if (t === null) return { valid: false, reason: 'no_timestamp' };
  if (v1.length === 0) return { valid: false, reason: 'no_v1' };

  const signedPayload = `${t}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);
  const match = v1.some((sig) => timingSafeEqualHex(sig, expected));
  if (!match) return { valid: false, reason: 'mismatch', timestamp: t };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - t) > toleranceSec) {
    return { valid: false, reason: 'expired', timestamp: t };
  }
  return { valid: true, timestamp: t };
}
