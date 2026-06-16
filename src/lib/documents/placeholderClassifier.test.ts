/**
 * Unit-тесты shared placeholder classifier (canonical в supabase/functions/_shared/).
 * Покрывает: field, pf, ln, package.*, legacy, modifiers, scope rules.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyPlaceholder,
  evaluatePlaceholderInScope,
  extractPackageFieldTokens,
} from '@/lib/documents/placeholderClassifier';

describe('classifyPlaceholder', () => {
  it('field:FLD-000123 → kind=field', () => {
    expect(classifyPlaceholder('field:FLD-000123')).toEqual({
      kind: 'field', public_id: 'FLD-000123', format: null, case_modifier: null,
    });
  });

  it('field with modifiers', () => {
    const c = classifyPlaceholder('field:FLD-000123|format=words|case=genitive');
    expect(c).toEqual({ kind: 'field', public_id: 'FLD-000123', format: 'words', case_modifier: 'genitive' });
  });

  it('pf-000003 bare → kind=package_field', () => {
    expect(classifyPlaceholder('pf-000003')).toEqual({
      kind: 'package_field', public_id: 'pf-000003', format: null, case_modifier: null,
    });
  });

  it('pf-000003|format=text', () => {
    const c = classifyPlaceholder('pf-000003|format=text');
    expect(c).toEqual({ kind: 'package_field', public_id: 'pf-000003', format: 'text', case_modifier: null });
  });

  it('pf-000003|format=potato → invalid_modifier_value', () => {
    const c = classifyPlaceholder('pf-000003|format=potato');
    expect(c).toEqual({ kind: 'invalid_modifier_value', key: 'format', value: 'potato' });
  });

  it('pf-000003|hello=world → unknown_modifier', () => {
    const c = classifyPlaceholder('pf-000003|hello=world');
    expect(c).toEqual({ kind: 'unknown_modifier', modifier: 'hello=world' });
  });

  it('pf-00003 (5 digits) → invalid', () => {
    expect(classifyPlaceholder('pf-00003')).toEqual({ kind: 'invalid' });
  });

  it('ln-000012|format=signature_short', () => {
    const c = classifyPlaceholder('ln-000012|format=signature_short');
    expect(c).toEqual({ kind: 'package_role', public_id: 'ln-000012', format: 'signature_short', case_modifier: null });
  });

  it('ln-000012|format=words → invalid_modifier_value (words не для ролей)', () => {
    const c = classifyPlaceholder('ln-000012|format=words');
    expect(c).toEqual({ kind: 'invalid_modifier_value', key: 'format', value: 'words' });
  });

  it('package.ul.FLD-000014', () => {
    const c = classifyPlaceholder('package.ul.FLD-000014');
    expect(c).toEqual({ kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000014', format: null, case_modifier: null });
  });

  // Sprint patch: package_requisite расширенный format-set
  // (long для org_form, full/short/signature_short для person-FLD).
  it('package.ul.FLD-000010|format=long → valid', () => {
    expect(classifyPlaceholder('package.ul.FLD-000010|format=long')).toEqual({
      kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000010', format: 'long', case_modifier: null,
    });
  });

  it('package.ul.FLD-000014|format=signature_short → valid', () => {
    expect(classifyPlaceholder('package.ul.FLD-000014|format=signature_short')).toEqual({
      kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000014', format: 'signature_short', case_modifier: null,
    });
  });

  it('package.ul.FLD-000014|format=short|case=genitive → valid', () => {
    expect(classifyPlaceholder('package.ul.FLD-000014|format=short|case=genitive')).toEqual({
      kind: 'package_requisite', entity: 'ul', public_id: 'FLD-000014', format: 'short', case_modifier: 'genitive',
    });
  });

  it('package.fl.FLD-000372|format=full → valid', () => {
    expect(classifyPlaceholder('package.fl.FLD-000372|format=full')).toEqual({
      kind: 'package_requisite', entity: 'fl', public_id: 'FLD-000372', format: 'full', case_modifier: null,
    });
  });

  it('package.ip.FLD-000010|format=potato → invalid_modifier_value', () => {
    expect(classifyPlaceholder('package.ip.FLD-000010|format=potato')).toEqual({
      kind: 'invalid_modifier_value', key: 'format', value: 'potato',
    });
  });

  it('field:FLD-000001|format=long → invalid_modifier_value (биллинг не расширен)', () => {
    expect(classifyPlaceholder('field:FLD-000001|format=long')).toEqual({
      kind: 'invalid_modifier_value', key: 'format', value: 'long',
    });
  });

  it('field:FLD-000001|format=signature_short → invalid_modifier_value (биллинг)', () => {
    expect(classifyPlaceholder('field:FLD-000001|format=signature_short')).toEqual({
      kind: 'invalid_modifier_value', key: 'format', value: 'signature_short',
    });
  });



  it('package.role.PKR-000001 → legacy_role_format', () => {
    expect(classifyPlaceholder('package.role.PKR-000001')).toEqual({ kind: 'legacy_role_format' });
  });

  it('package.roles.company_head.name → legacy_role_format', () => {
    expect(classifyPlaceholder('package.roles.company_head.name')).toEqual({ kind: 'legacy_role_format' });
  });

  it('document.created_at → legacy_namespace', () => {
    expect(classifyPlaceholder('document.created_at')).toEqual({ kind: 'legacy_namespace', ns: 'document' });
  });

  it('xyz → invalid', () => {
    expect(classifyPlaceholder('xyz')).toEqual({ kind: 'invalid' });
  });
});

describe('evaluatePlaceholderInScope', () => {
  it('pf in billing scope → package_token_outside_package_context', () => {
    const r = evaluatePlaceholderInScope('pf-000003', 'billing');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('package_token_outside_package_context');
  });

  it('pf in package scope → ok', () => {
    expect(evaluatePlaceholderInScope('pf-000003', 'package').valid).toBe(true);
  });

  it('pf in unknown scope → ok (syntax pass; binding gate отдельно)', () => {
    expect(evaluatePlaceholderInScope('pf-000003', 'unknown').valid).toBe(true);
  });

  it('field в любом scope → ok', () => {
    expect(evaluatePlaceholderInScope('field:FLD-000001', 'billing').valid).toBe(true);
    expect(evaluatePlaceholderInScope('field:FLD-000001', 'package').valid).toBe(true);
  });

  it('ln в billing scope → package_token_outside_package_context', () => {
    const r = evaluatePlaceholderInScope('ln-000012', 'billing');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('package_token_outside_package_context');
  });

  it('legacy namespace всегда invalid', () => {
    expect(evaluatePlaceholderInScope('document.foo', 'package').valid).toBe(false);
    expect(evaluatePlaceholderInScope('document.foo', 'billing').valid).toBe(false);
  });
});

describe('extractPackageFieldTokens', () => {
  it('собирает уникальные pf-XXXXXX из текста', () => {
    const txt = 'Текст {{pf-000001}} и {{pf-000002|format=text}} и {{pf-000001}}.';
    expect(extractPackageFieldTokens(txt)).toEqual(['pf-000001', 'pf-000002']);
  });
  it('игнорирует field/ln/package', () => {
    const txt = '{{field:FLD-000001}} {{ln-000002}} {{package.ul.FLD-000003}}';
    expect(extractPackageFieldTokens(txt)).toEqual([]);
  });
});
