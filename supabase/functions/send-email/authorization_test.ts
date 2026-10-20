import { assertEquals } from 'jsr:@std/assert@1';
import { authorizeEmailSender } from './authorization.ts';

const key = 'sb_secret_fixture_only';
const request = (headers: Record<string, string> = {}) => new Request('https://example.test', { headers });
const invalid = async () => ({ data: null, error: 'invalid' });
const valid = async () => ({ data: { claims: { sub: 'staff' } } });

Deno.test('managed opaque service keys work in apikey without a user JWT', async () => {
  assertEquals(await authorizeEmailSender(request({ apikey: key }), key, invalid, async () => false), { allowed: true, kind: 'service' });
  assertEquals(await authorizeEmailSender(request({ authorization: `Bearer ${key}` }), key, invalid, async () => false), { allowed: true, kind: 'service' });
});
Deno.test('anonymous, publishable and forged service claims never authorize SMTP', async () => {
  for (const headers of [{}, { apikey: 'sb_publishable_fixture' }, { authorization: 'Bearer forged-service-role-claim' }] as Record<string,string>[]) {
    assertEquals((await authorizeEmailSender(request(headers), key, invalid, async () => true)).allowed, false);
  }
});
Deno.test('ordinary verified users are denied, verified authorized staff are accepted', async () => {
  const r = request({ authorization: 'Bearer signed-user-token' });
  assertEquals(await authorizeEmailSender(r, key, valid, async () => false), { allowed: false, status: 403, reason: 'staff_access_required' });
  assertEquals(await authorizeEmailSender(r, key, valid, async () => true), { allowed: true, kind: 'staff' });
});
Deno.test('Auth and RBAC failures remain closed', async () => {
  const r = request({ authorization: 'Bearer token' });
  assertEquals((await authorizeEmailSender(r, key, async () => { throw new Error('auth down'); }, async () => true)).allowed, false);
  assertEquals((await authorizeEmailSender(r, key, valid, async () => { throw new Error('rbac down'); })).allowed, false);
  assertEquals((await authorizeEmailSender(request({ apikey: '' }), '', valid, async () => true)).allowed, false);
});
