import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { isSubmissionRequestId, submissionFingerprint, submissionReplay } from '../../supabase/functions/_shared/document-submission-request';
import { recordExternalGeneration } from '../../supabase/functions/_shared/document-generation-outcome';

const requestId = '00000000-0000-4000-8000-000000000007';
const documentId = '00000000-0000-4000-8000-000000000008';
function harness(holdGeneration = false, failLinkSave = false) {
  let handler!: (req: Request) => Promise<Response>;
  const submissions: any[] = []; const sessions: any[] = [];
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/ai-generate-document-package')) {
      if (holdGeneration) await pending;
      return Response.json({ success: true, status: 'generated', results: [{ status: 'generated', document_id: documentId }] });
    }
    if (url.endsWith('/canonical-document-send')) return Response.json({ success: true });
    throw new Error('Unexpected network call');
  });
  const rows: Record<string, any[]> = {
    document_package_external_links: [{ id: 'link', public_token: 'test-link', is_active: true, external_form_id: 'form', owner_profile_id: 'profile', selected_legal_entity_id: 'entity', metadata: {} }],
    document_package_external_forms: [{ id: 'form', is_active: true, package_template_item_id: 'item', delivery: { email: false, telegram: false } }],
    document_package_template_items: [{ id: 'item', package_template_id: 'package' }],
    document_package_external_form_fields: [], document_package_role_catalog: [],
    profiles: [{ id: 'profile', user_id: 'user' }],
    document_package_external_submissions: submissions, document_package_sessions: sessions,
  };
  const db = {
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      const filters: Record<string, unknown> = {}; let insert: any; let update: any;
      const execute = (single: boolean) => {
        if (!rows[table]) throw new Error(`Unexpected table ${table}`);
        let data = rows[table].filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        if (insert) {
          if (table === 'document_package_external_submissions' && submissions.some(s => s.external_link_id === insert.external_link_id && s.request_id === insert.request_id)) return { data: null, error: { code: '23505' } };
          const row = { id: crypto.randomUUID(), metadata: {}, ...insert }; rows[table].push(row); data = [row];
        }
        if (update) {
          if (failLinkSave && update.package_session_id) return { data: null, error: { code: 'test' } };
          data.forEach(row => Object.assign(row, update));
        }
        return { data: single ? data[0] ?? null : data, error: null };
      };
      const q: any = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; }, order: () => q,
        insert: (value: any) => { insert = value; return q; }, update: (value: any) => { update = value; return q; },
        single: async () => execute(true), maybeSingle: async () => execute(true), then: (resolve: any) => resolve(execute(false)) };
      return q;
    },
  };
  const source = readFileSync('supabase/functions/external-document-form/index.ts', 'utf8').replace(/^import[^;]+;\s*/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function('Deno', 'createClient', 'isSubmissionRequestId', 'submissionFingerprint', 'submissionReplay', 'recordExternalGeneration', 'fetch', js)(
    { env: { get: () => 'https://test.invalid' }, serve: (fn: typeof handler) => { handler = fn; } }, () => db,
    isSubmissionRequestId, submissionFingerprint, submissionReplay, recordExternalGeneration, fetch,
  );
  return { fetch, submissions, sessions, finish, call: (extra: any = {}) => handler(new Request('https://test.invalid', {
    method: 'POST', body: JSON.stringify({ action: 'submit', token: 'test-link', request_id: requestId, fields: {}, repeat_groups: {}, attachments: [], ...extra }),
  })) };
}

it('executes only one generation and delivery across concurrent and completed replays', async () => {
  const h = harness(true);
  const first = h.call();
  await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
  const concurrent = await (await h.call()).json();
  expect(concurrent).toMatchObject({ replayed: true, success: false, error: 'generation_in_progress' });
  expect(h.sessions).toHaveLength(1); expect(h.submissions).toHaveLength(1);
  h.finish();
  expect(await (await first).json()).toMatchObject({ success: true, document_ids: [documentId], delivery_complete: true });
  const replay = await (await h.call()).json();
  expect(replay).toMatchObject({ replayed: true, success: true, delivery_complete: true, document_ids: [documentId] });
  expect(h.fetch).toHaveBeenCalledTimes(2);
  const status = await (await h.call({ action: 'submission_status' })).json();
  expect(status).toMatchObject({ found: true, success: true });
  expect(h.fetch).toHaveBeenCalledTimes(2);
});
it('rejects changed payload for the same attempt without starting another generator', async () => {
  const h = harness(); await h.call();
  const response = await h.call({ fields: { changed: 'new value' } });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'submission_request_conflict' });
  expect(h.submissions).toHaveLength(1); expect(h.fetch).toHaveBeenCalledTimes(2);
});
it('rejects missing attempt IDs and foreign attachment paths before writes', async () => {
  const h = harness();
  expect((await h.call({ request_id: null })).status).toBe(400);
  expect((await h.call({ attachments: [{ path: 'links/foreign/file' }] })).status).toBe(400);
  expect(h.submissions).toHaveLength(0); expect(h.fetch).not.toHaveBeenCalled();
});
it('does not generate when the session checkpoint cannot be saved', async () => {
  const h = harness(false, true);
  expect((await h.call()).status).toBe(503);
  expect(h.fetch).not.toHaveBeenCalled();
  expect((await (await h.call()).json()).error).toBe('generation_in_progress');
  expect(h.sessions).toHaveLength(1);
});
