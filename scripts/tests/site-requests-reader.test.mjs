import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// The harness never accepts a connection URL or an arbitrary existing DB.
if (process.env.SITE_REQUESTS_PG_TEST !== '1' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST) ||
    process.env.PGDATABASE !== 'site_requests_reader_test') {
  throw new Error('Requires the dedicated local PostgreSQL service and SITE_REQUESTS_PG_TEST=1');
}
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const literal = s => `'${String(s).replaceAll("'", "''")}'`;
const fixture = readFileSync(new URL('./site-requests-reader.fixture.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/20261105222300_customer_site_requests_reader.sql', import.meta.url), 'utf8');
function raw(sql) {
  const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
    input: sql, encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}
function sql(statement) {
  const result = raw(statement);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function context({ uid = id(1), role = 'authenticated', dbRole = 'authenticated' } = {}) {
  assert.ok(['authenticated', 'anon', 'postgres'].includes(dbRole));
  return `SET LOCAL ROLE ${dbRole}; SET LOCAL "request.jwt.claim.sub"=${literal(uid ?? '')}; SET LOCAL "request.jwt.claim.role"=${literal(role ?? '')};`;
}
const selectRows = "SELECT coalesce(jsonb_agg(to_jsonb(request)), '[]'::jsonb) FROM public.get_my_site_requests() AS request;";
function rows(mutation = '', options) {
  return JSON.parse(sql(`BEGIN; ${mutation} ${context(options)} ${selectRows} ROLLBACK;`));
}
function rejected(options) {
  const result = raw(`BEGIN; ${context(options)} ${selectRows} ROLLBACK;`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /42501/);
}
const updateSubmission = change => `UPDATE site_form_submissions SET ${change} WHERE id=${literal(id(701))};`;
const updateOrder = change => `UPDATE orders_v2 SET ${change} WHERE id=${literal(id(601))};`;
const meta = (key, value) => `metadata=jsonb_set(metadata, '{${key}}', ${literal(JSON.stringify(value))}::jsonb)`;
const orderMeta = (key, value) => `meta=jsonb_set(meta, '{${key}}', ${literal(JSON.stringify(value))}::jsonb)`;
const repeat = (n, timestamp) => `INSERT INTO site_form_submissions SELECT ${literal(id(n))}::uuid,profile_id,order_id,page_id,workspace_id,source,status,metadata,${literal(timestamp)}::timestamptz,form_data FROM site_form_submissions WHERE id=${literal(id(701))};`;
const course = (owner = id(1)) => `INSERT INTO course_preregistrations VALUES (${literal(id(801))},${literal(owner)},jsonb_build_object('order_id',${literal(id(601))},'product_id',${literal(id(301))},'tariff_id',${literal(id(401))}));`;

test('actual managed reader on isolated PostgreSQL roles, provenance and lifecycle', async t => {
  sql(fixture);
  sql(migration);
  // Reapplying the exact managed migration preserves the function and ACL.
  sql(migration);

  await t.test('authNULL order is hidden by existing RLS; own narrow reader returns seven safe fields', () => {
    const result = rows();
    assert.equal(result.length, 1);
    assert.deepEqual(Object.keys(result[0]).sort(), ['id','kind','source_id','submitted_at','product_name','tariff_name','status'].sort());
    assert.equal(result[0].id, id(601));
    assert.equal(result[0].source_id, id(701));
    assert.equal(result[0].kind, 'site_request');
    assert.equal(result[0].status, 'received');
    assert.equal(Date.parse(result[0].submitted_at), Date.parse('2026-02-03T08:10:00Z'));
    assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETURN/);
    assert.equal(sql(`BEGIN; ${context()} SELECT count(*) FROM orders_v2; ROLLBACK;`), '0');
    assert.equal(sql(`BEGIN; ${context()} SELECT count(*) FROM site_form_submissions; ROLLBACK;`), '0');
    assert.equal(sql(`BEGIN; ${context()} SELECT count(*) FROM course_preregistrations; ROLLBACK;`), '1');
  });
  await t.test('foreign customer receives no rows', () => assert.deepEqual(rows('', { uid: id(2) }), []));
  for (const [name, options] of [
    ['anon cannot execute', { role:'anon', dbRole:'anon' }],
    ['NULL uid fails closed', { uid:null }],
    ['NULL JWT role fails closed', { role:null }],
    ['service JWT has no owner bypass', { role:'service_role', dbRole:'postgres' }],
    ['anon JWT cannot use authenticated membership', { role:'anon' }],
  ]) await t.test(name, () => rejected(options));

  const denied = [
    ['duplicate canonical profile', `INSERT INTO profiles(id,user_id,status,is_archived) VALUES (${literal(id(102))},${literal(id(1))},'active',false);`],
    ['missing canonical profile', `DELETE FROM profiles WHERE id=${literal(id(101))};`],
    ['archived profile flag', `UPDATE profiles SET is_archived=true WHERE id=${literal(id(101))};`],
    ['archived profile status', `UPDATE profiles SET status='archived' WHERE id=${literal(id(101))};`],
    ['merged profile', `UPDATE profiles SET merged_to_profile_id=${literal(id(201))} WHERE id=${literal(id(101))};`],
    ['foreign order profile', updateOrder(`profile_id=${literal(id(201))}`)],
    ['conflicting order user', updateOrder(`user_id=${literal(id(2))}`)],
    ['soft deleted order flag', updateOrder('is_deleted=true')],
    ['soft deleted order timestamp', updateOrder("deleted_at='2026-02-04T00:00:00Z'")],
    ['legacy source', updateSubmission("source='site_form'")],
    ['unprocessed source', updateSubmission("status='new'")],
    ['JSON false auth mode', updateSubmission(meta('auth_mode', false))],
    ['string true is not boolean', updateSubmission(meta('auth_mode', 'true'))],
    ['missing auth mode', updateSubmission("metadata=metadata-'auth_mode'")],
    ['missing actor', updateSubmission("metadata=metadata-'user_id'")],
    ['missing product metadata', updateSubmission("metadata=metadata-'product_id'")],
    ['missing tariff metadata', updateSubmission("metadata=metadata-'tariff_id'")],
    ['malformed auth actor never casts', updateSubmission(meta('user_id', 'not-a-uuid'))],
    ['foreign metadata actor', updateSubmission(meta('user_id', id(2)))],
    ['foreign metadata product', updateSubmission(meta('product_id', id(302)))],
    ['foreign metadata tariff', updateSubmission(meta('tariff_id', id(402)))],
    ['array metadata', updateSubmission("metadata='[]'::jsonb")],
    ['foreign submission profile', updateSubmission(`profile_id=${literal(id(201))}`)],
    ['foreign submission order', updateSubmission(`order_id=${literal(id(602))}`)],
    ['foreign page', updateSubmission(`page_id=${literal(id(502))}`)],
    ['foreign workspace', updateSubmission(`workspace_id=${literal(id(10))}`)],
    ['changed page workspace', `UPDATE site_pages SET workspace_id=${literal(id(10))} WHERE id=${literal(id(501))};`],
    ['order origin page mismatch', updateOrder(orderMeta('page_id', id(502)))],
    ['order origin workspace mismatch', updateOrder(orderMeta('workspace_id', id(10)))],
    ['malformed origin UUID does not throw', updateOrder(orderMeta('submission_id', 'not-a-uuid'))],
    ['dangling original submission', updateOrder(orderMeta('submission_id', id(999)))],
    ['wrong order source', updateOrder("reconcile_source='admin'")],
    ['wrong order metadata source', updateOrder(orderMeta('source', 'legacy'))],
    ['array order metadata', updateOrder("meta='[]'::jsonb")],
    ['missing catalog product', `DELETE FROM products_v2 WHERE id=${literal(id(301))};`],
    ['deleted catalog product', `UPDATE products_v2 SET status='deleted' WHERE id=${literal(id(301))};`],
    ['tariff belongs to foreign product', `UPDATE tariffs SET product_id=${literal(id(302))} WHERE id=${literal(id(401))};`],
    ['missing tariff', `DELETE FROM tariffs WHERE id=${literal(id(401))};`],
  ];
  for (const [name, mutation] of denied) await t.test(name, () => assert.deepEqual(rows(mutation), []));

  await t.test('later authenticated repeat cannot launder a legacy origin', () => {
    assert.deepEqual(rows(repeat(702, '2026-02-06T08:00:00Z') + updateSubmission("source='site_form'")), []);
  });
  await t.test('later own repeat cannot launder a foreign original actor', () => {
    assert.deepEqual(rows(repeat(702, '2026-02-06T08:00:00Z') + updateSubmission(meta('user_id', id(2)))), []);
  });
  await t.test('reused order yields one row with earliest verified date, not latest repeat', () => {
    const result = rows(repeat(702, '2026-02-06T08:00:00Z') + repeat(703, '2026-02-07T08:00:00Z'));
    assert.equal(result.length, 1);
    assert.equal(result[0].source_id, id(701));
    assert.equal(Date.parse(result[0].submitted_at), Date.parse('2026-02-03T08:10:00Z'));
  });
  await t.test('earliest verified submission chosen independently of origin pointer', () => {
    const result = rows(repeat(702, '2026-02-01T08:00:00Z'));
    assert.equal(result[0].source_id, id(702));
    assert.equal(Date.parse(result[0].submitted_at), Date.parse('2026-02-01T08:00:00Z'));
  });
  await t.test('foreign or malformed repeats do not affect original date', () => {
    const result = rows(repeat(702, '2026-01-01T08:00:00Z') + `UPDATE site_form_submissions SET metadata=jsonb_set(metadata,'{user_id}',to_jsonb(${literal(id(2))}::text)) WHERE id=${literal(id(702))};`);
    assert.equal(result.length, 1); assert.equal(result[0].source_id,id(701));
  });
  await t.test('separate genuine orders remain distinct with deterministic date order', () => {
    const mutation = `INSERT INTO orders_v2 SELECT ${literal(id(602))}::uuid,profile_id,user_id,product_id,tariff_id,status,is_deleted,deleted_at,reconcile_source,jsonb_set(meta,'{submission_id}',to_jsonb(${literal(id(702))}::text)),final_price FROM orders_v2 WHERE id=${literal(id(601))};`
      + repeat(702,'2026-02-06T08:00:00Z')
      + `UPDATE site_form_submissions SET order_id=${literal(id(602))} WHERE id=${literal(id(702))};`;
    assert.deepEqual(rows(mutation).map(row=>row.id),[id(602),id(601)]);
  });
  await t.test('same owned order user is allowed without backfill', () => assert.equal(rows(updateOrder(`user_id=${literal(id(1))}`)).length, 1));
  await t.test('inactive historical catalog does not erase request or grant rights', () => {
    assert.equal(rows(`UPDATE products_v2 SET is_active=false,status='inactive'; UPDATE tariffs SET is_active=false;`).length, 1);
  });
  for (const status of ['draft','pending','paid','partial','failed','refunded','canceled','partial_refund']) {
    await t.test(`order ${status} never asserts paid course access in request status`, () => {
      assert.equal(rows(updateOrder(`status=${literal(status)}`))[0].status, 'received');
    });
  }
  await t.test('course metadata alone cannot suppress an own site request', () => assert.equal(rows(course()).length, 1));
  await t.test('foreign course owner cannot suppress it even with both links', () => {
    assert.equal(rows(course(id(2)) + updateOrder(orderMeta('preregistration_id', id(801)))).length, 1);
  });
  await t.test('mismatched course product cannot suppress request', () => {
    assert.equal(rows(course() + updateOrder(orderMeta('preregistration_id', id(801))) + `UPDATE course_preregistrations SET meta=jsonb_set(meta,'{product_id}',to_jsonb(${literal(id(302))}::text));`).length, 1);
  });
  await t.test('trusted two-way owned exact course link removes only projection duplicate', () => {
    assert.deepEqual(rows(course() + updateOrder(orderMeta('preregistration_id', id(801)))), []);
  });
  await t.test('ordinary users cannot forge or change authenticated source provenance', () => {
    for (const dbRole of ['authenticated','anon']) {
      const options={dbRole,role:dbRole};
      const insert=raw(`BEGIN; ${context(options)} INSERT INTO site_form_submissions(id,profile_id,source,status,metadata) VALUES (${literal(id(799))},${literal(id(101))},'site_form_auth','processed','{}'); ROLLBACK;`);
      assert.notEqual(insert.status,0); assert.match(insert.stderr,/42501/);
      assert.equal(sql(`BEGIN; ${context(options)} WITH changed AS (UPDATE site_form_submissions SET metadata='{}'::jsonb WHERE id=${literal(id(701))} RETURNING id) SELECT count(*) FROM changed; ROLLBACK;`),'0');
    }
  });
  await t.test('legacy permissive course INSERT cannot forge trusted order backlink', () => {
    const result=JSON.parse(sql(`BEGIN; ${context()} ${course()} ${selectRows} ROLLBACK;`));
    assert.equal(result.length,1);
  });
  await t.test('ACL, no-arg signature, STABLE, SECURITY DEFINER and empty search_path', () => {
    const result = JSON.parse(sql(`SELECT jsonb_build_object('anon',has_function_privilege('anon','public.get_my_site_requests()','EXECUTE'),'auth',has_function_privilege('authenticated','public.get_my_site_requests()','EXECUTE'),'service',has_function_privilege('service_role','public.get_my_site_requests()','EXECUTE'),'volatility',p.provolatile,'definer',p.prosecdef,'args',p.pronargs,'settings',p.proconfig,'public',EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0)) FROM pg_proc p WHERE p.oid='public.get_my_site_requests()'::regprocedure;`));
    assert.deepEqual(result,{anon:false,auth:true,service:false,volatility:'s',definer:true,args:0,settings:['search_path=""'],public:false});
  });
  await t.test('repeated reads cause zero writes in source, money, rights, audit and notifications', () => {
    const tables=['profiles','products_v2','tariffs','site_pages','orders_v2','site_form_submissions','course_preregistrations','payments_v2','entitlements','audit_logs','domain_events','notifications'];
    const snapshot=()=>sql(`SELECT jsonb_build_object(${tables.map(name=>`${literal(name)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.${name} t)`).join(',')});`);
    const before=snapshot();rows();rows();assert.equal(snapshot(),before);
  });
});
