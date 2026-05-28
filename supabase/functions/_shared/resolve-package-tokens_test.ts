// Sprint 3C — Deno tests for resolvePackageTokenCore.
// Запуск через `supabase test edge_functions` или Deno test runner.
// Тесты не дергают сеть: supabase-клиент мокается локальным stub.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  resolvePackageTokenCore,
  HARDCODED_ENABLED,
  resolvePackageToken,
} from './resolve-package-tokens.ts';

type Row = Record<string, unknown>;

interface TableState {
  document_package_token_aliases: Row[];
  document_package_session_participants: Row[];
  legal_details_persons: Row[];
}

/** Минимальный chainable stub Supabase для трёх таблиц. */
function makeStubSupabase(state: TableState) {
  function fromTable(name: keyof TableState) {
    const rows = state[name] ?? [];
    // deno-lint-ignore no-explicit-any
    const filters: Array<(r: Row) => boolean> = [];

    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        const filtered = rows.filter((r) => filters.every((f) => f(r)));
        resolve({ data: filtered, error: null });
      },
      async maybeSingle() {
        const filtered = rows.filter((r) => filters.every((f) => f(r)));
        return { data: filtered[0] ?? null, error: null };
      },
    };
    return builder;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (n: string) => fromTable(n as keyof TableState) } as any;
}

const ALIAS_FULL_NAME: Row = {
  id: 'a-1',
  alias_token: 'package.roles.company_head.full_name',
  canonical_field_public_id: 'FLD-000372',
  role_key: 'company_head',
  context_kind: 'package_person',
  source_path: null,
  archived_at: null,
};

const ALIAS_POSITION: Row = {
  id: 'a-2',
  alias_token: 'package.roles.company_head.position',
  canonical_field_public_id: 'FLD-000373',
  role_key: 'company_head',
  context_kind: 'package_metadata',
  source_path: 'metadata.position',
  archived_at: null,
};

const ALIAS_BROKEN_CTX: Row = {
  id: 'a-3',
  alias_token: 'package.roles.x.bad',
  canonical_field_public_id: 'FLD-000999',
  role_key: 'company_head',
  context_kind: 'something_unknown',
  source_path: null,
  archived_at: null,
};

const SESSION_ID = '00000000-0000-0000-0000-000000000001';

Deno.test('HARDCODED_ENABLED stays false in Sprint 3C', () => {
  assertEquals(HARDCODED_ENABLED, false);
});

Deno.test('public resolvePackageToken returns feature_off (flag guard intact)', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_FULL_NAME],
    document_package_session_participants: [],
    legal_details_persons: [],
  });
  const r = await resolvePackageToken({
    rawToken: 'package.roles.company_head.full_name',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, 'feature_off');
});

Deno.test('alias_missing → code alias_missing', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [],
    document_package_session_participants: [],
    legal_details_persons: [],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.unknown.full_name',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, 'alias_missing');
});

Deno.test('participant_missing when no row for role', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_FULL_NAME],
    document_package_session_participants: [],
    legal_details_persons: [],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.company_head.full_name',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, 'participant_missing');
});

Deno.test('package_person happy path', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_FULL_NAME],
    document_package_session_participants: [
      {
        package_session_id: SESSION_ID,
        role_key: 'company_head',
        person_id: 'p-1',
        entity_type: 'person',
        metadata: {},
      },
    ],
    legal_details_persons: [{ id: 'p-1', full_name: 'Иванов И.И.' }],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.company_head.full_name',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, true);
  if (r.resolved) {
    assertEquals(r.value, 'Иванов И.И.');
    assertEquals(r.canonicalFieldPublicId, 'FLD-000372');
  }
});

Deno.test('package_person without person_id → no_person', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_FULL_NAME],
    document_package_session_participants: [
      {
        package_session_id: SESSION_ID,
        role_key: 'company_head',
        person_id: null,
        entity_type: 'person',
        metadata: {},
      },
    ],
    legal_details_persons: [],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.company_head.full_name',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, 'no_person');
});

Deno.test('package_metadata empty position → empty_value', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_POSITION],
    document_package_session_participants: [
      {
        package_session_id: SESSION_ID,
        role_key: 'company_head',
        person_id: 'p-1',
        entity_type: 'person',
        metadata: {},
      },
    ],
    legal_details_persons: [],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.company_head.position',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, 'empty_value');
});

Deno.test('package_metadata happy path', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_POSITION],
    document_package_session_participants: [
      {
        package_session_id: SESSION_ID,
        role_key: 'company_head',
        person_id: 'p-1',
        entity_type: 'person',
        metadata: { position: 'Директор' },
      },
    ],
    legal_details_persons: [],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.company_head.position',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, true);
  if (r.resolved) assertEquals(r.value, 'Директор');
});

Deno.test('multiple participants for one role → multiple_role_assignments', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_FULL_NAME],
    document_package_session_participants: [
      { package_session_id: SESSION_ID, role_key: 'company_head', person_id: 'p-1', entity_type: 'person', metadata: {} },
      { package_session_id: SESSION_ID, role_key: 'company_head', person_id: 'p-2', entity_type: 'person', metadata: {} },
    ],
    legal_details_persons: [{ id: 'p-1', full_name: 'A' }, { id: 'p-2', full_name: 'B' }],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.company_head.full_name',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, 'multiple_role_assignments');
});

Deno.test('unknown context_kind → config_error', async () => {
  const supabase = makeStubSupabase({
    document_package_token_aliases: [ALIAS_BROKEN_CTX],
    document_package_session_participants: [
      { package_session_id: SESSION_ID, role_key: 'company_head', person_id: 'p-1', entity_type: 'person', metadata: {} },
    ],
    legal_details_persons: [{ id: 'p-1', full_name: 'X' }],
  });
  const r = await resolvePackageTokenCore({
    rawToken: 'package.roles.x.bad',
    packageSessionId: SESSION_ID,
    supabase,
  });
  assertEquals(r.resolved, false);
  if (!r.resolved) assertEquals(r.code, 'config_error');
});
