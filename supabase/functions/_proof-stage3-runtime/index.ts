// TRANSIENT — Stage 3 runtime proof for save_session_document_atomic.
// Removes after proof completes. NO production logic depends on this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// Fixture (Ideology session, real owner)
const SESSION_ID = "b0b229b7-cf7e-4869-988e-8e97bdf54043";
const OWNER_UID = "05cd3754-d589-4d90-97d1-89ba2bee610b";
const ITEM_DOC1 = "a1291835-8230-47ba-8e1f-2f258e612c2f"; // Приказ (8 detected)
const ITEM_DOC2 = "dac9d7b2-7905-492d-8d30-959395dbebef"; // Положение (4 detected)
const PF_ORPHAN_ID = "76e082af-5511-45dc-b2a3-258f13911ebc"; // pf-000002 (orphan)
const ROLE_A = "9b9a8b7a-b878-4406-8251-fe040bfc56e8"; // ln-000012
const ROLE_B = "7f0bffd2-ecf1-4a37-af61-50a628c9948f"; // ln-000013
const PERSON_ID = "26402449-4eb1-4b87-a004-8f5cbbc2ff65";

type Step = { name: string; ok: boolean; details: unknown };
const steps: Step[] = [];

async function callAtomic(args: {
  itemId: string;
  fields?: unknown[];
  roles?: unknown[];
  expectedVersion?: string | null;
}) {
  const { data, error } = await admin.rpc("_proof_stage3_call_atomic", {
    p_uid: OWNER_UID,
    p_session_id: SESSION_ID,
    p_item_id: args.itemId,
    p_field_values: args.fields ?? [],
    p_role_assignments: args.roles ?? [],
    p_expected_version: args.expectedVersion ?? null,
  });
  return { data, error };
}

async function snapshotState() {
  const [{ count: auditPre }, { data: rolesPre }, { data: valsPre }] = await Promise.all([
    admin.from("audit_logs").select("*", { count: "exact", head: true })
      .eq("action", "package_document_atomic_save").eq("resource_id", SESSION_ID),
    admin.from("document_package_item_role_assignments").select("*")
      .eq("package_session_id", SESSION_ID),
    admin.from("document_package_session_field_values").select("*")
      .eq("session_id", SESSION_ID),
  ]);
  return { auditPre, rolesPre, valsPre };
}

async function restoreRoles(originalRoles: any[]) {
  // Reactivate originals, deactivate any extras created during proof.
  const origActiveIds = new Set(originalRoles.filter((r) => r.is_active).map((r) => r.id));
  const { data: cur } = await admin.from("document_package_item_role_assignments")
    .select("id,is_active").eq("package_session_id", SESSION_ID);
  for (const r of cur ?? []) {
    const shouldBeActive = origActiveIds.has(r.id);
    if (r.is_active !== shouldBeActive) {
      await admin.from("document_package_item_role_assignments")
        .update({ is_active: shouldBeActive }).eq("id", r.id);
    }
  }
  // Hard-delete brand-new rows that weren't in the original snapshot.
  const origIds = new Set(originalRoles.map((r) => r.id));
  const extraIds = (cur ?? []).filter((r) => !origIds.has(r.id)).map((r) => r.id);
  if (extraIds.length) {
    await admin.from("document_package_item_role_assignments").delete().in("id", extraIds);
  }
}

Deno.serve(async (_req) => {
  try {
    const pre = await snapshotState();
    steps.push({ name: "snapshot.pre", ok: true, details: {
      audit_pre: pre.auditPre,
      roles_pre: (pre.rolesPre ?? []).length,
      values_pre: (pre.valsPre ?? []).length,
    }});

    // --- Scenario 1: orphan_field_not_writable_per_item ---
    {
      const { data, error } = await callAtomic({
        itemId: ITEM_DOC2,
        fields: [{ field_catalog_id: PF_ORPHAN_ID, value: "2026-06-17" }],
      });
      const ok = !!error && /orphan_field_not_writable_per_item/.test(error.message || JSON.stringify(error));
      steps.push({ name: "S1.orphan_per_item_rejected", ok, details: { error: error?.message, data } });
    }

    // --- Scenario 2: stale_template_version ---
    {
      const { data, error } = await callAtomic({
        itemId: ITEM_DOC1,
        expectedVersion: "00000000-0000-0000-0000-000000000001",
      });
      const ok = !!error && /stale_template_version/.test(error.message || "");
      steps.push({ name: "S2.stale_version_rejected", ok, details: { error: error?.message, data } });
    }

    // --- Scenario 3: atomic rollback (valid role then bad person mid-payload) ---
    {
      const auditBefore = (await admin.from("audit_logs").select("*", { count: "exact", head: true })
        .eq("action", "package_document_atomic_save").eq("resource_id", SESSION_ID)).count ?? 0;
      const rolesBefore = (await admin.from("document_package_item_role_assignments").select("id")
        .eq("package_session_id", SESSION_ID)).data ?? [];
      const { data, error } = await callAtomic({
        itemId: ITEM_DOC1,
        roles: [
          { role_catalog_id: ROLE_A, person_id: PERSON_ID, position: "rollback_test_should_not_persist" },
          { role_catalog_id: ROLE_B, person_id: "00000000-0000-0000-0000-000000000099" },
        ],
      });
      const auditAfter = (await admin.from("audit_logs").select("*", { count: "exact", head: true })
        .eq("action", "package_document_atomic_save").eq("resource_id", SESSION_ID)).count ?? 0;
      const rolesAfter = (await admin.from("document_package_item_role_assignments").select("id,metadata,role_catalog_id,is_active")
        .eq("package_session_id", SESSION_ID)).data ?? [];
      const leakedRollbackMarker = rolesAfter.some((r: any) =>
        r.metadata?.position === "rollback_test_should_not_persist");
      const newRowsAppeared = rolesAfter.length > rolesBefore.length;
      const ok = !!error
        && /person_not_accessible/.test(error.message || "")
        && auditAfter === auditBefore
        && !leakedRollbackMarker
        && !newRowsAppeared;
      steps.push({ name: "S3.atomic_rollback", ok, details: {
        error: error?.message,
        data,
        audit_before: auditBefore,
        audit_after: auditAfter,
        roles_before_count: rolesBefore.length,
        roles_after_count: rolesAfter.length,
        leaked_rollback_marker: leakedRollbackMarker,
      }});
    }

    // --- Scenario 4: desired-state delete ---
    let originalRolesForRestore: any[] = [];
    {
      // Snapshot original rows BEFORE we mutate
      originalRolesForRestore = (await admin.from("document_package_item_role_assignments")
        .select("*").eq("package_session_id", SESSION_ID)).data ?? [];

      // Step 4a: write desired = [ROLE_A, ROLE_B] on ITEM_DOC1
      const r1 = await callAtomic({
        itemId: ITEM_DOC1,
        roles: [
          { role_catalog_id: ROLE_A, person_id: PERSON_ID, position: "stage3_proof_A" },
          { role_catalog_id: ROLE_B, person_id: PERSON_ID, position: "stage3_proof_B" },
        ],
      });
      const after4a = (await admin.from("document_package_item_role_assignments")
        .select("id,role_catalog_id,is_active,metadata")
        .eq("package_session_id", SESSION_ID).eq("package_template_item_id", ITEM_DOC1)
        .eq("is_active", true)).data ?? [];
      const activeRoleIds4a = after4a.map((r: any) => r.role_catalog_id).sort();
      const expected4a = [ROLE_A, ROLE_B].sort();

      // Step 4b: write desired = [ROLE_A only] → ROLE_B must be archived
      const r2 = await callAtomic({
        itemId: ITEM_DOC1,
        roles: [{ role_catalog_id: ROLE_A, person_id: PERSON_ID, position: "stage3_proof_A_only" }],
      });
      const after4b = (await admin.from("document_package_item_role_assignments")
        .select("id,role_catalog_id,is_active,metadata")
        .eq("package_session_id", SESSION_ID).eq("package_template_item_id", ITEM_DOC1)).data ?? [];
      const activeAfter4b = after4b.filter((r: any) => r.is_active);
      const archivedRoleB = after4b.some((r: any) => r.role_catalog_id === ROLE_B && !r.is_active);
      const otherItemUntouched = (await admin.from("document_package_item_role_assignments")
        .select("id").eq("package_session_id", SESSION_ID).neq("package_template_item_id", ITEM_DOC1)).data ?? [];

      const ok = !r1.error && !r2.error
        && JSON.stringify(activeRoleIds4a) === JSON.stringify(expected4a)
        && activeAfter4b.length === 1
        && activeAfter4b[0].role_catalog_id === ROLE_A
        && archivedRoleB;
      steps.push({ name: "S4.desired_state_delete", ok, details: {
        r1: r1.data, r2: r2.data,
        after4a_active: activeRoleIds4a,
        after4b_active_count: activeAfter4b.length,
        after4b_role_b_archived: archivedRoleB,
        other_item_rows_present: otherItemUntouched.length,
      }});
    }

    // --- Scenario 5: concurrent 5×parallel (different payloads, same item) ---
    {
      const auditBefore = (await admin.from("audit_logs").select("*", { count: "exact", head: true })
        .eq("action", "package_document_atomic_save").eq("resource_id", SESSION_ID)).count ?? 0;

      // Each call uses a DIFFERENT position marker so we can identify which payload "won"
      const payloads = [0, 1, 2, 3, 4].map((i) => ({
        marker: `concurrent_payload_${i}`,
        roles: [
          { role_catalog_id: ROLE_A, person_id: PERSON_ID, position: `concurrent_payload_${i}_A` },
          { role_catalog_id: ROLE_B, person_id: PERSON_ID, position: `concurrent_payload_${i}_B` },
        ],
      }));
      const t0 = performance.now();
      const results = await Promise.all(
        payloads.map((p) => callAtomic({ itemId: ITEM_DOC1, roles: p.roles })),
      );
      const elapsed_ms = Math.round(performance.now() - t0);
      const errors = results.map((r) => r.error?.message ?? null);
      const successCount = results.filter((r) => !r.error).length;

      // Verify uniqueness post-state
      const post = (await admin.from("document_package_item_role_assignments")
        .select("id,role_catalog_id,person_id,is_active,metadata")
        .eq("package_session_id", SESSION_ID).eq("package_template_item_id", ITEM_DOC1)).data ?? [];
      const activeRows = post.filter((r: any) => r.is_active);
      // Each (role_catalog_id, person_id) must appear at most once active
      const keyCounts: Record<string, number> = {};
      for (const r of activeRows) {
        const k = `${r.role_catalog_id}|${r.person_id}`;
        keyCounts[k] = (keyCounts[k] ?? 0) + 1;
      }
      const duplicateKeys = Object.entries(keyCounts).filter(([, c]) => c > 1);
      const markersOnActive = activeRows.map((r: any) => r.metadata?.position).filter(Boolean);
      // Coherence: both active markers must come from the SAME payload index
      const indices = new Set(markersOnActive.map((m: string) => m.match(/concurrent_payload_(\d)/)?.[1]));
      const coherent = indices.size === 1;

      const auditAfter = (await admin.from("audit_logs").select("*", { count: "exact", head: true })
        .eq("action", "package_document_atomic_save").eq("resource_id", SESSION_ID)).count ?? 0;
      const auditDelta = auditAfter - auditBefore;

      const ok = duplicateKeys.length === 0 && coherent && auditDelta === successCount && successCount >= 1;
      steps.push({ name: "S5.concurrent_5_parallel", ok, details: {
        elapsed_ms,
        success_count: successCount,
        errors,
        active_row_count: activeRows.length,
        duplicate_keys: duplicateKeys,
        winning_payload_indices: [...indices],
        audit_delta: auditDelta,
        coherent,
      }});
    }

    // --- Cleanup: restore original role state ---
    await restoreRoles(originalRolesForRestore);
    const post = await snapshotState();
    steps.push({ name: "snapshot.post_cleanup", ok: true, details: {
      audit_post: post.auditPre,
      roles_post: (post.rolesPre ?? []).length,
      values_post: (post.valsPre ?? []).length,
    }});

    const allPass = steps.filter((s) => !s.name.startsWith("snapshot")).every((s) => s.ok);
    return new Response(JSON.stringify({ all_pass: allPass, steps }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ fatal: true, error: String(e), steps }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } });
  }
});
