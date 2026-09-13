// Execute the actual handler with in-memory services; no production/network calls.
import { readFileSync } from 'node:fs';
import { Blob } from 'node:buffer';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function harness(failure?: 'save' | 'url' | 'upload') {
  let handler!: (req: Request) => Promise<Response>;
  const records: any[] = [];
  const uploads: any[] = [];
  const render = vi.fn();
  const rows: Record<string, any[]> = {
    profiles: [{ id: 'own-profile', user_id: 'user' }],
    document_templates: [{ id: 'template', name: 'Test', template_path: 'test-template', placeholders: ['document.number'] }],
    client_legal_details: [{ id: 'foreign-entity', profile_id: 'other' }, { id: 'own-entity', profile_id: 'own-profile' }],
    legal_details_persons: [{ id: 'foreign-person', profile_id: 'other' }],
    legal_details_entity_person_links: [
      { id: 'foreign-link', profile_id: 'other' },
      { id: 'wrong-signer', profile_id: 'own-profile', legal_details_id: 'own-entity', person: { id: 'foreign-person', profile_id: 'other' } },
      { id: 'wrong-entity', profile_id: 'own-profile', legal_details_id: 'another-entity', person: { id: 'p', profile_id: 'own-profile' } },
    ],
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: (table: string) => {
      const filters: Record<string, unknown> = {}; let inserted: any;
      const execute = () => inserted
        ? failure === 'save' ? { data: null, error: { message: 'test save failure' } } : { data: { id: 'saved-document' }, error: null }
        : { data: rows[table]?.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)), error: null };
      const q: any = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
        insert: (row: any) => { inserted = row; records.push(row); return q; }, single: async () => execute(), then: (resolve: any) => resolve(execute()) };
      return q;
    },
    storage: { from: () => ({
      download: async () => ({ data: new Blob(['test-template']), error: null }),
      upload: async (...args: any[]) => { uploads.push(args); return { error: failure === 'upload' ? { message: 'test upload failure' } : null }; },
      createSignedUrl: async () => ({ data: failure === 'url' ? null : { signedUrl: 'test-download' }, error: failure === 'url' ? { message: 'test url failure' } : null }),
    }) },
  };
  let source = readFileSync('supabase/functions/ai-generate-document/index.ts', 'utf8');
  source = source.replace(/^import[^;]+;\s*/gm, '')
    .replace('await import("../_shared/docx-core-props.ts")', '({ patchDocxCoreProps: () => {} })');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  class FakeDoc { render = render; getZip() { return { generate: () => new Uint8Array([1, 2, 3]) }; } }
  new Function('serve', 'createClient', 'Deno', 'Docxtemplater', 'PizZip', js)(
    (fn: typeof handler) => { handler = fn; }, () => db, { env: { get: () => 'test-only' } }, FakeDoc, class {},
  );
  return { records, uploads, render, call: (extra: any = {}) => handler(new Request('https://test.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: JSON.stringify({ template_id: 'template', ...extra }),
  })) };
}

describe('legacy generator persistence and isolation', () => {
  it.each([
    { legal_details_id: 'foreign-entity' }, { person_id: 'foreign-person' },
    { signer_link_id: 'foreign-link' }, { signer_link_id: 'wrong-signer' },
    { legal_details_id: 'own-entity', signer_link_id: 'wrong-entity' },
  ])('rejects foreign or inconsistent references before rendering: %j', async refs => {
    const h = harness(); const response = await h.call(refs);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(h.render).not.toHaveBeenCalled(); expect(h.uploads).toHaveLength(0);
  });
  it.each(['save', 'url', 'upload'] as const)('never reports success after %s failure', async failure => {
    const h = harness(failure); const response = await h.call();
    expect(response.status).toBeGreaterThanOrEqual(500);
    const body = await response.json();
    expect(body.success).not.toBe(true); expect(body.download_url).toBeUndefined();
  });
  it('uses distinct immutable file paths and matches each rendered number to its record', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.123);
    const h = harness();
    const first = await (await h.call()).json(); const second = await (await h.call()).json();
    expect(first.success).toBe(true); expect(second.success).toBe(true);
    random.mockRestore();
    expect(first.document_number).toBe(second.document_number);
    expect(h.uploads[0][0]).not.toBe(h.uploads[1][0]);
    h.uploads.forEach(upload => expect(upload[2].upsert).toBe(false));
    [first, second].forEach((body, index) => {
      expect(h.render.mock.calls[index][0]['document.number']).toBe(body.document_number);
      expect(h.records[index].file_name).toBe(`${body.document_number}.docx`);
    });
  });
});
