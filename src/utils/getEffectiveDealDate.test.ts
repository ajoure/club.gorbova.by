import {describe,it,expect} from 'vitest';
import {getEffectiveDealDate,getEffectiveDealTimestamp,formatEffectiveDealDate} from './getEffectiveDealDate';
const imported={created_at:'2026-09-11T13:20:00Z',deal_date:null,meta:{history_only:true,source_purchase_date_unknown:true}};
describe('canonical historical deal dates',()=>{
 it('does not display or sort unknown history as today, including snapshot-only callers',()=>{
  expect(getEffectiveDealDate(imported)).toBeNull();
  expect(getEffectiveDealTimestamp(imported)).toBe(0);
  expect(formatEffectiveDealDate(imported,'dd.MM.yy')).toBe('Историческая покупка · дата неизвестна');
  expect(getEffectiveDealDate({...imported,meta:{},purchase_snapshot:{history_only:true}})).toBeNull();
 });
 it('uses restored source deal date and ignores later payment or import dates',()=>{
  const deal={...imported,deal_date:'2024-05-14T14:41:44+03:00'};
  expect(getEffectiveDealDate(deal,[{status:'succeeded',paid_at:'2026-09-11T00:00:00Z'}])).toBe(deal.deal_date);
  expect(formatEffectiveDealDate(deal,'yyyy')).toBe('2024');
 });
 it('preserves ordinary canonical date semantics without inventing today or crashing on malformed input',()=>{
  expect(getEffectiveDealDate({created_at:'2025-01-02T12:00:00Z'})).toBe('2025-01-02T12:00:00Z');
  expect(getEffectiveDealDate({deal_date:'2024-02-01T12:00:00Z',created_at:'2026-01-01T00:00:00Z'})).toBe('2024-02-01T12:00:00Z');
  expect(getEffectiveDealDate({})).toBeNull();
  expect(formatEffectiveDealDate({...imported,deal_date:'bad'},'yyyy')).toContain('дата неизвестна');
 });
});
