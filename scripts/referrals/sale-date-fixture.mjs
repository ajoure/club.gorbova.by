import { readFile } from 'node:fs/promises';
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const root=new URL('../../',import.meta.url);
export async function fixtureSql(){
 const old=await readFile(new URL('supabase/migrations/20261002113949_referral_product_redemption.sql',root),'utf8');
 const pick=name=>{const escaped=name.replaceAll('.','\\.');const re=new RegExp(`create or replace function ${escaped}\\([\\s\\S]*?\\$\\$;`,'i');const found=old.match(re);if(!found)throw new Error(`Missing ${name}`);return found[0];};
 return [await readFile(new URL('scripts/referrals/sale-date-fixture.sql',root),'utf8'),
  ...['referral_private.balance','referral_private.refunds_reconciled','public.referral_mature_due_commissions','public.referral_maturation_manifest'].map(pick),
  await readFile(new URL('supabase/migrations/20261124081150_referral_sale_date_hold.sql',root),'utf8'),
  await readFile(new URL('supabase/migrations/20261124081407_referral_historical_sale_retime.sql',root),'utf8')].join('\n');
}
