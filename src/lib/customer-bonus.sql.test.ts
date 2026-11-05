import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20261105125235_contact_manual_customer_bonus.sql?raw";

const profile = "11111111-1111-4111-8111-111111111111";
const otherProfile = "22222222-2222-4222-8222-222222222222";
const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const customer = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const manager = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const payment = "44444444-4444-4444-8444-444444444444";
const request = "55555555-5555-4555-8555-555555555555";
const secondRequest = "66666666-6666-4666-8666-666666666666";
let db: PGlite;
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
    create table public.roles(user_id uuid,code text);
    create function public.referral_is_admin(p_user_id uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.roles where user_id=p_user_id and code in ('admin','super_admin')) $$;
    create table public.products_v2(id uuid primary key,name text);
    create table public.orders_v2(id uuid primary key,profile_id uuid,product_id uuid);
    create table public.payments_v2(id uuid primary key,profile_id uuid,order_id uuid,amount numeric,currency text,status text,
      paid_at timestamptz,product_name_raw text,is_deleted boolean default false,refunded_amount numeric,transaction_type text,
      reference_payment_id text,provider_payment_id text,meta jsonb);
    create table public.referral_customer_credit_entries(id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.profiles(id),
      amount_minor bigint not null check(amount_minor<>0),entry_type text,status text,source_payment_id uuid unique references public.payments_v2(id),
      source_order_id uuid,checkout_key text unique,metadata jsonb not null default '{}',created_at timestamptz default now(),expires_at timestamptz,applied_order_id uuid);
    alter table public.referral_customer_credit_entries enable row level security;
    grant select on public.referral_customer_credit_entries to authenticated;
    create policy own_credit on public.referral_customer_credit_entries for select to authenticated using (
      exists(select 1 from public.profiles p where p.id=profile_id and p.user_id=auth.uid()));
    grant select on public.profiles to authenticated;
    create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,actor_type text,action text,entity_type text,entity_id uuid,meta jsonb);
  `);
  await db.exec(migration);
}, 30_000);
beforeEach(async () => {
  await db.exec("RESET ROLE; truncate public.audit_logs, public.referral_customer_credit_entries, public.payments_v2, public.orders_v2, public.products_v2, public.profiles, public.roles cascade;");
  await db.query("insert into public.profiles(id,user_id) values($1,$2),($3,$4)", [profile, customer, otherProfile, manager]);
  await db.query("insert into public.roles values($1,'admin'),($2,'manager'),($3,'user')", [admin, manager, customer]);
  await db.query("insert into public.payments_v2(id,profile_id,amount,currency,status,transaction_type,paid_at,product_name_raw,meta) values($1,$2,1500,'BYN','succeeded','payment',now(),'Synthetic consultation','{}')", [payment, profile]);
  await actor(admin);
});
afterAll(async () => { await db?.close(); });

describe("manual customer bonus: real PostgreSQL role and ledger contract", () => {
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

  it("also supports super_admin without trusting caller-supplied profile/auth identity", async () => {
    await db.exec("RESET ROLE; update roles set code='super_admin' where code='admin';");
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
