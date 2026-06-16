/**
 * Deno-side tests для канонического placeholderClassifier (mirror фронтового набора).
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  classifyPlaceholder,
  evaluatePlaceholderInScope,
  extractPackageFieldTokens,
} from './placeholderClassifier.ts';

Deno.test('field bare', () => {
  assertEquals(classifyPlaceholder('field:FLD-000123'), {
    kind: 'field', public_id: 'FLD-000123', format: null, case_modifier: null,
  });
});

Deno.test('pf bare', () => {
  assertEquals(classifyPlaceholder('pf-000003'), {
    kind: 'package_field', public_id: 'pf-000003', format: null, case_modifier: null,
  });
});

Deno.test('pf invalid_modifier_value', () => {
  assertEquals(classifyPlaceholder('pf-000003|format=potato'),
    { kind: 'invalid_modifier_value', key: 'format', value: 'potato' });
});

Deno.test('pf unknown_modifier', () => {
  assertEquals(classifyPlaceholder('pf-000003|hello=world'),
    { kind: 'unknown_modifier', modifier: 'hello=world' });
});

Deno.test('ln signature_short', () => {
  assertEquals(classifyPlaceholder('ln-000012|format=signature_short'), {
    kind: 'package_role', public_id: 'ln-000012', format: 'signature_short', case_modifier: null,
  });
});

Deno.test('package_requisite', () => {
  assertEquals(classifyPlaceholder('package.ul.FLD-000014'), {
    kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000014', format: null, case_modifier: null,
  });
});

// Sprint patch: package_requisite расширенный format-set.
Deno.test('package_requisite format=long valid', () => {
  assertEquals(classifyPlaceholder('package.ul.FLD-000010|format=long'), {
    kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000010', format: 'long', case_modifier: null,
  });
});
Deno.test('package_requisite format=signature_short valid', () => {
  assertEquals(classifyPlaceholder('package.ul.FLD-000014|format=signature_short'), {
    kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000014', format: 'signature_short', case_modifier: null,
  });
});
Deno.test('package_requisite format=short|case=genitive valid', () => {
  assertEquals(classifyPlaceholder('package.ul.FLD-000014|format=short|case=genitive'), {
    kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000014', format: 'short', case_modifier: 'genitive',
  });
});
Deno.test('package_requisite format=full (fl) valid', () => {
  assertEquals(classifyPlaceholder('package.fl.FLD-000372|format=full'), {
    kind: 'package_requisite', entity: 'fl', public_id: 'FLD-000372', format: 'full', case_modifier: null,
  });
});
Deno.test('package_requisite format=potato invalid', () => {
  assertEquals(classifyPlaceholder('package.ip.FLD-000010|format=potato'), {
    kind: 'invalid_modifier_value', key: 'format', value: 'potato',
  });
});
Deno.test('billing field:FLD format=long invalid (биллинг не расширен)', () => {
  assertEquals(classifyPlaceholder('field:FLD-000001|format=long'), {
    kind: 'invalid_modifier_value', key: 'format', value: 'long',
  });
});

Deno.test('legacy_role_format', () => {
  assertEquals(classifyPlaceholder('package.role.PKR-000001'), { kind: 'legacy_role_format' });
});

Deno.test('legacy_namespace', () => {
  assertEquals(classifyPlaceholder('document.x'), { kind: 'legacy_namespace', ns: 'document' });
});

Deno.test('scope billing: pf blocked', () => {
  const r = evaluatePlaceholderInScope('pf-000003', 'billing');
  assertEquals(r.valid, false);
  assertEquals(r.reason, 'package_token_outside_package_context');
});

Deno.test('scope package: pf ok', () => {
  assertEquals(evaluatePlaceholderInScope('pf-000003', 'package').valid, true);
});

Deno.test('scope unknown: pf ok (binding gate выше)', () => {
  assertEquals(evaluatePlaceholderInScope('pf-000003', 'unknown').valid, true);
});

Deno.test('extractPackageFieldTokens', () => {
  const r = extractPackageFieldTokens('A {{pf-000001}} B {{pf-000002|format=text}} C {{pf-000001}}');
  assertEquals(r, ['pf-000001', 'pf-000002']);
});
