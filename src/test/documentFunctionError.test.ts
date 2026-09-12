import { describe, expect, it } from 'vitest';
import { documentFunctionError, packageDocumentTotal } from '@/utils/documentFunctionError';

describe('document error boundary', () => {
  it('reads and preserves the original Response body instead of exposing non-2xx', async () => {
    const context = Response.json({ error: 'generation_failed', error_code: 'required_field_missing', field_id: 'private-id' }, { status: 400 });
    const error = await documentFunctionError({ message: 'Edge Function returned a non-2xx status code', context }, null, 'submit');
    expect(error.message).toBe('Заполните все обязательные поля анкеты.');
    expect(error.retryUnsafe).toBe(false);
    expect((await context.json()).field_id).toBe('private-id');
  });
  it.each([
    '<html>private@example.test https://private.test/?token=secret</html>',
    { error: 'SQL private@example.test', details: 'secret signed URL' },
    { error: { message: 'private nested data' } },
  ])('does not display an unrecognized body or encourage a duplicate submit', async body => {
    const error = await documentFunctionError({ context: Response.json(body) }, undefined, 'submit');
    expect(error.code).toBe('generation_outcome_unknown');
    expect(error.retryUnsafe).toBe(true);
    expect(error.message).not.toMatch(/secret|private|SQL|html/);
  });
  it('reads item errors and strips details after the allowed code', async () => {
    const error = await documentFunctionError(null, { results: [{ errors: ['role_assignment_missing:ln-000018:private-name'] }] });
    expect(error.code).toBe('role_assignment_missing');
    expect(error.message).not.toContain('private-name');
  });
  it('handles consumed response bodies safely', async () => {
    const context = Response.json({ error: 'private text' }); await context.text();
    expect((await documentFunctionError({ context }, undefined, 'read')).code).toBe('document_request_failed');
  });
  it('keeps known legacy template failures meaningful', async () => {
    expect((await documentFunctionError(null, { error: 'Failed to download template file' })).code).toBe('download_failed');
  });
});

describe('document totals across package contract versions', () => {
  it.each([
    [{ total_items: 1, total_documents: 4, generated: 3, errors: 1 }, 4],
    [{ total: 6, generated: 2 }, 6],
    [{ generated: 2, errors: 1, blocked: 2 }, 5],
    [{ total_items: 3 }, 3],
    [{ total_documents: 0, total_items: 3 }, 0],
    [{ total_documents: Number.NaN, total: -1, results: [{}, {}] }, 2],
    [{}, 0],
  ])('uses document totals, never template item totals as the primary denominator', (value, expected) => {
    expect(packageDocumentTotal(value)).toBe(expected);
  });
});
