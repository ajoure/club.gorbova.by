import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20261105125235_contact_manual_customer_bonus.sql?raw";
import roleSource from "../../supabase/migrations/20260630195832_09c71c3f-ddb0-433a-853a-e81fb18b3212.sql?raw";
import alignedSource from "../../supabase/migrations/20260815181904_align_all_admin_access_contract.sql?raw";
import walletSource from "../../supabase/migrations/20260722010312_ddae1f52-794d-476c-a35f-123d462d1559.sql?raw";

const profile = "11111111-1111-4111-8111-111111111111";
const otherProfile = "22222222-2222-4222-8222-222222222222";
const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const customer = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const manager = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const editor = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const payment = "44444444-4444-4444-8444-444444444444";
const request = "55555555-5555-4555-8555-555555555555";
const secondRequest = "66666666-6666-4666-8666-666666666666";
let db: PGlite;
let legacyReferralDefinition: string;
const sqlFunction = (source: string, name: string) => {
  const value = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"))?.[0];
  if (!value) throw new Error(`Missing canonical SQL source: ${name}`);
  return value;
};
const actor = async (uid: string, role = "authenticated") => {
  await db.exec("RESET ROLE;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec(`SET ROLE ${role};`);
};
const credit = (overrides: unknown[] = []) => db.query<{ result: { entry_id: string; created: boolean } }>(
  "select public.admin_credit_customer_bonus($1,$2,$3,$4,$5) as result",
  [profile, 15000, "Synthetic consultation bonus 10%", request, payment].map((v, i) => overrides[i] === undefined ? v : overrides[i]),
);
const wallet = async (profileId = profile, key: string | null = request) => (await db.query<{ result: Record<string, unknown> }>(
  "select public.admin_get_customer_bonus_wallet($1,$2) as result", [profileId, key],
)).rows[0].result;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    create table public.profiles(id uuid primary key,user_id uuid,is_archived boolean default false,created_at timestamptz default now());
    create table public.roles(id uuid primary key default gen_random_uuid(),code text unique);
    create table public.user_roles_v2(user_id uuid,role_id uuid references public.roles(id));
    create table public.section_grants(user_id uuid,section text,level text);
    create table public.products_v2(id uuid primary key,name text);
    create table public.orders_v2(id uuid primary key,profile_id uuid,product_id uuid);
    create table public.payments_v2(id uuid primary key,profile_id uuid,order_id uuid,amount numeric,currency text,status text,
      paid_at timestamptz,product_name_raw text,is_deleted boolean default false,refunded_amount numeric,transaction_type text,
      reference_payment_id text,provider_payment_id text,meta jsonb);
    ${walletSource.match(/create table public\.referral_customer_credit_entries\s*\([\s\S]*?\);/i)?.[0]}
    alter table public.referral_customer_credit_entries enable row level security;
    grant select on public.referral_customer_credit_entries to authenticated;
    create policy own_credit on public.referral_customer_credit_entries for select to authenticated using (
      exists(select 1 from public.profiles p where p.id=profile_id and p.user_id=auth.uid()));
    grant select on public.profiles to authenticated;
    create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,actor_type text,action text,entity_type text,entity_id text,meta jsonb,created_at timestamptz default now());
    alter table public.audit_logs enable row level security;
    -- Adversarial broad legacy audit read: the feature's restrictive policy
    -- must still keep its own internal reason/actor private.
    grant select on public.audit_logs to authenticated,anon;
    create policy legacy_audit_read on public.audit_logs for select to public using(true);
  `);
  // Execute the actual canonical role and legacy referral helper bodies,
  // including their deliberately broader referrals/edit contract.
  await db.exec(sqlFunction(roleSource, "has_role_v2"));
  // Preserve the live helper ACL as well as its body. PUBLIC EXECUTE would
  // hide policy regressions for anon, which cannot call this helper in Cloud.
  await db.exec(`revoke all on function public.has_role_v2(uuid,text) from public,anon,authenticated;
    grant execute on function public.has_role_v2(uuid,text) to authenticated,service_role;`);
  await db.exec(`create function public.has_admin_section_access(p_user uuid,p_section text,p_level text)
    returns boolean language sql stable security definer as $$
      select public.has_role_v2(p_user,'admin') or public.has_role_v2(p_user,'super_admin')
        or exists(select 1 from public.section_grants where user_id=p_user and section=p_section and level=p_level)
    $$;`);
  await db.exec(sqlFunction(alignedSource, "referral_is_admin"));
  legacyReferralDefinition = (await db.query<{ definition: string }>("select pg_get_functiondef('public.referral_is_admin(uuid)'::regprocedure) definition")).rows[0].definition;
  await db.exec(sqlFunction(walletSource, "referral_customer_credit_available"));
  await db.exec(sqlFunction(walletSource, "referral_get_my_customer_credit"));
  // Reproduce the live calculator ACL drift that the new migration fixes.
  await db.exec("grant execute on function public.referral_customer_credit_available(uuid) to anon,authenticated,service_role;");
  await db.exec(migration);
}, 30_000);
beforeEach(async () => {
  await db.exec("RESET ROLE; truncate public.audit_logs, public.referral_customer_credit_entries, public.payments_v2, public.orders_v2, public.products_v2, public.profiles, public.user_roles_v2, public.section_grants, public.roles cascade;");
  await db.query("insert into public.profiles(id,user_id) values($1,$2),($3,$4)", [profile, customer, otherProfile, manager]);
  await db.exec("insert into public.roles(code) values('admin'),('super_admin'),('manager'),('referral_editor'),('user');");
  for (const [uid, code] of [[admin, "admin"], [manager, "manager"], [editor, "referral_editor"], [customer, "user"]]) {
    await db.query("insert into public.user_roles_v2 select $1,id from public.roles where code=$2", [uid, code]);
  }
  await db.query("insert into public.section_grants values($1,'referrals','edit')", [editor]);
  await db.query("insert into public.payments_v2(id,profile_id,amount,currency,status,transaction_type,paid_at,product_name_raw,meta) values($1,$2,1500,'BYN','succeeded','payment',now(),'Synthetic consultation','{}')", [payment, profile]);
  await actor(admin);
});
afterAll(async () => { await db?.close(); });

describe("manual customer bonus: real PostgreSQL role and ledger contract", () => {
  it("preserves all 17 reviewed DDL commands byte for byte inside one DO", () => {
    const commands = [...migration.matchAll(/ {2}EXECUTE \$(bonus_stmt_\d{2})\$([\s\S]*?)\$\1\$;/g)];
    expect(commands).toHaveLength(17);
    expect(commands.map((command) => command[1])).toEqual(
      Array.from({ length: 17 }, (_, index) => `bonus_stmt_${String(index + 1).padStart(2, "0")}`),
    );
    // Pin the complete reviewed source before the atomic wrapper, including
    // comments, whitespace, function bodies, policies, ACLs and final newline.
    const original = commands.map((command) => command[2]).join("");
    expect(Buffer.byteLength(original)).toBe(13624);
    expect(createHash("sha256").update(original).digest("hex"))
      .toBe("2879861bd5584ef14eef47753d08ebe4e4d1d146e7925c8185eff031cb5c4834");
    const scaffold = migration.replace(/ {2}EXECUTE \$(bonus_stmt_\d{2})\$[\s\S]*?\$\1\$;\n/g, "");
    expect(scaffold.replace(/^--[^\n]*\n/gm, ""))
      .toBe("DO $customer_bonus_migration$\nBEGIN\nEND;\n$customer_bonus_migration$;\n");
  });

  it("rolls back executed ACL, policy and function changes if later migration DDL fails", async () => {
    await db.exec("RESET ROLE;");
    const snapshot = async () => ({
      functions: (await db.query<{ name: string; body_md5: string }>(`
        select p.proname as name, p.oid::text as oid, md5(p.prosrc) as body_md5,
          pg_get_functiondef(p.oid) as definition, p.proacl::text as acl
        from pg_proc p where p.oid in (
          'public.referral_customer_credit_available(uuid)'::regprocedure,
          'public.customer_bonus_is_reversal(text,numeric,jsonb)'::regprocedure,
          'public.admin_get_customer_bonus_wallet(uuid,uuid)'::regprocedure,
          'public.admin_credit_customer_bonus(uuid,bigint,text,uuid,uuid)'::regprocedure,
          'public.get_my_customer_bonus_wallet()'::regprocedure)
        order by p.proname
      `)).rows,
      policies: (await db.query<{ name: string; using_md5: string }>(`
        select polname as name, oid::text as oid, polpermissive, polcmd,
          polroles::text as roles, pg_get_expr(polqual,polrelid) as using_expr,
          md5(pg_get_expr(polqual,polrelid)) as using_md5,
          pg_get_expr(polwithcheck,polrelid) as check_expr
        from pg_policy where polrelid='public.audit_logs'::regclass
        order by polname
      `)).rows,
    });
    const secured = await snapshot();
    try {
      // Start with recognizably different synthetic definitions and ACLs.
      // The failed migration must restore this exact state, not merely leave
      // an already-secured schema unchanged after a syntax error.
      await db.exec(`
        grant execute on function public.referral_customer_credit_available(uuid) to anon,authenticated;
        drop policy customer_bonus_private_audit_select on public.audit_logs;
        create policy customer_bonus_private_audit_select on public.audit_logs
          as restrictive for select to authenticated using(false);
        drop policy customer_bonus_private_audit_select_anon on public.audit_logs;
        create policy customer_bonus_private_audit_select_anon on public.audit_logs
          as restrictive for select to anon using(false);
        create or replace function public.customer_bonus_is_reversal(p_type text,p_amount numeric,p_meta jsonb)
          returns boolean language sql immutable security invoker set search_path=pg_catalog as $$ select false $$;
        create or replace function public.admin_get_customer_bonus_wallet(p_profile_id uuid,p_request_id uuid default null)
          returns jsonb language plpgsql stable security definer
          set search_path=pg_catalog,public,pg_temp as $$ begin return '{}'::jsonb; end $$;
      `);
      const before = await snapshot();
      const classifier = secured.functions.find((row) => row.name === "customer_bonus_is_reversal")!;
      const walletReader = secured.functions.find((row) => row.name === "admin_get_customer_bonus_wallet")!;
      const policy = secured.policies.find((row) => row.name === "customer_bonus_private_audit_select")!;
      expect(before).not.toEqual(secured);
      // Inject immediately after command 12, once both policy replacements,
      // calculator ACL changes and several function replacements have run.
      // Assert that the prefix really changed the catalog before triggering
      // an ordinary failing DDL command (duplicate table), SQLSTATE 42P07.
      const boundary = "$bonus_stmt_12$;";
      expect(migration.split(boundary)).toHaveLength(2);
      const failing = migration.replace(boundary, `${boundary}
        IF has_function_privilege('anon','public.referral_customer_credit_available(uuid)','EXECUTE')
          OR has_function_privilege('authenticated','public.referral_customer_credit_available(uuid)','EXECUTE')
          OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.customer_bonus_is_reversal(text,numeric,jsonb)'::regprocedure) IS DISTINCT FROM '${classifier.body_md5}'
          OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.admin_get_customer_bonus_wallet(uuid,uuid)'::regprocedure) IS DISTINCT FROM '${walletReader.body_md5}'
          OR (SELECT md5(pg_get_expr(polqual,polrelid)) FROM pg_policy
            WHERE polrelid='public.audit_logs'::regclass AND polname='customer_bonus_private_audit_select') IS DISTINCT FROM '${policy.using_md5}' THEN
          RAISE EXCEPTION 'migration_prefix_was_not_executed';
        END IF;
        EXECUTE 'CREATE TABLE public.audit_logs(id integer)';`);
      await expect(db.exec(failing)).rejects.toMatchObject({
        code: "42P07", message: 'relation "audit_logs" already exists',
      });
      // Query after the failed standalone DO, without an enclosing test
      // transaction or a test ROLLBACK that could mask lost atomicity.
      expect(await snapshot()).toEqual(before);
    } finally {
      // Preserve the shared synthetic fixture for all role/business tests.
      await db.exec(migration);
    }
  });

  it("credits once, audits the authenticated actor and reads the same durable request", async () => {
    const first = (await credit()).rows[0].result;
    expect(first.created).toBe(true);
    expect((await credit()).rows[0].result).toEqual({ ...first, created: false });
    const result = await wallet();
    expect(result.available_minor).toBe(15000);
    expect(result.request).toMatchObject({ entry_id: first.entry_id, profile_id: profile, amount_minor: 15000, source_payment_id: payment });
    await db.exec("RESET ROLE;");
    expect((await db.query("select count(*)::int n from referral_customer_credit_entries")).rows).toEqual([{ n: 1 }]);
    expect((await db.query("select actor_user_id, meta->>'amount_minor' amount from audit_logs")).rows).toEqual([{ actor_user_id: admin, amount: "15000" }]);
  });

  it("denies anon, missing identity, managers and customers for both admin RPCs", async () => {
    await actor("", "anon"); await expect(credit()).rejects.toThrow(/permission denied/);
    await expect(wallet()).rejects.toThrow(/permission denied/);
    for (const uid of ["", customer, manager]) {
      await actor(uid); await expect(credit()).rejects.toThrow(/bonus_admin_required/);
      await expect(wallet()).rejects.toThrow(/bonus_admin_required/);
    }
    await actor(admin, "service_role"); await expect(credit()).rejects.toThrow(/permission denied/);
  });

  it("denies delegated referrals/edit even when the actual legacy helper allows it", async () => {
    await credit(); await actor(editor);
    expect((await db.query<{ allowed: boolean }>("select public.referral_is_admin(auth.uid()) allowed")).rows[0].allowed).toBe(true);
    expect((await db.query<{ allowed: boolean }>("select public.has_role_v2(auth.uid(),'admin') allowed")).rows[0].allowed).toBe(false);
    await expect(credit([undefined, undefined, undefined, secondRequest, null])).rejects.toThrow(/bonus_admin_required/);
    await expect(wallet()).rejects.toThrow(/bonus_admin_required/);
    expect((await db.query("select * from referral_customer_credit_entries where profile_id=$1", [profile])).rows).toHaveLength(0);
    await expect(db.query("insert into referral_customer_credit_entries(profile_id,amount_minor,entry_type,status) values($1,99999,'admin_adjustment','posted')", [profile])).rejects.toThrow(/permission denied/);
    await expect(db.query("update referral_customer_credit_entries set amount_minor=99999")).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from referral_customer_credit_entries")).rejects.toThrow(/permission denied/);
    expect((await db.query("select * from audit_logs where action='customer_bonus_manually_credited'")).rows).toHaveLength(0);
  });

  it("keeps the broad legacy referral contract unchanged while fixing only bonus authorization", async () => {
    await db.exec("RESET ROLE;");
    expect((await db.query<{ definition: string }>("select pg_get_functiondef('public.referral_is_admin(uuid)'::regprocedure) definition")).rows[0].definition).toBe(legacyReferralDefinition);
    await actor(editor);
    expect((await db.query<{ allowed: boolean }>("select referral_is_admin(auth.uid()) allowed")).rows[0].allowed).toBe(true);
  });

  it("closes the raw balance calculator but preserves service and existing owner-wallet callers", async () => {
    await credit(); await actor("", "anon");
    await expect(db.query("select referral_customer_credit_available($1)", [profile])).rejects.toThrow(/permission denied/);
    await actor(customer);
    await expect(db.query("select referral_customer_credit_available($1)", [profile])).rejects.toThrow(/permission denied/);
    expect((await db.query<{ result: { available_minor: number } }>("select referral_get_my_customer_credit() result")).rows[0].result.available_minor).toBe(15000);
    expect((await db.query<{ result: { available_minor: number } }>("select get_my_customer_bonus_wallet() result")).rows[0].result.available_minor).toBe(15000);
    await actor("", "service_role");
    expect((await db.query<{ amount: number }>("select referral_customer_credit_available($1)::int amount", [profile])).rows[0].amount).toBe(15000);
  });

  it("preserves raw own ledger without exposing the internal audit reason or actor", async () => {
    await credit();
    expect((await wallet()).entries).toMatchObject([{ reason: "Synthetic consultation bonus 10%", actor_user_id: admin }]);
    await actor(customer);
    const own = (await db.query<{ metadata: Record<string, unknown> }>("select metadata from referral_customer_credit_entries where profile_id=$1", [profile])).rows;
    expect(own).toHaveLength(1);
    expect(own[0].metadata).toEqual({ request_id: request, manual_customer_bonus: true });
    expect((await db.query("select * from audit_logs where action='customer_bonus_manually_credited'")).rows).toHaveLength(0);
    await actor(admin);
    expect((await db.query("select * from audit_logs where action='customer_bonus_manually_credited'")).rows).toHaveLength(1);
  });

  it("keeps the new manual audit private even under an anonymous legacy audit read grant", async () => {
    await credit(); await db.exec("RESET ROLE;");
    await db.exec("insert into audit_logs(action) values('unrelated_action'),(null);");
    await actor("", "anon");
    await expect(db.query("select has_role_v2(auth.uid(),'admin')")).rejects.toThrow(/permission denied/);
    expect((await db.query("select * from audit_logs where action='customer_bonus_manually_credited'")).rows).toHaveLength(0);
    expect((await db.query("select action from audit_logs")).rows).toEqual([{ action: "unrelated_action" }, { action: null }]);
    for (const uid of [customer, editor]) {
      await actor(uid);
      expect((await db.query("select action from audit_logs")).rows).toEqual([{ action: "unrelated_action" }, { action: null }]);
    }
  });

  it("also supports super_admin without trusting caller-supplied profile/auth identity", async () => {
    await db.exec("RESET ROLE;");
    await db.query("update user_roles_v2 set role_id=(select id from roles where code='super_admin') where user_id=$1", [admin]);
    await actor(admin); await credit();
    await actor(customer);
    const mine = (await db.query<{ result: Record<string, unknown> }>("select get_my_customer_bonus_wallet() result")).rows[0].result;
    expect(mine.available_minor).toBe(15000);
    expect(JSON.stringify(mine)).not.toMatch(/actor_user_id|request_id|reason|Synthetic/);
    await actor(manager);
    expect((await db.query<{ result: { available_minor: number } }>("select get_my_customer_bonus_wallet() result")).rows[0].result.available_minor).toBe(0);
    expect((await db.query("select * from referral_customer_credit_entries")).rows).toHaveLength(0);
  });

  it("rejects altered payloads under a saved request, even for another contact", async () => {
    await credit();
    for (const changed of [[otherProfile], [undefined, 14000], [undefined, undefined, "Different reason"], [undefined, undefined, undefined, undefined, null]]) {
      await expect(credit(changed)).rejects.toThrow(/bonus_request_conflict/);
    }
    expect((await wallet()).available_minor).toBe(15000);
  });

  it("blocks a second request against the same source payment", async () => {
    await credit();
    await expect(credit([undefined, undefined, undefined, secondRequest])).rejects.toThrow(/bonus_payment_already_credited/);
    expect((await wallet()).available_minor).toBe(15000);
    expect((await wallet()).payments).toMatchObject([{ id: payment, already_credited: true }]);
  });

  it("rejects invalid amounts, reasons, missing keys and archived contacts without writing", async () => {
    for (const amount of [0, -1, null, "9007199254740992"]) await expect(credit([undefined, amount])).rejects.toThrow(/bonus_invalid/);
    for (const reason of [" ", null, "x".repeat(1001)]) await expect(credit([undefined, undefined, reason])).rejects.toThrow(/bonus_reason_required/);
    await expect(credit([undefined, undefined, undefined, null])).rejects.toThrow(/bonus_invalid/);
    await db.exec("RESET ROLE; update profiles set is_archived=true;"); await actor(admin);
    await expect(credit()).rejects.toThrow(/bonus_contact_not_found/);
    await db.exec("RESET ROLE;"); expect((await db.query("select count(*)::int n from referral_customer_credit_entries")).rows).toEqual([{ n: 0 }]);
  });

  it("validates the exact receipt owner, currency, status, refunds and amount", async () => {
    for (const change of ["currency='USD'", "status='failed'", "status='refunded'", "profile_id='" + otherProfile + "'", "is_deleted=true", "refunded_amount=1", "transaction_type='refund'"]) {
      await db.exec(`RESET ROLE; update payments_v2 set currency='BYN',status='succeeded',profile_id='${profile}',is_deleted=false,refunded_amount=0,transaction_type='payment'; update payments_v2 set ${change};`);
      await actor(admin); await expect(credit()).rejects.toThrow(/bonus_payment_not_eligible/);
    }
    await db.exec("RESET ROLE; update payments_v2 set transaction_type='payment';"); await actor(admin);
    await expect(credit([undefined, 150001])).rejects.toThrow(/bonus_payment_not_eligible/);
  });

  it("rejects a successful receipt whose linked order belongs to another profile", async () => {
    await db.exec("RESET ROLE;");
    await db.query("insert into orders_v2(id,profile_id) values($1,$2)", [secondRequest, otherProfile]);
    await db.query("update payments_v2 set order_id=$1", [secondRequest]);
    await actor(admin); await expect(credit()).rejects.toThrow(/bonus_payment_contact_conflict/);
  });

  it("detects a separate refund receipt and existing automatic bonus", async () => {
    await db.exec("RESET ROLE;");
    await db.query("insert into payments_v2(id,profile_id,amount,currency,status,transaction_type,reference_payment_id) values($1,$2,10,'BYN','succeeded','refund',$3)", [secondRequest, profile, payment]);
    await actor(admin); await expect(credit()).rejects.toThrow(/bonus_payment_refund_found/);
    await db.exec("RESET ROLE; delete from payments_v2 where transaction_type='refund';");
    await db.query("insert into referral_customer_credit_entries(profile_id,amount_minor,entry_type,status,source_payment_id) values($1,500,'subscription_earn','posted',$2)", [profile, payment]);
    await actor(admin); await expect(credit()).rejects.toThrow(/bonus_payment_already_credited/);
  });

  it.each([
    ["Возврат средств", -1500, {}], ["Возврат средств", 1500, {}], ["Отмена", 1500, {}],
    ["void", 1500, {}], ["Платёж", -1500, {}], ["Платёж", 1500, { type: "refund" }],
    ["payment", 1500, { transaction_type: "chargeback" }],
  ])("rejects linked reversal %s/%s/%j, including Russian imports", async (type, amount, meta) => {
    await db.exec("RESET ROLE;");
    await db.query("insert into payments_v2(id,profile_id,amount,currency,status,transaction_type,reference_payment_id,meta) values($1,$2,$3,'BYN','succeeded',$4,$5,$6::jsonb)", [secondRequest, profile, amount, type, payment, JSON.stringify(meta)]);
    await actor(admin); await expect(credit()).rejects.toThrow(/bonus_payment_refund_found/);
    expect((await wallet()).available_minor).toBe(0);
  });

  it.each([["Отмена", {}], ["cancel", {}], ["Платёж", { type: "refund" }], ["payment", { transaction_type: "возврат" }]])(
    "does not offer or credit a reversal-like source %s/%j", async (type, meta) => {
      await db.exec("RESET ROLE;");
      await db.query("update payments_v2 set transaction_type=$1,meta=$2::jsonb", [type, JSON.stringify(meta)]);
      await actor(admin); await expect(credit()).rejects.toThrow(/bonus_payment_not_eligible/);
      expect((await wallet()).payments).toEqual([]);
    },
  );

  it.each(["canceled", "cancelled"])("rejects a completed linked cancellation with status %s", async (status) => {
    await db.exec("RESET ROLE;");
    await db.query("insert into payments_v2(id,profile_id,amount,currency,status,transaction_type,reference_payment_id) values($1,$2,1500,'BYN',$3,'Отмена',$4)", [secondRequest, profile, status, payment]);
    await actor(admin); await expect(credit()).rejects.toThrow(/bonus_payment_refund_found/);
    expect((await wallet()).available_minor).toBe(0);
  });

  it("does not mistake a failed refund attempt for a completed reversal", async () => {
    await db.exec("RESET ROLE;");
    await db.query("insert into payments_v2(id,profile_id,amount,currency,status,transaction_type,reference_payment_id) values($1,$2,1500,'BYN','failed','Возврат средств',$3)", [secondRequest, profile, payment]);
    await actor(admin); await credit(); expect((await wallet()).available_minor).toBe(15000);
  });

  it("allows an explicit standalone bonus without creating a referral or changing a payment", async () => {
    await credit([undefined, undefined, undefined, undefined, null]);
    expect((await wallet()).available_minor).toBe(15000);
    await db.exec("RESET ROLE;");
    expect((await db.query("select amount,status,refunded_amount from payments_v2")).rows).toEqual([{ amount: "1500", status: "succeeded", refunded_amount: null }]);
    expect((await db.query("select count(*)::int n from orders_v2")).rows).toEqual([{ n: 0 }]);
  });

  it("rolls the credit back if the audit cannot be written", async () => {
    await db.exec("RESET ROLE; alter table audit_logs add constraint audit_failure check(false);");
    await actor(admin); await expect(credit()).rejects.toThrow(/audit_failure/);
    await db.exec("RESET ROLE; alter table audit_logs drop constraint audit_failure;");
    expect((await db.query("select count(*)::int n from referral_customer_credit_entries")).rows).toEqual([{ n: 0 }]);
  });

  it("does not mutate expired reservations while showing the effective customer balance", async () => {
    await credit(); await db.exec("RESET ROLE;");
    await db.query("insert into referral_customer_credit_entries(profile_id,amount_minor,entry_type,status,expires_at) values($1,-2000,'purchase_reserve','reserved',now()-interval '1 hour'),($1,-1000,'purchase_reserve','reserved',now()+interval '1 hour')", [profile]);
    await actor(admin); expect((await wallet()).available_minor).toBe(14000);
    await actor(customer);
    expect((await db.query<{ result: { available_minor: number } }>("select get_my_customer_bonus_wallet() result")).rows[0].result.available_minor).toBe(14000);
    await db.exec("RESET ROLE;");
    expect((await db.query("select count(*)::int n from referral_customer_credit_entries where status='reserved'")).rows).toEqual([{ n: 2 }]);
  });
});
