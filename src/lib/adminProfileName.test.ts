import { describe, expect, it } from 'vitest';
import { resolveAdminProfileName } from '../../supabase/functions/_shared/admin-profile-name.ts';

describe('resolveAdminProfileName', () => {
  it('uses canonical surname-first order', () => {
    expect(resolveAdminProfileName({
      first_name: 'Вероника',
      last_name: 'Ракитская',
      full_name: 'Вероника',
    })).toBe('Ракитская Вероника');
  });

  it('prefers structured full identity over an incomplete full_name', () => {
    expect(resolveAdminProfileName({
      first_name: 'Сергей',
      last_name: 'Федорчук',
      full_name: 'Сергей',
    })).toBe('Федорчук Сергей');
  });

  it('keeps full_name as the fallback for legacy profiles', () => {
    expect(resolveAdminProfileName({ full_name: 'Ольга Велич' }))
      .toBe('Ольга Велич');
  });

  it('keeps a single available name part usable', () => {
    expect(resolveAdminProfileName({ first_name: 'Анна' })).toBe('Анна');
    expect(resolveAdminProfileName({ last_name: 'Иванова' })).toBe('Иванова');
  });

  it('normalizes whitespace and returns null for empty profiles', () => {
    expect(resolveAdminProfileName({
      first_name: '  Ирина ',
      last_name: ' Гаринова  ',
    })).toBe('Гаринова Ирина');
    expect(resolveAdminProfileName({ full_name: '   ' })).toBeNull();
    expect(resolveAdminProfileName(null)).toBeNull();
  });
});
