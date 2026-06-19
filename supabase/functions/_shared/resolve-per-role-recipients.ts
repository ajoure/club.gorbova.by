// PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 — Stage B
//
// Read-only shared resolver: для item с `generation_mode='per_role_person'`
// возвращает детерминированный, упорядоченный, обогащённый recipient-контекстом
// список получателей. Никаких side-effects (нет INSERT/UPDATE/DELETE, нет audit,
// нет вызовов генератора). Единственный SoT, который позже будут использовать
// Stage C (генератор) и Stage D (retro-sync).
//
// Источник назначений — ТОЛЬКО `document_package_item_role_assignments`
// (item-scope, Stage 5 PASS-контракт `save_session_document_atomic`).
// `document_package_session_participants` НЕ используется — это session-level.
//
// Контракт «никаких throw»: при любой ошибке возвращается структурный status.

// deno-lint-ignore no-explicit-any
type Supa = any;

export type PerRoleRecipientStatus =
  | "ok"
  | "single_mode"
  | "role_not_configured"
  | "role_inactive"
  | "role_package_mismatch"
  | "no_active_assignments"
  | "session_not_found"
  | "item_not_found"
  | "item_outside_session_package"
  | "resolver_error";

export interface PerRoleRecipientPersonContext {
  full_name: string;
  short_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  position: string | null;
}

export interface PerRoleRecipient {
  assignment_id: string;
  role_catalog_id: string;
  role_key: string;
  role_label: string;
  person_id: string;
  sort_order: number; // нормализованный (NULL → Number.MAX_SAFE_INTEGER)
  recipient: PerRoleRecipientPersonContext;
}

export interface PerRoleRecipientsResult {
  mode: "single" | "per_role_person" | "unknown";
  status: PerRoleRecipientStatus;
  session_id: string;
  item_id: string;
  package_template_id: string | null;
  repeat_role_catalog_id: string | null;
  recipients: PerRoleRecipient[];
  reasons: string[];
}

function buildShortName(full: string | null | undefined): string | null {
  if (!full) return null;
  const parts = String(full).trim().split(/\s+/);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const [last, first, mid] = parts;
  const initials = [first?.[0], mid?.[0]].filter(Boolean).map((c) => `${c}.`).join("");
  return initials ? `${last} ${initials}` : last;
}

function buildAddress(structured: unknown): string | null {
  if (!structured || typeof structured !== "object") return null;
  const s = structured as Record<string, unknown>;
  const order = ["postal_code", "country", "region", "district", "city", "street", "house", "building", "apartment"];
  const parts: string[] = [];
  for (const k of order) {
    const v = s[k];
    if (v != null && String(v).trim() !== "") parts.push(String(v).trim());
  }
  if (parts.length > 0) return parts.join(", ");
  const flat = (s as { full?: unknown }).full;
  return typeof flat === "string" && flat.trim() ? flat.trim() : null;
}

function normSortOrder(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return Number.MAX_SAFE_INTEGER;
}

export async function resolvePerRoleRecipients(
  supabase: Supa,
  params: { session_id: string; item_id: string },
): Promise<PerRoleRecipientsResult> {
  const { session_id, item_id } = params;
  const reasons: string[] = [];
  const base: PerRoleRecipientsResult = {
    mode: "unknown",
    status: "resolver_error",
    session_id,
    item_id,
    package_template_id: null,
    repeat_role_catalog_id: null,
    recipients: [],
    reasons,
  };

  // 1) session
  let sessionPkg: string | null = null;
  try {
    const { data, error } = await supabase
      .from("document_package_sessions")
      .select("id, package_template_id")
      .eq("id", session_id)
      .maybeSingle();
    if (error) {
      reasons.push(`session_query_error:${error.message ?? "unknown"}`);
      return { ...base, status: "resolver_error" };
    }
    if (!data) return { ...base, status: "session_not_found" };
    sessionPkg = data.package_template_id ?? null;
  } catch (e) {
    reasons.push(`session_exception:${(e as Error)?.message ?? "unknown"}`);
    return { ...base, status: "resolver_error" };
  }

  // 2) item
  let itemRow: {
    id: string;
    package_template_id: string;
    generation_mode: string | null;
    repeat_role_catalog_id: string | null;
  } | null = null;
  try {
    const { data, error } = await supabase
      .from("document_package_template_items")
      .select("id, package_template_id, generation_mode, repeat_role_catalog_id")
      .eq("id", item_id)
      .maybeSingle();
    if (error) {
      reasons.push(`item_query_error:${error.message ?? "unknown"}`);
      return { ...base, status: "resolver_error" };
    }
    if (!data) return { ...base, status: "item_not_found" };
    itemRow = data;
  } catch (e) {
    reasons.push(`item_exception:${(e as Error)?.message ?? "unknown"}`);
    return { ...base, status: "resolver_error" };
  }

  const itemPkg = itemRow!.package_template_id;
  const mode = (itemRow!.generation_mode ?? "single") as "single" | "per_role_person";
  const repeatRoleId = itemRow!.repeat_role_catalog_id ?? null;

  // 3) session ↔ item binding
  if (sessionPkg && itemPkg && sessionPkg !== itemPkg) {
    return {
      ...base,
      mode,
      status: "item_outside_session_package",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }

  // 4) single
  if (mode === "single") {
    return {
      ...base,
      mode: "single",
      status: "single_mode",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }

  // 5) per_role_person — role configured?
  if (!repeatRoleId) {
    return {
      ...base,
      mode: "per_role_person",
      status: "role_not_configured",
      package_template_id: itemPkg,
      repeat_role_catalog_id: null,
    };
  }

  // 6) role row
  let role: {
    id: string;
    package_template_id: string;
    role_key: string;
    label: string;
    is_active: boolean;
  } | null = null;
  try {
    const { data, error } = await supabase
      .from("document_package_role_catalog")
      .select("id, package_template_id, role_key, label, is_active")
      .eq("id", repeatRoleId)
      .maybeSingle();
    if (error) {
      reasons.push(`role_query_error:${error.message ?? "unknown"}`);
      return {
        ...base,
        mode: "per_role_person",
        status: "resolver_error",
        package_template_id: itemPkg,
        repeat_role_catalog_id: repeatRoleId,
      };
    }
    if (!data) {
      reasons.push("role_not_found_in_catalog");
      return {
        ...base,
        mode: "per_role_person",
        status: "role_package_mismatch",
        package_template_id: itemPkg,
        repeat_role_catalog_id: repeatRoleId,
      };
    }
    role = data;
  } catch (e) {
    reasons.push(`role_exception:${(e as Error)?.message ?? "unknown"}`);
    return {
      ...base,
      mode: "per_role_person",
      status: "resolver_error",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }

  if (role!.package_template_id !== itemPkg) {
    return {
      ...base,
      mode: "per_role_person",
      status: "role_package_mismatch",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }
  if (!role!.is_active) {
    return {
      ...base,
      mode: "per_role_person",
      status: "role_inactive",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }

  // 7) assignments
  let assignments: Array<{
    id: string;
    role_catalog_id: string;
    person_id: string | null;
    sort_order: number | null;
    metadata: Record<string, unknown> | null;
    is_active: boolean;
  }> = [];
  try {
    const { data, error } = await supabase
      .from("document_package_item_role_assignments")
      .select("id, role_catalog_id, person_id, sort_order, metadata, is_active")
      .eq("package_session_id", session_id)
      .eq("package_template_item_id", item_id)
      .eq("role_catalog_id", repeatRoleId)
      .eq("is_active", true);
    if (error) {
      reasons.push(`assignments_query_error:${error.message ?? "unknown"}`);
      return {
        ...base,
        mode: "per_role_person",
        status: "resolver_error",
        package_template_id: itemPkg,
        repeat_role_catalog_id: repeatRoleId,
      };
    }
    assignments = Array.isArray(data) ? data : [];
  } catch (e) {
    reasons.push(`assignments_exception:${(e as Error)?.message ?? "unknown"}`);
    return {
      ...base,
      mode: "per_role_person",
      status: "resolver_error",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }

  // 8) filter non-person + dedup + sort
  const withPerson: typeof assignments = [];
  for (const a of assignments) {
    if (!a.person_id) {
      reasons.push(`non_person_assignment_skipped:${a.id}`);
      continue;
    }
    withPerson.push(a);
  }

  withPerson.sort((x, y) => {
    const sx = normSortOrder(x.sort_order);
    const sy = normSortOrder(y.sort_order);
    if (sx !== sy) return sx - sy;
    if (x.person_id! < y.person_id!) return -1;
    if (x.person_id! > y.person_id!) return 1;
    if (x.id < y.id) return -1;
    if (x.id > y.id) return 1;
    return 0;
  });

  const seenPerson = new Set<string>();
  const deduped: typeof assignments = [];
  for (const a of withPerson) {
    if (seenPerson.has(a.person_id!)) {
      reasons.push(`duplicate_person_skipped:${a.person_id}:assignment:${a.id}`);
      continue;
    }
    seenPerson.add(a.person_id!);
    deduped.push(a);
  }

  if (deduped.length === 0) {
    return {
      ...base,
      mode: "per_role_person",
      status: "no_active_assignments",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }

  // 9) load persons
  const personIds = deduped.map((a) => a.person_id!);
  let personById = new Map<string, {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    address_structured: unknown;
  }>();
  try {
    const { data, error } = await supabase
      .from("legal_details_persons")
      .select("id, full_name, email, phone, address_structured")
      .in("id", personIds);
    if (error) {
      reasons.push(`persons_query_error:${error.message ?? "unknown"}`);
      return {
        ...base,
        mode: "per_role_person",
        status: "resolver_error",
        package_template_id: itemPkg,
        repeat_role_catalog_id: repeatRoleId,
      };
    }
    for (const p of (data ?? []) as Array<{ id: string } & Record<string, unknown>>) {
      personById.set(p.id, p as never);
    }
  } catch (e) {
    reasons.push(`persons_exception:${(e as Error)?.message ?? "unknown"}`);
    return {
      ...base,
      mode: "per_role_person",
      status: "resolver_error",
      package_template_id: itemPkg,
      repeat_role_catalog_id: repeatRoleId,
    };
  }

  const recipients: PerRoleRecipient[] = deduped.map((a) => {
    const p = personById.get(a.person_id!);
    const full = (p?.full_name ?? "").trim();
    const positionRaw = (a.metadata as Record<string, unknown> | null)?.position;
    const position = typeof positionRaw === "string" && positionRaw.trim() ? positionRaw.trim() : null;
    return {
      assignment_id: a.id,
      role_catalog_id: a.role_catalog_id,
      role_key: role!.role_key,
      role_label: role!.label,
      person_id: a.person_id!,
      sort_order: normSortOrder(a.sort_order),
      recipient: {
        full_name: full,
        short_name: buildShortName(full),
        email: (p?.email as string | null) ?? null,
        phone: (p?.phone as string | null) ?? null,
        address: buildAddress(p?.address_structured),
        position,
      },
    };
  });

  return {
    mode: "per_role_person",
    status: "ok",
    session_id,
    item_id,
    package_template_id: itemPkg,
    repeat_role_catalog_id: repeatRoleId,
    recipients,
    reasons,
  };
}
