import { assertEquals } from 'jsr:@std/assert@1'
import { requestToken } from './request-token.ts'

Deno.test('reads the legacy GET token', async () => {
  assertEquals(
    await requestToken(new Request('https://example.test/unsubscribe?token=legacy-token')),
    'legacy-token',
  )
})

Deno.test('reads the page JSON token', async () => {
  assertEquals(
    await requestToken(new Request('https://example.test/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'page-token' }),
    })),
    'page-token',
  )
})

Deno.test('keeps the query token for RFC 8058 one-click unsubscribe', async () => {
  assertEquals(
    await requestToken(new Request('https://example.test/unsubscribe?token=one-click-token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })),
    'one-click-token',
  )
})

Deno.test('accepts the former form-body token when no one-click marker exists', async () => {
  assertEquals(
    await requestToken(new Request('https://example.test/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=form-token',
    })),
    'form-token',
  )
})
