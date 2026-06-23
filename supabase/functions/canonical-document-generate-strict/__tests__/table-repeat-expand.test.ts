// ============================================================================
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4 — unit tests
// Tests cover docx-table-repeat-expand.ts pure helpers + integration via
// fake PizZip + fake supabase. Tests do NOT touch Docxtemplater or storage.
//
// Run:
//   deno test supabase/functions/canonical-document-generate-strict/__tests__/table-repeat-expand.test.ts
// ============================================================================

import { assertEquals, assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  normalizeSplitMarkerRuns,
  findEnclosingTopLevelTr,
  extractTopLevelCells,
  setCellTextValue,
  applyTableRepeatExpansion,
} from '../../_shared/docx-table-repeat-expand.ts';
import {
  renderTableRepeatCell,
  readAssignmentCustomKey,
} from '../../_shared/table-repeat-cell-render.ts';

// ─── Fake PizZip ────────────────────────────────────────────────────────
function makeFakeZip(xml: string) {
  let current = xml;
  return {
    file(name: string, content?: string) {
      if (name !== 'word/document.xml') return null as any;
      if (typeof content === 'string') { current = content; return {}; }
      return { asText: () => current };
    },
    getXml() { return current; },
  };
}

// ─── Fake Supabase (minimal query builder) ──────────────────────────────
interface FakeRows {
  document_package_role_catalog: any[];
  document_package_item_role_assignments: any[];
  legal_details_persons: any[];
}
function makeFakeSupabase(rows: FakeRows) {
  return {
    from(table: keyof FakeRows) {
      const data = rows[table] || [];
      const builder: any = {
        _rows: [...data],
        _filters: [] as Array<(r: any) => boolean>,
        select() { return builder; },
        eq(col: string, val: any) { builder._filters.push((r: any) => r[col] === val); return builder; },
        in(col: string, vals: any[]) { builder._filters.push((r: any) => vals.includes(r[col])); return builder; },
        order() { return builder; },
        async maybeSingle() {
          const filtered = builder._rows.filter((r: any) => builder._filters.every((f: any) => f(r)));
          return { data: filtered[0] ?? null };
        },
        then(resolve: any) {
          const filtered = builder._rows.filter((r: any) => builder._filters.every((f: any) => f(r)));
          resolve({ data: filtered, error: null });
        },
      };
      return builder;
    },
  };
}

// ─── Helpers to build minimal DOCX XML fragments ────────────────────────
function rowXml(cellsTexts: string[]): string {
  const tcs = cellsTexts.map((t) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`).join('');
  return `<w:tr>${tcs}</w:tr>`;
}
function docXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:tbl>${body}</w:tbl></w:body></w:document>`;
}

// ────────────────────────────────────────────────────────────────────────
// 1. SPLIT MARKER ACROSS RUNS — ОБЯЗАТЕЛЬНЫЙ DoD
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#1 normalizeSplitMarkerRuns склеивает marker, разрезанный Word на несколько runs', () => {
  const splitTr = `<w:tr><w:tc><w:tcPr/><w:p>` +
    `<w:r><w:t>{{tableRepeat:</w:t></w:r>` +
    `<w:r><w:t>TR-00</w:t></w:r>` +
    `<w:r><w:t>0001}}</w:t></w:r>` +
    `</w:p></w:tc></w:tr>`;
  const normalized = normalizeSplitMarkerRuns(splitTr);
  assert(normalized.includes('{{tableRepeat:TR-000001}}'), 'marker должен быть склеен в один <w:t>');
});

// ────────────────────────────────────────────────────────────────────────
// 2. findEnclosingTopLevelTr
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#findEnclosingTopLevelTr находит ближайший <w:tr>', () => {
  const xml = docXml(rowXml(['header1', 'header2']) + rowXml(['{{tableRepeat:TR-000001}}', 'b']));
  const pos = xml.indexOf('{{tableRepeat');
  const bounds = findEnclosingTopLevelTr(xml, pos);
  assert(bounds, 'must find tr');
  const trXml = xml.slice(bounds!.start, bounds!.end);
  assert(trXml.startsWith('<w:tr>'));
  assert(trXml.endsWith('</w:tr>'));
  assert(trXml.includes('{{tableRepeat:TR-000001}}'));
});

// ────────────────────────────────────────────────────────────────────────
// 3. extractTopLevelCells
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#extractTopLevelCells возвращает физические <w:tc> top-level', () => {
  const tr = rowXml(['a', 'b', 'c']);
  const inner = tr.replace(/^<w:tr>/, '').replace(/<\/w:tr>$/, '');
  const cells = extractTopLevelCells(inner);
  assertEquals(cells.length, 3);
});

// ────────────────────────────────────────────────────────────────────────
// 4. setCellTextValue XML-escape + сохраняет tcPr
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#setCellTextValue XML-escape + tcPr', () => {
  const cell = `<w:tc><w:tcPr><w:tcW w:w="100"/></w:tcPr><w:p><w:r><w:t>old</w:t></w:r></w:p></w:tc>`;
  const out = setCellTextValue(cell, '<scary> & "quoted"');
  assert(out.includes('<w:tcW w:w="100"/>'), 'tcPr сохранён');
  assert(out.includes('&lt;scary&gt; &amp; &quot;quoted&quot;'), 'value экранирован');
  assertFalse(out.includes('old'));
});

// ────────────────────────────────────────────────────────────────────────
// 5. End-to-end: 3 assignments × 4 columns
// ────────────────────────────────────────────────────────────────────────
const ROLE_ID = '00000000-0000-0000-0000-0000000000aa';
const ITEM_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ID = '00000000-0000-0000-0000-0000000000cc';
const TPL_ID = '00000000-0000-0000-0000-0000000000dd';

function basicConfig() {
  return {
    role_catalog: [{
      id: ROLE_ID,
      role_key: 'ln-000015',
      package_template_id: TPL_ID,
      metadata: { assignment_custom_fields: [{ key: 'votes' }, { key: 'share_percent' }] },
    }],
    persons: [
      { id: 'p1', full_name: 'Иванов Иван Иванович', passport_number_full: 'AB1111111', personal_number: 'PN1' },
      { id: 'p2', full_name: 'Петров Петр Петрович', passport_number_full: 'AB2222222', personal_number: 'PN2' },
      { id: 'p3', full_name: 'Федорчук Фёдор Фёдорович', passport_number_full: 'AB3333333', personal_number: 'PN3' },
    ],
    assignments: [
      { role_catalog_id: ROLE_ID, package_session_id: SESSION_ID, package_template_item_id: ITEM_ID,
        is_active: true, sort_order: 1, created_at: '2026-01-01', id: 'a1', person_id: 'p1',
        metadata: { custom: { votes: '30', share_percent: '30' } } },
      { role_catalog_id: ROLE_ID, package_session_id: SESSION_ID, package_template_item_id: ITEM_ID,
        is_active: true, sort_order: 2, created_at: '2026-01-02', id: 'a2', person_id: 'p2',
        metadata: { custom: { votes: '20', share_percent: '20' } } },
      { role_catalog_id: ROLE_ID, package_session_id: SESSION_ID, package_template_item_id: ITEM_ID,
        is_active: true, sort_order: 3, created_at: '2026-01-03', id: 'a3', person_id: 'p3',
        metadata: { custom: { votes: '50', share_percent: '50' } } },
    ],
    itemMetadata: {
      table_repeats: [{
        id: 'TR-000001',
        role_catalog_id: ROLE_ID,
        columns: [
          { cell_index: 0, source_type: 'row_number' },
          { cell_index: 1, source_type: 'role_person', source_key: 'full_name' },
          { cell_index: 2, source_type: 'assignment_custom_field', source_key: 'votes' },
          { cell_index: 3, source_type: 'assignment_custom_field', source_key: 'share_percent' },
        ],
      }],
    },
  };
}

Deno.test('E.4#5 3 assignments × 4 cols → 3 строки в документе с правильными значениями', async () => {
  const cfg = basicConfig();
  const tr = `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>{{tableRepeat:TR-000001}}</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr/><w:p><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr/><w:p><w:r><w:t>Голосов</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr/><w:p><w:r><w:t>Доля</w:t></w:r></w:p></w:tc></w:tr>`;
  const xml = docXml(`${rowXml(['№','ФИО','Голосов','Доля'])}${tr}`);
  const zip = makeFakeZip(xml);
  const supabase = makeFakeSupabase({
    document_package_role_catalog: cfg.role_catalog,
    document_package_item_role_assignments: cfg.assignments,
    legal_details_persons: cfg.persons,
  });
  const report = await applyTableRepeatExpansion({
    zip: zip as any,
    supabase: supabase as any,
    packageSessionId: SESSION_ID,
    packageTemplateItemId: ITEM_ID,
    packageTemplateId: TPL_ID,
    itemMetadata: cfg.itemMetadata,
    isSuperAdmin: false,
    preresolvedPfFields: {},
  });
  assert(report.applied);
  assertEquals(report.markers.length, 1);
  assertEquals(report.markers[0].rows_count, 3);

  const finalXml = zip.getXml();
  assertFalse(finalXml.includes('{{tableRepeat:'), 'marker полностью удалён');
  // Должно быть 4 строки (1 заголовок + 3 person rows). Считаем top-level <w:tr>.
  const trCount = (finalXml.match(/<w:tr\b/g) || []).length;
  assertEquals(trCount, 4);
  // Значения assignment_custom_field
  assert(finalXml.includes('Иванов И. И.') || finalXml.includes('Иванов Иван Иванович'));
  assert(finalXml.includes('>30<') || finalXml.includes('>30<'));
  assert(finalXml.includes('>20<'));
  assert(finalXml.includes('>50<'));
});

// ────────────────────────────────────────────────────────────────────────
// 6. unknown TR id → severity=error
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#6 unknown TR id → severity=error, marker зачищен', async () => {
  const xml = docXml(rowXml(['{{tableRepeat:TR-000999}}']));
  const zip = makeFakeZip(xml);
  const supabase = makeFakeSupabase({
    document_package_role_catalog: [],
    document_package_item_role_assignments: [],
    legal_details_persons: [],
  });
  const report = await applyTableRepeatExpansion({
    zip: zip as any, supabase: supabase as any,
    packageSessionId: SESSION_ID,
    packageTemplateItemId: ITEM_ID,
    packageTemplateId: TPL_ID,
    itemMetadata: { table_repeats: [] },
    isSuperAdmin: false,
    preresolvedPfFields: {},
  });
  assertEquals(report.markers[0].code, 'tr_id_not_found');
  assertEquals(report.markers[0].severity, 'error');
  assertFalse(zip.getXml().includes('{{tableRepeat:'));
});

// ────────────────────────────────────────────────────────────────────────
// 7. 0 assignments → row удаляется
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#7 0 assignments → row удалён', async () => {
  const cfg = basicConfig();
  const tr = `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>{{tableRepeat:TR-000001}}</w:t></w:r></w:p></w:tc></w:tr>`;
  const xml = docXml(`${rowXml(['header'])}${tr}`);
  const zip = makeFakeZip(xml);
  const supabase = makeFakeSupabase({
    document_package_role_catalog: cfg.role_catalog,
    document_package_item_role_assignments: [], // no assignments
    legal_details_persons: cfg.persons,
  });
  const report = await applyTableRepeatExpansion({
    zip: zip as any, supabase: supabase as any,
    packageSessionId: SESSION_ID, packageTemplateItemId: ITEM_ID, packageTemplateId: TPL_ID,
    itemMetadata: cfg.itemMetadata, isSuperAdmin: false, preresolvedPfFields: {},
  });
  assertEquals(report.markers[0].rows_count, 0);
  assert(report.markers[0].severity === 'warn');
  // template tr должна быть удалена → осталась только header tr
  const trCount = (zip.getXml().match(/<w:tr\b/g) || []).length;
  assertEquals(trCount, 1);
});

// ────────────────────────────────────────────────────────────────────────
// 8. assignment_custom_field schema check (key вне assignment_custom_fields)
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#8 assignment_custom_field schema check', () => {
  const r = readAssignmentCustomKey(
    { metadata: { custom: { unknown_key: 'some' } } },
    'unknown_key',
    new Set(['votes', 'share_percent']),
  );
  assertEquals(r.value, '');
  assertEquals(r.code, 'role_no_custom_field_def:unknown_key');
});

// ────────────────────────────────────────────────────────────────────────
// 9. Документ без marker → applied=false, no expansion
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#9 документ без TR-маркера → applied=false', async () => {
  const xml = docXml(rowXml(['plain']));
  const zip = makeFakeZip(xml);
  const supabase = makeFakeSupabase({
    document_package_role_catalog: [], document_package_item_role_assignments: [], legal_details_persons: [],
  });
  const report = await applyTableRepeatExpansion({
    zip: zip as any, supabase: supabase as any,
    packageSessionId: SESSION_ID, packageTemplateItemId: ITEM_ID, packageTemplateId: TPL_ID,
    itemMetadata: null, isSuperAdmin: false, preresolvedPfFields: {},
  });
  assertEquals(report.applied, false);
  assertEquals(report.markers.length, 0);
});

// ────────────────────────────────────────────────────────────────────────
// 10. assignment_metadata без super_admin → code
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#10 assignment_metadata без super_admin → forbidden', () => {
  const r = renderTableRepeatCell(
    { cell_index: 0, source_type: 'assignment_metadata', source_key: 'foo' },
    {
      rowIndex: 0,
      assignment: { person_id: null, metadata: { foo: 'bar' } },
      pfCache: new Map(),
      isSuperAdmin: false,
    },
  );
  assertEquals(r.value, '');
  assertEquals(r.code, 'tr_metadata_source_super_admin_only');
});

// ────────────────────────────────────────────────────────────────────────
// 11. Сложная ячейка (gridSpan) → tr_cell_complex_structure_unsupported
// ────────────────────────────────────────────────────────────────────────
Deno.test('E.4#11 сложная ячейка (gridSpan) → structured warning', async () => {
  const cfg = basicConfig();
  cfg.itemMetadata.table_repeats[0].columns = [
    { cell_index: 0, source_type: 'row_number' },
  ];
  const tr = `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>{{tableRepeat:TR-000001}}</w:t></w:r></w:p></w:tc></w:tr>`;
  const xml = docXml(tr);
  const zip = makeFakeZip(xml);
  const supabase = makeFakeSupabase({
    document_package_role_catalog: cfg.role_catalog,
    document_package_item_role_assignments: cfg.assignments,
    legal_details_persons: cfg.persons,
  });
  const report = await applyTableRepeatExpansion({
    zip: zip as any, supabase: supabase as any,
    packageSessionId: SESSION_ID, packageTemplateItemId: ITEM_ID, packageTemplateId: TPL_ID,
    itemMetadata: cfg.itemMetadata, isSuperAdmin: false, preresolvedPfFields: {},
  });
  const code = 'tr_cell_complex_structure_unsupported';
  assert((report.markers[0].cell_codes_summary[code] ?? 0) >= 1);
});
