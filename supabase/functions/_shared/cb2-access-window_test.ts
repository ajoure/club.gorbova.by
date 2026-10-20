import { assertEquals } from 'jsr:@std/assert@1';
import { CB2_PRODUCT_ID, cb2ReminderCoverage } from './cb2-access-window.ts';
const end = new Date('2026-10-25T20:55:00Z');
const client = (date: string | null, access = true) => ({ rpc: async () => ({ data: { has_access: access, has_prior_purchase: true, effective_end_at: date, source_kind: 'club_bonus' }, error: null }) });
Deno.test('only a longer canonical same-product source suppresses an informational reminder', async () => {
  assertEquals((await cb2ReminderCoverage(client('2026-10-29T20:59:59Z'), 'u', CB2_PRODUCT_ID, end, true)).covered, true);
  for (const date of ['2026-10-24T12:00:00Z',end.toISOString()]) assertEquals((await cb2ReminderCoverage(client(date),'u',CB2_PRODUCT_ID,end,true)).covered,false);
  assertEquals((await cb2ReminderCoverage(client(null),'u',CB2_PRODUCT_ID,end,true)).covered,true);
  assertEquals((await cb2ReminderCoverage(client(null,false),'u',CB2_PRODUCT_ID,end,true)).covered,false);
});
Deno.test('recurring Club and unrelated product payment reminders never query or suppress', async () => {
  const db = { rpc: async () => { throw Error('must not query'); } };
  assertEquals(await cb2ReminderCoverage(db,'u',CB2_PRODUCT_ID,end,false),{covered:false});
  assertEquals(await cb2ReminderCoverage(db,'u','club',end,true),{covered:false});
});
Deno.test('failed and malformed lookups do not silently suppress a warning', async () => {
  for (const db of [{rpc:async()=>({data:null,error:'down'})},client('bad-date')]) {
    assertEquals(await cb2ReminderCoverage(db,'u',CB2_PRODUCT_ID,end,true),{covered:false,lookup_failed:true});
  }
});
