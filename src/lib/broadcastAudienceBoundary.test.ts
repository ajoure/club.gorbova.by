import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { isValidAudienceRule, shouldAppendAdministrators } from '../../supabase/functions/telegram-mass-broadcast/audienceBoundary';
import { RuleListEditor } from '../components/admin/communication/RuleListEditor';

describe('canonical Telegram audience boundary', () => {
  it.each([
    ['11111111-1111-1111-1111-111111111111', true],
    ['not-a-uuid', false], ['', false], [null, false], [false, false], [[], false],
    [{ product_id: 'product' }, true], [{ tariff_ids: ['tariff'] }, true],
    [{ product_id: ' ', tariff_ids: [] }, false],
  ])('validates canonical audience rule %j', (rule, expected) => {
    expect(isValidAudienceRule(rule)).toBe(expected);
  });

  it.each([
    [true, false, undefined, undefined, false],
    [true, true, undefined, undefined, false],
    [false, true, undefined, undefined, false],
    [false, false, { lesson_id: 'lesson' }, undefined, false],
    [false, false, undefined, { page_id: 'page' }, false],
    [false, false, undefined, undefined, true],
  ])('does not append administrative copies outside resolved audiences', (canonical, direct, education, webinar, expected) => {
    expect(shouldAppendAdministrators(canonical, direct, education, webinar)).toBe(expected);
  });

  it('renders frozen recipients without exposing identifiers or treating them as any-product rules', () => {
    render(createElement(RuleListEditor, {
      title: 'Включить', emptyHint: 'Вся база',
      rules: ['11111111-1111-1111-1111-111111111111'], products: [], tariffs: [], onChange: () => {},
    }));
    expect(screen.getByRole('note').textContent).toContain('Точный список получателей: 1');
    expect(screen.queryByText('11111111-1111-1111-1111-111111111111')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps canonical filtering and system-only direct_user_ids checks in the sender', () => {
    const source = readFileSync('supabase/functions/telegram-mass-broadcast/index.ts', 'utf8');
    expect(source).toContain("supabase.rpc('resolve_broadcast_audience_user_ids_system'");
    expect(source).toContain('profiles = profiles.filter(p => allowedUserIds!.has(p.user_id))');
    expect(source).toContain('isSystemActor && Array.isArray(filters.direct_user_ids)');
    expect(source).toContain('useNewSchema, directUserIds !== null, filters.education, filters.webinar_registration');
  });
});
