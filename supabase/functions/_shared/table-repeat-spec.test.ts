import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { collectExternalSubmissionRepeatFieldIds } from './table-repeat-spec.ts';

Deno.test('external submission repeat fields are derived from administrator metadata', () => {
  const ids = collectExternalSubmissionRepeatFieldIds({
    table_repeats: [{
      id: 'TR-000001',
      source_kind: 'external_submission',
      repeat_group_key: 'expenses',
      columns: [
        { cell_index: 0, source_type: 'submission_field', source_key: 'pf-000101' },
        { cell_index: 1, source_type: 'submission_template', source_key: '№ {{pf-000102}} от {{pf-000103|format=dd.MM.yyyy}}' },
      ],
    }, {
      id: 'TR-000002',
      source_kind: 'role_assignments',
      role_catalog_id: '00000000-0000-0000-0000-000000000001',
      columns: [{ cell_index: 0, source_type: 'package_field', source_key: 'pf-000999' }],
    }],
  });

  assertEquals([...ids].sort(), ['pf-000101', 'pf-000102', 'pf-000103']);
});
