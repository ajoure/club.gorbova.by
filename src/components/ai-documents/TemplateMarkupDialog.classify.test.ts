/**
 * Anti-divergence guard для TemplateMarkupDialog.classifyTemplateToken:
 * убеждаемся, что после миграции на shared `evaluatePlaceholderInScope`
 * UI-маппинг покрывает все четыре синтаксиса (field/pf/ln/package.*),
 * корректно отрабатывает scope-гейт `billing`, и помечает legacy/мусор.
 *
 * Если этот тест начнёт проваливаться — значит локальная классификация
 * снова разошлась с shared classifier.
 */
import { describe, it, expect } from 'vitest';
import { classifyTemplateToken } from './TemplateMarkupDialog';

describe('classifyTemplateToken (anti-divergence)', () => {
  describe('package scope', () => {
    const scope = 'package' as const;
    it('field:FLD- → valid', () => {
      expect(classifyTemplateToken('{{field:FLD-000123}}', scope)).toBe('valid');
    });
    it('field with modifiers → valid', () => {
      expect(classifyTemplateToken('{{field:FLD-000123|format=words|case=genitive}}', scope)).toBe('valid');
    });
    it('package.ul.FLD- → valid', () => {
      expect(classifyTemplateToken('{{package.ul.FLD-000014}}', scope)).toBe('valid');
    });
    it('ln-XXXXXX → valid', () => {
      expect(classifyTemplateToken('{{ln-000012}}', scope)).toBe('valid');
    });
    it('ln with format=signature_short → valid', () => {
      expect(classifyTemplateToken('{{ln-000012|format=signature_short}}', scope)).toBe('valid');
    });
    it('pf-XXXXXX → valid', () => {
      expect(classifyTemplateToken('{{pf-000003}}', scope)).toBe('valid');
    });
    it('pf with format=words → valid', () => {
      expect(classifyTemplateToken('{{pf-000003|format=words}}', scope)).toBe('valid');
    });
    it('legacy package.role.PKR- → legacy', () => {
      expect(classifyTemplateToken('{{package.role.PKR-000001}}', scope)).toBe('legacy');
    });
    it('legacy package.roles.head.name → legacy', () => {
      expect(classifyTemplateToken('{{package.roles.head.name}}', scope)).toBe('legacy');
    });
    it('legacy document.* → legacy', () => {
      expect(classifyTemplateToken('{{document.title}}', scope)).toBe('legacy');
    });
    it('garbage → legacy', () => {
      expect(classifyTemplateToken('{{not-a-token}}', scope)).toBe('legacy');
    });
    it('pf with unknown modifier → legacy', () => {
      expect(classifyTemplateToken('{{pf-000003|foo=bar}}', scope)).toBe('legacy');
    });
  });

  describe('billing scope (scope-gate)', () => {
    const scope = 'billing' as const;
    it('field:FLD- → valid', () => {
      expect(classifyTemplateToken('{{field:FLD-000123}}', scope)).toBe('valid');
    });
    it('package.ul.FLD- → package_in_billing', () => {
      expect(classifyTemplateToken('{{package.ul.FLD-000014}}', scope)).toBe('package_in_billing');
    });
    it('ln- → package_in_billing', () => {
      expect(classifyTemplateToken('{{ln-000012}}', scope)).toBe('package_in_billing');
    });
    it('pf- → package_in_billing', () => {
      expect(classifyTemplateToken('{{pf-000003}}', scope)).toBe('package_in_billing');
    });
  });

  describe('unknown scope (do not over-flag)', () => {
    const scope = 'unknown' as const;
    it('pf- → valid', () => {
      expect(classifyTemplateToken('{{pf-000003}}', scope)).toBe('valid');
    });
    it('ln- → valid', () => {
      expect(classifyTemplateToken('{{ln-000012}}', scope)).toBe('valid');
    });
  });

  describe('malformed wrappers', () => {
    it('missing braces → legacy', () => {
      expect(classifyTemplateToken('pf-000003', 'package')).toBe('legacy');
    });
    it('triple braces → legacy', () => {
      expect(classifyTemplateToken('{{{pf-000003}}}', 'package')).toBe('legacy');
    });
  });
});
