import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { definition, fixtureSql, ids as i, id, migrationPath, protectedTables, read } from './fixture.mjs';

const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
let db = new PGlite();
let checks = 0;
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].value;
const same = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const role = async (name, actor, fn) => {
  await db.exec(`SET ROLE ${name}`);
  await db.query("SELECT set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)", [name, actor ?? '']);
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
};
const admin = fn => role('authenticated', i.actor, fn);
const service = fn => role('service_role', null, fn);
const snapshot = async tables => Object.fromEntries(await Promise.all(tables.map(async table => [table,
  await scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) AS value FROM public.${table} t`)])));
const reject = async (fn, pattern, label) => {
  const before = await snapshot([...protectedTables, 'companies', 'client_legal_details_company_map',
    'company_contacts', 'crm_company_billing_link_suppressions', 'crm_activity_log', 'domain_events']);
  await assert.rejects(fn, pattern, label);
  same(await snapshot(Object.keys(before)), before, `${label}: no partial writes`);
};
const unlink = (args = [i.company, i.profile, i.cld, i.contact, 'Fixture correction']) =>
  scalar('SELECT public.crm_company_unlink_billing_contact($1,$2,$3,$4,$5) AS value', args);
const restore = sid => scalar('SELECT public.crm_company_restore_billing_contact($1) AS value', [sid]);
const billingLink = () => scalar("SELECT public.crm_company_link_contact($1,$2,'billing_contact',true,'billing_requisites',$3) AS value", [i.company,i.profile,i.map]);
const backfill = () => scalar('SELECT public.crm_company_backfill_billing_cld($1) AS value', [i.cld]);
const count = () => scalar('SELECT count(*)::int AS value FROM public.company_contacts WHERE company_id=$1 AND profile_id=$2', [i.company,i.profile]);

try {
  await db.exec(fixtureSql());
  const beforeInstall = await snapshot([...protectedTables,'companies','client_legal_details_company_map','company_contacts','company_sync_queue','crm_activity_log','domain_events']);
  await db.exec(read(migrationPath));
  same(await snapshot(Object.keys(beforeInstall)), beforeInstall, 'schema install does not mutate existing rows');

  // Canonical ACLs are retained, including the deliberately service-only writer.
  same(await scalar("SELECT has_function_privilege('anon','public.crm_company_unlink_billing_contact(uuid,uuid,uuid,uuid,text)','EXECUTE') AS value"), false, 'anon cannot call unlink');
  same(await scalar("SELECT has_function_privilege('service_role','public.crm_company_unlink_billing_contact(uuid,uuid,uuid,uuid,text)','EXECUTE') AS value"), false, 'service has no human correction entrypoint');
  same(await scalar("SELECT has_function_privilege('service_role','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE') AS value"), false, 'linker ACL retained');
  same(await scalar("SELECT has_function_privilege('service_role','public.crm_company_backfill_billing_cld(uuid)','EXECUTE') AS value"), true, 'backfill ACL retained');
  for (const [name, actor] of [['anon',null], ['authenticated',null], ['authenticated',i.otherUser], ['service_role',null]]) {
    await reject(() => role(name, actor, unlink), /forbidden|permission denied/, `${name}/${actor ?? 'no user'} rejected`);
  }
  for (const roleName of ['menedzher','support']) {
    await db.query('INSERT INTO fixture_roles VALUES ($1,$2)', [i.otherUser, roleName]);
    await reject(() => role('authenticated',i.otherUser,unlink), /forbidden/, `${roleName} cannot correct billing link`);
    await db.query('DELETE FROM fixture_roles WHERE user_id=$1',[i.otherUser]);
  }
  for (const [args, pattern, label] of [
    [[i.company,i.profile,i.cld,id(99),'Correction'], /contact mismatch/, 'wrong expected contact'],
    [[i.otherCompany,i.profile,i.cld,i.contact,'Correction'], /map\/company mismatch/, 'wrong company'],
    [[i.company,i.actor,i.cld,i.contact,'Correction'], /owner mismatch/, 'auth user ID is not profile ID'],
    [[i.company,i.otherProfile,i.cld,i.contact,'Correction'], /owner mismatch/, 'wrong profile'],
    [[i.company,i.profile,i.cld,i.contact,' '], /identifiers and a reason/, 'empty reason'],
    [[i.company,i.profile,i.cld,null,'Correction'], /identifiers and a reason/, 'missing selector']
  ]) await reject(() => admin(() => unlink(args)), pattern, label);
  await db.exec(`UPDATE public.company_contacts SET relationship_type='director' WHERE id='${i.contact}'`);
  await reject(() => admin(unlink), /contact mismatch/, 'nonbilling relationship');
  await db.exec(`UPDATE public.company_contacts SET relationship_type='billing_contact' WHERE id='${i.contact}';
    UPDATE public.companies SET status='merged',merged_into_company_id='${i.otherCompany}' WHERE id='${i.company}';`);
  await reject(() => admin(unlink), /company must be active/, 'merged company');
  await db.exec(`UPDATE public.companies SET status='active',merged_into_company_id=null WHERE id='${i.company}';
    INSERT INTO public.company_contacts(company_id,profile_id,relationship_type,source)
      VALUES('${i.company}','${i.profile}','director','manual');`);
  await reject(() => admin(unlink), /other company relationships/, 'another relationship is not silently removed');
  await db.exec(`DELETE FROM public.company_contacts WHERE company_id='${i.company}' AND relationship_type='director'`);

  const preserved = await snapshot([...protectedTables,'companies','client_legal_details_company_map']);
  const otherContacts = await scalar(`SELECT jsonb_agg(to_jsonb(c)) AS value FROM public.company_contacts c WHERE company_id='${i.otherCompany}'`);
  const originalContact = await scalar(`SELECT to_jsonb(c) AS value FROM public.company_contacts c WHERE id='${i.contact}'`);
  const result = await admin(unlink);
  same(result.unlinked, 1, 'exactly one contact detached');
  const sid = result.suppression_id;
  same(await count(), 0, 'profile absent from company');
  same(await snapshot(Object.keys(preserved)), preserved, 'all requisites, documents, financial/access rows and map preserved');
  same(await scalar(`SELECT jsonb_agg(to_jsonb(c)) AS value FROM public.company_contacts c WHERE company_id='${i.otherCompany}'`), otherContacts, 'same profile in another company untouched');
  same(await scalar('SELECT contact_snapshot AS value FROM public.crm_company_billing_link_suppressions WHERE id=$1',[sid]), originalContact, 'lossless edge archive');
  same(await admin(unlink), {...result, unlinked:0, already_unlinked:true}, 'uncertain retry is idempotent');
  await reject(() => admin(() => unlink([i.company,i.profile,i.cld,id(99),'Correction'])), /retry conflicts/, 'retry cannot target another contact');
  same(await role('authenticated',i.otherUser,() => scalar('SELECT count(*)::int AS value FROM public.crm_company_billing_link_suppressions')), 0, 'private archive hidden from ordinary user');
  same(await admin(() => scalar('SELECT count(*)::int AS value FROM public.crm_company_billing_link_suppressions')), 1, 'admin can inspect archive');
  await reject(() => role('authenticated',i.actor,() => db.exec('DELETE FROM public.crm_company_billing_link_suppressions')), /permission denied/, 'admin cannot erase suppression directly');

  // Direct canonical linker, worker replay, then a real source trigger enqueue.
  same(await admin(billingLink), null, 'canonical linker skips suppressed edge');
  const replay = await service(backfill);
  same([replay.contact_id,replay.contact_suppressed,replay.contact_created,replay.contact_reused], [null,true,false,false], 'backfill suppression result is truthful');
  same([replay.company_id,replay.map_id,replay.writer], [i.company,i.map,'crm_company_backfill_billing_cld'], 'existing worker success contract preserved');
  same(await count(), 0, 'backfill cannot resurrect contact');
  await db.exec(`UPDATE public.company_sync_queue SET status='done';
    UPDATE public.client_legal_details SET leg_address='Fixture revised address',updated_at=now() WHERE id='${i.cld}';`);
  same(await scalar(`SELECT count(*)::int AS value FROM public.company_sync_queue WHERE entity_id='${i.cld}' AND status='queued'`), 1, 'actual CLD trigger enqueues sync');
  await service(backfill);
  same(await count(), 0, 'trigger-origin replay cannot resurrect contact');
  same(await snapshot(protectedTables.filter(t => t !== 'client_legal_details')),
    Object.fromEntries(Object.entries(preserved).filter(([t]) => protectedTables.includes(t) && t !== 'client_legal_details')), 'all business rows preserved after sync');
  await reject(() => db.exec(`INSERT INTO public.company_contacts(id,company_id,profile_id,relationship_type,is_billing_contact,source,source_client_legal_details_map_id)
    VALUES('${i.contact}','${i.company}','${i.profile}','billing_contact',true,'billing_requisites','${i.map}')`), /explicitly unlinked/, 'table writer cannot bypass suppression');
  await reject(() => db.exec(`UPDATE public.client_legal_details_company_map SET company_id='${i.otherCompany}' WHERE id='${i.map}'`), /resolve before retargeting/, 'map retarget blocked while suppressed');
  await reject(() => admin(() => scalar('SELECT public.crm_company_merge($1,$2) AS value',[i.company,i.otherCompany])), /resolve before retargeting/, 'merge fails closed atomically');
  await reject(() => db.exec(`DELETE FROM public.client_legal_details WHERE id='${i.cld}'`), /foreign key constraint/, 'business-source deletion cannot cascade through archive');

  // A deliberate different relationship remains available; restore refuses it.
  const director = await admin(() => scalar("SELECT public.crm_company_link_contact($1,$2,'director',false,'manual',null) AS value", [i.company,i.profile]));
  assert.ok(director); checks++;
  await reject(() => admin(() => restore(sid)), /contact conflict/, 'restore does not overwrite a newer relationship');
  await db.query('DELETE FROM public.company_contacts WHERE id=$1',[director]);
  await db.exec(`UPDATE public.client_legal_details SET profile_id='${i.otherProfile}' WHERE id='${i.cld}'`);
  await reject(() => admin(() => restore(sid)), /owner changed/, 'restore refuses changed CLD owner');
  await db.exec(`UPDATE public.client_legal_details SET profile_id='${i.profile}' WHERE id='${i.cld}'`);
  const beforeRestore = await snapshot(protectedTables);
  same((await admin(() => restore(sid))).restored, 1, 'restore returns original contact');
  same(await scalar(`SELECT to_jsonb(c) AS value FROM public.company_contacts c WHERE id='${i.contact}'`), originalContact, 'restore retains exact ID, timestamps, flags, metadata');
  same(await snapshot(protectedTables), beforeRestore, 'restore preserves business data');
  same((await admin(() => restore(sid))).restored, 0, 'restore retry is idempotent');
  same(await count(), 1, 'exactly one restored edge');
  same((await service(backfill)).contact_suppressed, false, 'normal sync resumes after explicit restore');
  same(await count(), 1, 'normal backfill remains idempotent');

  // A later unlink must survive a retry of an older restore request.
  const second = await admin(unlink);
  assert.notEqual(second.suppression_id, sid); checks++;
  await reject(() => admin(() => restore(sid)), /retry conflicts/, 'old restore cannot revoke later suppression');
  same(await count(), 0, 'later correction retained');

  // A drifted hosted schema must fail BEFORE creating any correction objects.
  await db.close();
  db = new PGlite();
  await db.exec(fixtureSql());
  const driftBaseline = await snapshot([...protectedTables,'companies','client_legal_details_company_map','company_contacts']);
  for (const [change, expected, reset] of [
    ["GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO anon", /ACL drift/,
      "REVOKE EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM anon"],
    ["ALTER FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) SECURITY INVOKER", /security configuration drift/,
      "ALTER FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) SECURITY DEFINER"],
    [definition('20260719231416_b9fa502e-0849-4336-9bab-b9414eddc501.sql','crm_company_link_contact').replace('BEGIN\n','BEGIN\n  -- Fixture body drift.\n'), /canonical writer drift/, null]
  ]) {
    await db.exec(change);
    await assert.rejects(() => db.exec(read(migrationPath)), expected); checks++;
    await db.exec('ROLLBACK');
    same(await scalar("SELECT to_regclass('public.crm_company_billing_link_suppressions')::text AS value"), null, 'drift leaves no partial schema');
    same(await snapshot(Object.keys(driftBaseline)), driftBaseline, 'drift leaves business rows unchanged');
    if (reset) await db.exec(reset);
  }
  console.log(`PASS: ${checks} database assertions; synthetic data only; no production connection`);
} finally { await db.close(); }
