// Same migration/SQL contracts as native PostgreSQL CI; offline WASM PostgreSQL runner.
import { readFileSync } from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');
const db=new PGlite(),read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const fixture=read('scripts/club-paid-lessons/fixture.sql'),cut=fixture.indexOf('CREATE FUNCTION public.historical_lesson_access_guard');
await db.exec(fixture.slice(0,cut));
await db.exec(read('supabase/migrations/20260817092551_1d8d9274-70e0-4c81-b8f1-2e5f113a1c81.sql'));
await db.exec(read('supabase/migrations/20260602122043_f05562e0-ae19-49c0-8d5d-c16d0b0a56da.sql'));
await db.exec(read('supabase/migrations/20261020131240_club_cb2_bonus_access.sql').match(/CREATE OR REPLACE FUNCTION public\.user_has_training_lesson_access\([\s\S]*?\$fn\$;/)[0]);
await db.exec(fixture.slice(cut));
await db.exec(`REVOKE ALL ON FUNCTION public.has_month_purchase(uuid,uuid,text),public.has_month_purchase_bulk(uuid,jsonb),public.user_has_training_lesson_access(uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.has_month_purchase(uuid,uuid,text),public.has_month_purchase_bulk(uuid,jsonb),public.user_has_training_lesson_access(uuid,uuid) TO authenticated,service_role,sandbox_exec_hdjgkjceownmmnrqqtuz; GRANT EXECUTE ON FUNCTION public.user_has_training_lesson_access(uuid,uuid) TO anon;`);
await db.exec(read('supabase/migrations/20261106071934_club_paid_lesson_corrections.sql'));
await db.exec(read('scripts/club-paid-lessons/receipt_fixture.sql'));
await db.exec(read('supabase/migrations/20261119162522_club_paid_lesson_corrections.sql'));
// Base entities also used by legacy Python contract fixture.
await db.exec(`INSERT INTO public.tariffs VALUES('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000081'); INSERT INTO public.training_modules VALUES('00000000-0000-0000-0000-000000000009',NULL,'11c9f1b8-0355-4753-bd74-40b42aa53616',true),('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009',NULL,true); INSERT INTO public.access_rules VALUES('00000000-0000-0000-0000-000000000010','11c9f1b8-0355-4753-bd74-40b42aa53616','00000000-0000-0000-0000-000000000003','training_content','00000000-0000-0000-0000-000000000009',true,'{"access_mode":"full","allowed_lesson_ids":[],"allowed_module_ids":[],"match_purchase_month":true}');`);
await db.exec(read('scripts/club-paid-lessons/receipt_contract.sql'));
console.log(JSON.stringify({engine:'PGlite PostgreSQL',result:'PASS',assertions:(await db.query('SELECT count(*)::int n FROM receipt_checks')).rows[0].n}));await db.close();
