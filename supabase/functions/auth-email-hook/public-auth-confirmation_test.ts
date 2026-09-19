import { assertEquals } from 'jsr:@std/assert@1'
import { publicAuthConfirmationUrl } from './public-auth-confirmation.ts'

Deno.test('keeps an allow-listed access alias for a signed Auth link', () => {
  const signed = 'https://project.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https%3A%2F%2Fa.club.gorbova.by%2Fauth'
  assertEquals(
    publicAuthConfirmationUrl({ url: signed }),
    'https://a.club.gorbova.by/auth-verify?token=abc&type=recovery&redirect_to=https%3A%2F%2Fa.club.gorbova.by%2Fauth',
  )
})

Deno.test('rejects an arbitrary redirect host and preserves signed parameters', () => {
  const signed = 'https://project.supabase.co/auth/v1/verify?token=abc&type=magiclink&redirect_to=https%3A%2F%2Fevil.example%2Fnext'
  assertEquals(
    publicAuthConfirmationUrl({ url: signed }),
    'https://gorbova.by/auth-verify?token=abc&type=magiclink&redirect_to=https%3A%2F%2Fevil.example%2Fnext',
  )
})

Deno.test('does not turn an invalid signed link into a public URL', () => {
  assertEquals(publicAuthConfirmationUrl({ url: 'not a URL' }), 'not a URL')
})
