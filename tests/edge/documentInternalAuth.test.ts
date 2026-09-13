import { expect, it } from 'vitest';
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
