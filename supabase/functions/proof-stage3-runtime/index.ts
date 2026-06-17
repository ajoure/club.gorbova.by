// TRANSIENT — Stage 3 runtime proof for save_session_document_atomic.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const SESSION_ID = "b0b229b7-cf7e-4869-988e-8e97bdf54043";
const OWNER_UID = "05cd3754-d589-4d90-97d1-89ba2bee610b";
const ITEM_DOC1 = "a1291835-8230-47ba-8e1f-2f258e612c2f";
const ITEM_DOC2 = "dac9d7b2-7905-492d-8d30-959395dbebef";
const PF_ORPHAN_ID = "76e082af-5511-45dc-b2a3-258f13911ebc";
const ROLE_A = "9b9a8b7a-b878-4406-8251-fe040bfc56e8";
const ROLE_B = "7f0bffd2-ecf1-4a37-af61-50a628c9948f";
const PERSON_ID = "26402449-4eb1-4b87-a004-8f5cbbc2ff65";

type Step = { name: string; ok: boolean; details: unknown };

async function callAtomic(itemId: string, fields: unknown[] = [], roles: unknown[] = [], expectedVersion: string | null = null) {
  const { data, error } = await admin.rpc("_proof_stage3_call_atomic", {
    p_uid: OWNER_UID,
    p_session_id: SESSION_ID,
    p_item_id: itemId,
    p_field_values: fields,
    p_role_assignments: roles,
    p_expected_version: expectedVersion,
  });
  return { data, error };
}

async function auditCount() {
  const { count } = await admin.from("audit_logs")
    .select("*", { count: "exact", head: true })
    .eq("action", "package_document_atomic_save").eq("entity_id", SESSION_ID);
  return count ?? 0;
}

Deno.serve(async (_req) => {
  const steps: Step[] = [];
  const log = (msg: string) => console.log(`[stage3] ${msg}`);
  try {
    log("start");

    // S1
    log("S1");
    const s1 = await callAtomic(ITEM_DOC2, [{ field_catalog_id: PF_ORPHAN_ID, value: "2026-06-17" }]);
    steps.push({ name: "S1.orphan_per_item_rejected", ok: !!s1.error && /orphan_field_not_writable_per_item/.test(s1.error.message ?? ""),
      details: { error: s1.error?.message } });

    log("S2");
    const s2 = await callAtomic(ITEM_DOC1, [], [], "00000000-0000-0000-0000-000000000001");
    steps.push({ name: "S2.stale_version_rejected",
      ok: !!s2.error && /stale_template_version/.test(s2.error.message ?? ""),
      details: { error: s2.error?.message } });

    // S3 rollback
    log("S3");
    const auditBefore3 = await auditCount();
    const rolesBefore3 = ((await admin.from("document_package_item_role_assignments").select("id")
      .eq("package_session_id", SESSION_ID)).data ?? []).length;
    const s3 = await callAtomic(ITEM_DOC1, [], [
      { role_catalog_id: ROLE_A, person_id: PERSON_ID, position: "rollback_marker_should_not_persist" },
      { role_catalog_id: ROLE_B, person_id: "00000000-0000-0000-0000-000000000099" },
    ]);
    const rolesAfter3 = (await admin.from("document_package_item_role_assignments").select("metadata")
      .eq("package_session_id", SESSION_ID)).data ?? [];
    const auditAfter3 = await auditCount();
    const leaked3 = rolesAfter3.some((r: any) => r.metadata?.position === "rollback_marker_should_not_persist");
    steps.push({ name: "S3.atomic_rollback", ok: !!s3.error && /person_not_accessible/.test(s3.error.message ?? "") && auditAfter3 === auditBefore3 && !leaked3 && rolesAfter3.length === rolesBefore3,
      details: { error: s3.error?.message, audit_before: auditBefore3, audit_after: auditAfter3, leaked: leaked3, rows_before: rolesBefore3, rows_after: rolesAfter3.length } });

    // S4 desired-state delete
    log("S4");
    const origRoles = (await admin.from("document_package_item_role_assignments")
      .select("*").eq("package_session_id", SESSION_ID)).data ?? [];
    const r4a = await callAtomic(ITEM_DOC1, [], [
      { role_catalog_id: ROLE_A, person_id: PERSON_ID, position: "stage3_proof_A" },
      { role_catalog_id: ROLE_B, person_id: PERSON_ID, position: "stage3_proof_B" },
    ]);
    const after4a = (await admin.from("document_package_item_role_assignments")
      .select("role_catalog_id,is_active").eq("package_session_id", SESSION_ID)
      .eq("package_template_item_id", ITEM_DOC1).eq("is_active", true)).data ?? [];
    const ids4a = after4a.map((r: any) => r.role_catalog_id).sort();
    const r4b = await callAtomic(ITEM_DOC1, [], [
      { role_catalog_id: ROLE_A, person_id: PERSON_ID, position: "stage3_proof_A_only" },
    ]);
    const after4b = (await admin.from("document_package_item_role_assignments")
      .select("role_catalog_id,is_active").eq("package_session_id", SESSION_ID)
      .eq("package_template_item_id", ITEM_DOC1)).data ?? [];
    const active4b = after4b.filter((r: any) => r.is_active);
    const archivedB = after4b.some((r: any) => r.role_catalog_id === ROLE_B && !r.is_active);
    steps.push({ name: "S4.desired_state_delete", ok: !r4a.error && !r4b.error
      && JSON.stringify(ids4a) === JSON.stringify([ROLE_A, ROLE_B].sort())
      && active4b.length === 1 && active4b[0].role_catalog_id === ROLE_A && archivedB,
      details: { r4a: r4a.data, r4b: r4b.data, ids4a, active4b_count: active4b.length, archivedB } });

    // S5 concurrent 5×parallel
    log("S5");
    const auditBefore5 = await auditCount();
    const payloads = [0, 1, 2, 3, 4].map((i) => ([
      { role_catalog_id: ROLE_A, person_id: PERSON_ID, position: `concurrent_payload_${i}_A` },
      { role_catalog_id: ROLE_B, person_id: PERSON_ID, position: `concurrent_payload_${i}_B` },
    ]));
    const t0 = performance.now();
    const results = await Promise.all(payloads.map((roles) => callAtomic(ITEM_DOC1, [], roles)));
    const elapsed = Math.round(performance.now() - t0);
    const errors = results.map((r) => r.error?.message ?? null);
    const successCount = results.filter((r) => !r.error).length;
    const post5 = (await admin.from("document_package_item_role_assignments")
      .select("role_catalog_id,person_id,is_active,metadata")
      .eq("package_session_id", SESSION_ID).eq("package_template_item_id", ITEM_DOC1)).data ?? [];
    const active5 = post5.filter((r: any) => r.is_active);
    const keys: Record<string, number> = {};
    for (const r of active5) { const k = `${r.role_catalog_id}|${r.person_id}`; keys[k] = (keys[k] ?? 0) + 1; }
    const dupKeys = Object.entries(keys).filter(([, c]) => c > 1);
    const markers = active5.map((r: any) => r.metadata?.position).filter(Boolean);
    const indices = new Set(markers.map((m: string) => m.match(/concurrent_payload_(\d)/)?.[1]).filter(Boolean));
    const coherent = indices.size === 1;
    const auditAfter5 = await auditCount();
    steps.push({ name: "S5.concurrent_5_parallel",
      ok: dupKeys.length === 0 && coherent && (auditAfter5 - auditBefore5) === successCount && successCount >= 1,
      details: { elapsed_ms: elapsed, success_count: successCount, errors, active_count: active5.length, duplicate_keys: dupKeys, winning_indices: [...indices], audit_delta: auditAfter5 - auditBefore5, markers } });

    // Cleanup: restore original role state
    log("cleanup");
    const origIds = new Set(origRoles.map((r: any) => r.id));
    const origActive = new Set(origRoles.filter((r: any) => r.is_active).map((r: any) => r.id));
    const cur = (await admin.from("document_package_item_role_assignments")
      .select("id,is_active").eq("package_session_id", SESSION_ID)).data ?? [];
    const extras = cur.filter((r: any) => !origIds.has(r.id)).map((r: any) => r.id);
    if (extras.length) await admin.from("document_package_item_role_assignments").delete().in("id", extras);
    for (const r of cur) {
      if (!origIds.has(r.id)) continue;
      const wantActive = origActive.has(r.id);
      if (r.is_active !== wantActive) {
        await admin.from("document_package_item_role_assignments").update({ is_active: wantActive }).eq("id", r.id);
      }
    }

    const allPass = steps.every((s) => s.ok);
    log(`done all_pass=${allPass}`);
    return new Response(JSON.stringify({ all_pass: allPass, steps }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    log(`fatal ${String(e)}`);
    return new Response(JSON.stringify({ fatal: true, error: String(e), steps }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } });
  }
});
