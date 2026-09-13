import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isTrustedDocumentServiceCall } from '../../supabase/functions/_shared/document-internal-auth';

const key = 'test-only-not-a-real-key';
const marker = 'external-document-form';
it('accepts only the configured service secret and exact internal marker', () => {
  expect(isTrustedDocumentServiceCall(new Headers({ authorization: `Bearer ${key}`, 'x-internal-call': marker }), key, marker)).toBe(true);
});
it.each([
  ['Bearer forged.' + btoa('{"role":"service_role"}') + '.forged', marker],
  ['Bearer test-only-not-a-real-keX', marker],
  [`Bearer ${key}`, 'another-function'],
  [`Bearer ${key}`, ''],
  ['', marker],
])('rejects untrusted credentials regardless of role claims', (authorization, claimedMarker) => {
  expect(isTrustedDocumentServiceCall(new Headers({ authorization, 'x-internal-call': claimedMarker }), key, marker)).toBe(false);
});
it('fails closed when the configured secret is absent', () => {
  expect(isTrustedDocumentServiceCall(new Headers({ authorization: 'Bearer ', 'x-internal-call': marker }), '', marker)).toBe(false);
});

it('rejects a forged service role before reading any package session in the real handler', async () => {
  let handler!: (req: Request) => Promise<Response>;
  let reads = 0;
  const source = readFileSync('supabase/functions/ai-generate-document-package/index.ts', 'utf8').replace(/^import[^;]+;\s*/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const db = { auth: { getUser: async () => ({ data: { user: null }, error: { message: 'invalid token' } }) },
    from: () => { reads++; throw new Error('Must not read session'); } };
  new Function('Deno', 'createClient', 'isTrustedDocumentServiceCall', js)(
    { env: { get: () => key }, serve: (fn: typeof handler) => { handler = fn; } }, () => db, isTrustedDocumentServiceCall,
  );
  const response = await handler(new Request('https://test.invalid', { method: 'POST',
    headers: { authorization: 'Bearer forged.' + btoa('{"role":"service_role"}') + '.forged', 'x-internal-call': marker },
    body: JSON.stringify({ package_session_id: '00000000-0000-4000-8000-000000000009', run_mode: 'external_submit' }),
  }));
  expect(response.status).toBe(401); expect(reads).toBe(0);
});
