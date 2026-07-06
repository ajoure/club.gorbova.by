// Shared crypto helpers for inline-OTP HMAC and constant-time compare.
// Uses HMAC-SHA256 with per-row salt AND server pepper (INLINE_OTP_PEPPER).
// This means table-only leak cannot brute-force 6-digit codes without the
// pepper.

const encoder = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function hmacOtp(
  code: string,
  salt: string,
  pepper: string,
): Promise<string> {
  const key = await importHmacKey(pepper);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${salt}:${code}`),
  );
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateOtpCode(): string {
  // 6-digit code, cryptographically random.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = buf[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

export function generateSalt(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for") || "";
  // First IP is the client (Supabase edge sets this header from the platform proxy).
  const first = xff.split(",")[0]?.trim();
  if (first && /^[0-9a-f:.]+$/i.test(first)) return first;
  const real = req.headers.get("x-real-ip");
  if (real && /^[0-9a-f:.]+$/i.test(real)) return real;
  return null;
}
