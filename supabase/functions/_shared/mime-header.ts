// Shared helper for RFC 2047 MIME "encoded-word" of email headers.
// Prevents raw non-ASCII in headers like From/Subject/Reply-To/Sender,
// which Apple Mail and other clients otherwise render as EMPTY-FROM
// or garbled sender names.
//
// Usage:
//   encodeMimeHeader("Екатерина Горбова") -> =?UTF-8?B?...?=
//   encodeMimeHeader("Gorbova")           -> Gorbova
//   encodeAddressHeader("Name", "a@b.by") -> "Name" <a@b.by> (quoted if ASCII)
//                                          or =?UTF-8?B?...?= <a@b.by>
import { encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

const enc = new TextEncoder();

function isPureAscii(v: string): boolean {
  // Printable ASCII only (0x20-0x7E). Tab and control chars force encoding too.
  return /^[\x20-\x7E]*$/.test(v);
}

export function encodeMimeHeader(value: string): string {
  if (isPureAscii(value)) return value;
  const b64 = encode(enc.encode(value).buffer);
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Build an RFC 5322 address header value ("Name" <email> or encoded form).
 * Always safe: display name is either quoted-ASCII or MIME-encoded.
 */
export function encodeAddressHeader(displayName: string, email: string): string {
  if (!displayName) return `<${email}>`;
  if (isPureAscii(displayName)) {
    const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}" <${email}>`;
  }
  return `${encodeMimeHeader(displayName)} <${email}>`;
}
