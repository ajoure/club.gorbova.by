// Transient Stage 4 proof: multi-tenant guards on save_session_document_atomic.
// Idempotent harness; can be deployed once and invoked many times. Removed after proof.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PKG_IDEOLOGY = "06068dcf-6943-425c-aa6b-8bfaa550cfd2";
const ITEM_IDEOLOGY = "a1291835-8230-47ba-8e1f-2f258e612c2f";
const ROLE_IDEOLOGY = "9b9a8b7a-b878-4406-8251-fe040bfc56e8"; // ln-000012
const FIELD_IDEOLOGY = "76e082af-5511-45dc-b2a3-258f13911ebc"; // pf-000002 date

const PKG_GS = "21764469-1ba9-49b3-90d9-5349bcbcd531";
const ITEM_GS = "a1a40df2-9d15-4a78-9b74-78dbdcd24e92";
const FIELD_GS = "0cc7d9ac-832b-4f60-8e2b-b05b8090cf5b"; // pf-000003 date, cross-package

const PWD = "Stage4Proof!123";
const TAG = "stage4_proof";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Step = { name: string; expect: "ok" | "error"; got: "ok" | "error"; code?: string; message?: string; pass: boolean };
const steps: Step[] = [];

async function callRpc(jwt: string, body: any) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_session_document_atomic`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Prefer: "params=single-object",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

function record(name: string, expect: "ok" | "error", res: { status: number; body: any }, expectedCode?: string) {
  const got: "ok" | "error" = res.status >= 200 && res.status < 300 ? "ok" : "error";
  const code = typeof res.body === "object" && res.body ? (res.body.message || res.body.code || res.body.details) : undefined;
  let pass = got === expect;
  if (pass && expect === "error" && expectedCode) {
    pass = String(code || "").includes(expectedCode);
  }
  steps.push({ name, expect, got, code: String(code || ""), pass, message: typeof res.body === "string" ? res.body : undefined });
}

async function ensureUser(email: string) {
  // try find existing
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find((u: any) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PWD, email_confirm: true });
  if (error) throw error;
  return data.user!.id;
}

async function signIn(email: string) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PWD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("signin failed: " + JSON.stringify(j));
  return j.access_token as string;
}

async function setup() {
  // 1. Two regular users + one admin user.
  const emailA = "stage4-owner-a@proof.local";
  const emailB = "stage4-foreign-b@proof.local";
  const emailAdmin = "stage4-admin@proof.local";

  const uidA = await ensureUser(emailA);
  const uidB = await ensureUser(emailB);
  const uidAdmin = await ensureUser(emailAdmin);

  // 2. Profiles. handle_new_user trigger should have created them; ensure exists.
  for (const uid of [uidA, uidB, uidAdmin]) {
    await admin.from("profiles").upsert({ user_id: uid, full_name: TAG + "_" + uid.slice(0, 8) }, { onConflict: "user_id" });
  }
  const { data: profs } = await admin.from("profiles").select("id,user_id").in("user_id", [uidA, uidB, uidAdmin]);
  const pid = (uid: string) => profs!.find((p: any) => p.user_id === uid)!.id;

  // 3. Grant admin role.
  const { data: adminRole } = await admin.from("roles").select("id").eq("code", "admin").maybeSingle();
  if (adminRole) {
    await admin.from("user_roles_v2").upsert({ user_id: uidAdmin, role_id: adminRole.id }, { onConflict: "user_id,role_id" });
  }

  // 4. Persons (owned by each).
  const upsertPerson = async (profileId: string, name: string) => {
    const { data: existing } = await admin.from("legal_details_persons").select("id").eq("profile_id", profileId).eq("full_name", name).maybeSingle();
    if (existing) return existing.id;
    const { data, error } = await admin.from("legal_details_persons").insert({ profile_id: profileId, full_name: name, is_active: true, notes: TAG }).select("id").single();
    if (error) throw error;
    return data.id;
  };
  const personA = await upsertPerson(pid(uidA), TAG + "_person_A");
  const personB = await upsertPerson(pid(uidB), TAG + "_person_B");

  // 5. Sessions.
  const upsertSession = async (profileId: string, userId: string, pkg: string, label: string) => {
    const { data: ex } = await admin.from("document_package_sessions").select("id").eq("profile_id", profileId).eq("package_template_id", pkg).contains("metadata", { stage4_label: label }).maybeSingle();
    if (ex) return ex.id;
    const { data, error } = await admin.from("document_package_sessions").insert({
      profile_id: profileId, user_id: userId, package_template_id: pkg,
      status: "draft", metadata: { stage4_label: label, tag: TAG }, created_by: userId, updated_by: userId,
    }).select("id").single();
    if (error) throw error;
    return data.id;
  };
  const sessionA = await upsertSession(pid(uidA), uidA, PKG_IDEOLOGY, "sessionA_ideology");
  const sessionB = await upsertSession(pid(uidB), uidB, PKG_IDEOLOGY, "sessionB_ideology");

  return { uidA, uidB, uidAdmin, pidA: pid(uidA), pidB: pid(uidB), personA, personB, sessionA, sessionB, emailA, emailB, emailAdmin };
}

async function cleanup(ctx: any) {
  // remove sessions, field values, role assignments, persons, audit rows from test users.
  const userIds = [ctx.uidA, ctx.uidB, ctx.uidAdmin];
  const sessionIds = [ctx.sessionA, ctx.sessionB];
  await admin.from("document_package_item_role_assignments").delete().in("package_session_id", sessionIds);
  await admin.from("document_package_session_field_values").delete().in("session_id", sessionIds);
  await admin.from("document_package_sessions").delete().in("id", sessionIds);
  await admin.from("legal_details_persons").delete().in("id", [ctx.personA, ctx.personB]);
  await admin.from("audit_logs").delete().in("actor_user_id", userIds).eq("action", "package_document_atomic_save");
  for (const uid of userIds) {
    try { await admin.auth.admin.deleteUser(uid); } catch (_) {}
  }
}

async function run() {
  const ctx = await setup();
  const jwtA = await signIn(ctx.emailA);
  const jwtB = await signIn(ctx.emailB);
  const jwtAdmin = await signIn(ctx.emailAdmin);

  // baseline audit count
  const baseline = await admin.from("audit_logs").select("id", { count: "exact", head: true })
    .in("actor_user_id", [ctx.uidA, ctx.uidB, ctx.uidAdmin])
    .eq("action", "package_document_atomic_save");

  // T1: Owner A saves own session — ok.
  record("T1_owner_saves_own", "ok",
    await callRpc(jwtA, { _session_id: ctx.sessionA, _package_template_item_id: ITEM_IDEOLOGY,
      _field_values: [], _role_assignments: [{ role_catalog_id: ROLE_IDEOLOGY, person_id: ctx.personA, position: "CEO" }] }));

  // T2: Foreign B tries to save A's session — forbidden.
  record("T2_foreign_user_blocked", "error",
    await callRpc(jwtB, { _session_id: ctx.sessionA, _package_template_item_id: ITEM_IDEOLOGY,
      _field_values: [], _role_assignments: [] }), "forbidden");

  // T3: A uses B's person_id — person_outside_session_owner.
  record("T3_foreign_person_blocked", "error",
    await callRpc(jwtA, { _session_id: ctx.sessionA, _package_template_item_id: ITEM_IDEOLOGY,
      _field_values: [], _role_assignments: [{ role_catalog_id: ROLE_IDEOLOGY, person_id: ctx.personB }] }),
    "person_outside_session_owner");

  // T4: A tries to save into B's session — forbidden.
  record("T4_substituted_session_blocked", "error",
    await callRpc(jwtA, { _session_id: ctx.sessionB, _package_template_item_id: ITEM_IDEOLOGY,
      _field_values: [], _role_assignments: [] }), "forbidden");

  // T5: A passes item from different package — item_outside_session_package.
  record("T5_cross_pkg_item_blocked", "error",
    await callRpc(jwtA, { _session_id: ctx.sessionA, _package_template_item_id: ITEM_GS,
      _field_values: [], _role_assignments: [] }), "item_outside_session_package");

  // T6: A passes field catalog id from different package.
  record("T6_cross_pkg_field_blocked", "error",
    await callRpc(jwtA, { _session_id: ctx.sessionA, _package_template_item_id: ITEM_IDEOLOGY,
      _field_values: [{ field_catalog_id: FIELD_GS, value: "2026-01-01" }], _role_assignments: [] }),
    "field_outside_session_package");

  // T7: A passes random role catalog id from different package — create temp role first.
  const { data: tmpRole } = await admin.from("document_package_role_catalog").insert({
    package_template_id: PKG_GS, name: TAG + "_tmp_role", is_active: true, public_id: "ln-stage4-tmp",
  }).select("id").single();
  record("T7_cross_pkg_role_blocked", "error",
    await callRpc(jwtA, { _session_id: ctx.sessionA, _package_template_item_id: ITEM_IDEOLOGY,
      _field_values: [], _role_assignments: [{ role_catalog_id: tmpRole!.id, person_id: ctx.personA }] }),
    "role_outside_session_package");
  await admin.from("document_package_role_catalog").delete().eq("id", tmpRole!.id);

  // T8: Admin saves A's session — ok.
  record("T8_admin_can_save_any", "ok",
    await callRpc(jwtAdmin, { _session_id: ctx.sessionA, _package_template_item_id: ITEM_IDEOLOGY,
      _field_values: [], _role_assignments: [{ role_catalog_id: ROLE_IDEOLOGY, person_id: ctx.personA, position: "Admin-Override" }] }));

  // T9: Read RLS — B selects A's session field values via PostgREST.
  const r9 = await fetch(`${SUPABASE_URL}/rest/v1/document_package_session_field_values?session_id=eq.${ctx.sessionA}&select=id`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwtB}` },
  });
  const b9 = await r9.json();
  const t9pass = r9.status === 200 && Array.isArray(b9) && b9.length === 0;
  steps.push({ name: "T9_foreign_read_blocked", expect: "ok", got: t9pass ? "ok" : "error",
    code: `status=${r9.status} rows=${Array.isArray(b9) ? b9.length : "n/a"}`, pass: t9pass });

  // T10: B reads A's role assignments — must be empty.
  const r10 = await fetch(`${SUPABASE_URL}/rest/v1/document_package_item_role_assignments?package_session_id=eq.${ctx.sessionA}&select=id`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwtB}` },
  });
  const b10 = await r10.json();
  const t10pass = r10.status === 200 && Array.isArray(b10) && b10.length === 0;
  steps.push({ name: "T10_foreign_read_roles_blocked", expect: "ok", got: t10pass ? "ok" : "error",
    code: `status=${r10.status} rows=${Array.isArray(b10) ? b10.length : "n/a"}`, pass: t10pass });

  // Audit verification: only T1 + T8 should have created audit rows (2 successes).
  const after = await admin.from("audit_logs").select("id, actor_user_id", { count: "exact" })
    .in("actor_user_id", [ctx.uidA, ctx.uidB, ctx.uidAdmin])
    .eq("action", "package_document_atomic_save");
  const newAudit = (after.count ?? 0) - (baseline.count ?? 0);
  const auditByActor: Record<string, number> = {};
  for (const r of (after.data || [])) {
    auditByActor[r.actor_user_id] = (auditByActor[r.actor_user_id] || 0) + 1;
  }
  steps.push({
    name: "T11_audit_only_for_success",
    expect: "ok",
    got: newAudit === 2 ? "ok" : "error",
    code: `new=${newAudit} by_actor=${JSON.stringify(auditByActor)}`,
    pass: newAudit === 2 && (auditByActor[ctx.uidB] ?? 0) === 0,
  });

  await cleanup(ctx);

  const allPass = steps.every((s) => s.pass);
  return { ok: allPass, steps };
}

Deno.serve(async () => {
  try {
    const out = await run();
    return new Response(JSON.stringify(out, null, 2), { status: out.ok ? 200 : 500, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message), stack: (e as Error).stack }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
