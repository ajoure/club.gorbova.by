import { describe, expect, it } from 'vitest';
import { resolveTrainingContentFilters } from '../../supabase/functions/_shared/access-resolver';
const root = '4365e913-36f1-432e-ab16-748c3ca6826a';
const rows = [
  { id:'bonus', target_ref:'bonus-root', tariff_id:'chief21', conditions:{access_mode:'partial',allowed_module_ids:['bonus-module']} },
  { id:'other-tariff', target_ref:root, tariff_id:'lady21', conditions:{access_mode:'full'} },
  { id:'product-default', target_ref:root, tariff_id:null, conditions:{access_mode:'full'} },
  { id:'course', target_ref:root, tariff_id:'chief21', conditions:{access_mode:'partial',allowed_module_ids:['core-module']} },
];
const database = (data: unknown[]) => {
  const query = { select: () => query, eq: () => query, then: (resolve: Function) => resolve({data}) };
  return { from: () => query };
};
describe('21st cohort and bonus grants stay independent', () => {
  it.each([{data: rows}, {data: [...rows].reverse()}])('keeps the paid cohort even when a bonus rule appears first', async ({data}) => {
    const result = await resolveTrainingContentFilters(database(data), 'product21', 'chief21');
    expect(result).toHaveLength(2);
    expect(result.find(r => r.root_module_id === root)).toMatchObject({rule_id:'course', access_mode:'partial',allowed_module_ids:['core-module']});
    expect(result.find(r => r.root_module_id === 'bonus-root')?.rule_id).toBe('bonus');
  });
  it('does not use a different tariff rule without a matching or product-wide grant', async () => {
    const result = await resolveTrainingContentFilters(database(rows.filter(r => r.tariff_id)), 'product21', 'accountant21');
    expect(result).toEqual([]);
  });
});
