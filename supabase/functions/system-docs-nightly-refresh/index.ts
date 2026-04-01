import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BLUEPRINTS,
  SECTION_ORDER,
  SCAFFOLD_SIGNATURES,
  SEED_REPAIR_EXCLUDED_DOMAINS,
  type DomainBlueprint,
} from "../_shared/system_docs_blueprint.ts";

/**
 * system-docs-nightly-refresh — Unified document generator.
 *
 * Modes:
 *   source='manual'       → mode='auto_current'
 *   source='cron-hourly'  → mode='auto_current'
 *   source='seed'         → mode='manual_baseline' + repair pipeline
 *
 * All count queries use universal safeCount (no dependency on 'id' column).
 * Column names match real schema (discovery-verified).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_DOC_DOMAINS = [
  { key: "platform_master", title: "Архитектура платформы" },
  { key: "products_sales", title: "Продукты и тарифы" },
  { key: "sites_pages_forms", title: "Сайты и формы" },
  { key: "trainings_access", title: "Тренинги и доступы" },
  { key: "orders_payments", title: "Сделки и платежи" },
  { key: "integrations", title: "Интеграции" },
  { key: "open_tails", title: "Открытые хвосты" },
];

const MAX_DOC_SIZE = 100 * 1024;
const LIST_LIMIT = 30; // top-N for live lists

// ─── Structured warning type ───────────────────────────────────────
interface StructuredWarning {
  type: string;
  domain?: string;
  table?: string;
  column?: string;
  message: string;
}

// ─── Universal safe helpers (no dependency on PK name) ─────────────
async function safeCount(
  supabase: any,
  table: string,
  filter?: { col: string; val: any },
  domain?: string,
  warnings?: StructuredWarning[]
): Promise<number> {
  try {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) q = q.eq(filter.col, filter.val);
    const { count, error } = await q;
    if (error) {
      console.warn(`safeCount(${table}): ${error.message}`);
      warnings?.push({
        type: "schema_mismatch",
        domain: domain || "unknown",
        table,
        column: filter?.col,
        message: error.message,
      });
      return 0;
    }
    return count || 0;
  } catch (e) {
    console.warn(`safeCount(${table}) exception: ${e.message}`);
    return 0;
  }
}

async function safeSelect(
  supabase: any,
  table: string,
  columns: string,
  opts?: {
    filter?: { col: string; val: any };
    limit?: number;
    order?: { col: string; asc: boolean };
  },
  domain?: string,
  warnings?: StructuredWarning[]
): Promise<any[]> {
  try {
    let q = supabase.from(table).select(columns);
    if (opts?.filter) q = q.eq(opts.filter.col, opts.filter.val);
    if (opts?.order) q = q.order(opts.order.col, { ascending: opts.order.asc });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) {
      console.warn(`safeSelect(${table}): ${error.message}`);
      warnings?.push({
        type: "schema_mismatch",
        domain: domain || "unknown",
        table,
        message: error.message,
      });
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn(`safeSelect(${table}) exception: ${e.message}`);
    return [];
  }
}

// ─── Placeholder detection ─────────────────────────────────────────
function isPlaceholderDoc(doc: any): boolean {
  const content = doc.content_text || "";
  const meta = doc.meta || {};
  // Must match multiple scaffold signatures, not just one occurrence
  let matchCount = 0;
  for (const sig of SCAFFOLD_SIGNATURES) {
    if (content.includes(sig)) matchCount++;
  }
  return matchCount >= 2 && meta.source === "seed";
}

function hasManualEdits(doc: any): boolean {
  // If updated_by differs from created_by, someone edited it
  if (doc.updated_by && doc.created_by && doc.updated_by !== doc.created_by)
    return true;
  // If updated_at is significantly after created_at (>5 min), likely edited
  if (doc.updated_at && doc.created_at) {
    const diff =
      new Date(doc.updated_at).getTime() - new Date(doc.created_at).getTime();
    if (diff > 5 * 60 * 1000) return true;
  }
  return false;
}

// ─── Next version label calculator ─────────────────────────────────
function nextVersionLabel(existingLabels: string[]): string {
  // Extract letter indices from POINT A, POINT B, etc.
  const letters = existingLabels
    .filter((l) => l.startsWith("POINT "))
    .map((l) => l.replace("POINT ", ""))
    .filter((l) => l.length === 1 && l >= "A" && l <= "Z")
    .map((l) => l.charCodeAt(0) - 64); // A=1, B=2, ...
  const maxIdx = letters.length > 0 ? Math.max(...letters) : 0;
  return `POINT ${String.fromCharCode(65 + maxIdx)}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const source: string = body.source || "cron-hourly";
    const now = new Date();

    // ── Extract caller from JWT ──
    let callerUserId: string | null = null;
    if (source === "manual" || source === "seed") {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user: callerUser },
        } = await userClient.auth.getUser();
        if (callerUser?.id) callerUserId = callerUser.id;
      }
    }

    const isManual = source === "manual" || source === "seed";
    const actorType = isManual ? "user" : "system";
    const actorUserId = isManual ? callerUserId : null;
    const actorLabel = isManual
      ? "admin_system_docs"
      : "system_docs_nightly_refresh";

    // ── Guard: cron-hourly only at 03:00 Europe/London ──
    if (source === "cron-hourly") {
      const londonHour = parseInt(
        now.toLocaleString("en-GB", {
          hour: "2-digit",
          hour12: false,
          timeZone: "Europe/London",
        })
      );
      if (londonHour !== 3) {
        return new Response(
          JSON.stringify({ skipped: true, reason: `hour=${londonHour}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Batch key for idempotency ──
    const londonDate = now.toLocaleDateString("en-CA", {
      timeZone: "Europe/London",
    });
    const batchKey = `system_docs_refresh_${londonDate.replace(/-/g, "_")}_europe_london`;

    if (source === "cron-hourly") {
      const { data: existing } = await supabase
        .from("audit_logs")
        .select("id")
        .eq("action", "system_docs.nightly_refresh_completed")
        .contains("meta", { batch_id: batchKey })
        .limit(1);
      if (existing && existing.length > 0) {
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: "already_completed",
            batchKey,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Audit start ──
    const auditAction =
      source === "seed"
        ? "system_docs.seed_started"
        : source === "manual"
        ? "system_docs.manual_refresh_started"
        : "system_docs.nightly_refresh_started";
    await supabase.from("audit_logs").insert({
      action: auditAction,
      actor_type: actorType,
      actor_user_id: actorUserId,
      actor_label: actorLabel,
      meta: { batch_id: batchKey, source },
    });

    const snapshotAt = now.toISOString();
    const since24h = new Date(
      now.getTime() - 24 * 60 * 60 * 1000
    ).toISOString();
    const allWarnings: StructuredWarning[] = [];
    let updatedCount = 0;

    // ── Collect recent audit for changes block ──
    const recentAudit = await safeSelect(
      supabase,
      "audit_logs",
      "action, meta, created_at",
      { limit: 100, order: { col: "created_at", asc: false } }
    );
    const filteredAudit = recentAudit.filter(
      (a: any) => a.created_at >= since24h
    );
    const changesSummary = filteredAudit
      .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
      .map((a: any) => `- ${a.created_at.substring(0, 16)} | ${a.action}`)
      .join("\n");

    // ── SEED MODE ──
    if (source === "seed") {
      const seedResult = await handleSeedMode(
        supabase,
        snapshotAt,
        changesSummary,
        since24h,
        callerUserId,
        allWarnings
      );

      // Also update AUTO-CURRENT for all domains
      for (const domain of SYSTEM_DOC_DOMAINS) {
        try {
          const content = await buildDomainDocument(
            supabase,
            domain.key,
            "auto_current",
            snapshotAt,
            changesSummary,
            since24h,
            allWarnings
          );
          await upsertAutoCurrentDoc(
            supabase,
            domain.key,
            domain.title,
            content,
            snapshotAt,
            batchKey,
            source,
            allWarnings
          );
          updatedCount++;
        } catch (e) {
          allWarnings.push({
            type: "build_error",
            domain: domain.key,
            message: e.message,
          });
        }
      }

      await supabase.from("audit_logs").insert({
        action: "system_docs.seed_completed",
        actor_type: actorType,
        actor_user_id: actorUserId,
        actor_label: actorLabel,
        meta: {
          batch_id: batchKey,
          ...seedResult,
          auto_updated: updatedCount,
          warnings: allWarnings,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          batchKey,
          ...seedResult,
          auto_updated: updatedCount,
          warnings: allWarnings,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── AUTO_CURRENT MODE (manual / cron-hourly) ──
    for (const domain of SYSTEM_DOC_DOMAINS) {
      try {
        const content = await buildDomainDocument(
          supabase,
          domain.key,
          "auto_current",
          snapshotAt,
          changesSummary,
          since24h,
          allWarnings
        );
        await upsertAutoCurrentDoc(
          supabase,
          domain.key,
          domain.title,
          content,
          snapshotAt,
          batchKey,
          source,
          allWarnings
        );
        updatedCount++;
      } catch (e) {
        console.error(`Error building ${domain.key}:`, e);
        allWarnings.push({
          type: "build_error",
          domain: domain.key,
          message: e.message,
        });
      }
    }

    const completedAction =
      source === "manual"
        ? "system_docs.manual_refresh_completed"
        : "system_docs.nightly_refresh_completed";
    await supabase.from("audit_logs").insert({
      action: completedAction,
      actor_type: actorType,
      actor_user_id: actorUserId,
      actor_label: actorLabel,
      meta: {
        batch_id: batchKey,
        updated_count: updatedCount,
        warnings: allWarnings,
        source,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        batchKey,
        updatedCount,
        warnings: allWarnings,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Refresh error:", error);
    try {
      await supabase.from("audit_logs").insert({
        action: "system_docs.nightly_refresh_failed",
        actor_type: "system",
        actor_user_id: null,
        actor_label: "system_docs_nightly_refresh",
        meta: { error: error.message },
      });
    } catch (_) {}
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── SEED / REPAIR MODE ────────────────────────────────────────────

interface SeedResult {
  created_domains: string[];
  repaired_domains: string[];
  skipped_domains: string[];
  manual_review_domains: string[];
  manual_review_docs: any[];
  repair_mapping: {
    old_doc_id: string;
    old_version_label: string;
    new_doc_id: string;
    new_version_label: string;
  }[];
}

async function handleSeedMode(
  supabase: any,
  snapshotAt: string,
  changesSummary: string,
  since24h: string,
  callerUserId: string | null,
  warnings: StructuredWarning[]
): Promise<SeedResult> {
  const result: SeedResult = {
    created_domains: [],
    repaired_domains: [],
    skipped_domains: [],
    manual_review_domains: [],
    manual_review_docs: [],
    repair_mapping: [],
  };

  // Fetch all existing manual docs
  const { data: allDocs } = await supabase
    .from("admin_docs")
    .select("*")
    .order("created_at", { ascending: true });
  const docs = (allDocs || []) as any[];

  for (const domain of SYSTEM_DOC_DOMAINS) {
    // ── STOP-guard: products_sales ──
    if (SEED_REPAIR_EXCLUDED_DOMAINS.includes(domain.key)) {
      result.skipped_domains.push(domain.key);
      warnings.push({
        type: "guard_skip",
        domain: domain.key,
        message: "manual history is read-only",
      });
      continue;
    }

    const domainDocs = docs.filter(
      (d: any) =>
        d.section_key === domain.key && d.version_label !== "AUTO-CURRENT"
    );

    if (domainDocs.length === 0) {
      // No manual docs → create POINT A
      try {
        const content = await buildDomainDocument(
          supabase,
          domain.key,
          "manual_baseline",
          snapshotAt,
          "",
          since24h,
          warnings
        );
        const { data: inserted, error } = await supabase
          .from("admin_docs")
          .insert({
            section_key: domain.key,
            version_label: "POINT A",
            status: "active",
            content_text: content,
            meta: { source: "seed", managed_by: "manual" },
            created_by: callerUserId,
            updated_by: callerUserId,
          })
          .select("id")
          .single();

        if (error) {
          warnings.push({
            type: "seed_error",
            domain: domain.key,
            message: error.message,
          });
        } else {
          result.created_domains.push(domain.key);
        }
      } catch (e) {
        warnings.push({
          type: "seed_error",
          domain: domain.key,
          message: e.message,
        });
      }
      continue;
    }

    // Has manual docs → check for placeholder repair
    const activeDocs = domainDocs.filter((d: any) => d.status === "active");
    const placeholderDoc = activeDocs.find((d: any) => isPlaceholderDoc(d));

    if (!placeholderDoc) {
      result.skipped_domains.push(domain.key);
      continue;
    }

    // Check for manual edits
    if (hasManualEdits(placeholderDoc)) {
      result.manual_review_domains.push(domain.key);
      result.manual_review_docs.push({
        id: placeholderDoc.id,
        section_key: domain.key,
        version_label: placeholderDoc.version_label,
        reason: "placeholder with manual edits detected",
      });
      warnings.push({
        type: "manual_review",
        domain: domain.key,
        message: `Doc ${placeholderDoc.version_label} is placeholder but has manual edits — skipping repair`,
      });
      continue;
    }

    // Safe to repair: archive old, create new
    try {
      // Archive placeholder
      await supabase
        .from("admin_docs")
        .update({
          status: "archived",
          updated_by: callerUserId,
        })
        .eq("id", placeholderDoc.id);

      // Calculate next version label
      const existingLabels = domainDocs.map((d: any) => d.version_label);
      const newLabel = nextVersionLabel(existingLabels);

      const content = await buildDomainDocument(
        supabase,
        domain.key,
        "manual_baseline",
        snapshotAt,
        "",
        since24h,
        warnings
      );

      const { data: newDoc, error } = await supabase
        .from("admin_docs")
        .insert({
          section_key: domain.key,
          version_label: newLabel,
          status: "active",
          content_text: content,
          meta: { source: "seed", managed_by: "manual" },
          created_by: callerUserId,
          updated_by: callerUserId,
        })
        .select("id")
        .single();

      if (error) {
        warnings.push({
          type: "repair_error",
          domain: domain.key,
          message: error.message,
        });
      } else {
        result.repaired_domains.push(domain.key);
        result.repair_mapping.push({
          old_doc_id: placeholderDoc.id,
          old_version_label: placeholderDoc.version_label,
          new_doc_id: newDoc?.id || "unknown",
          new_version_label: newLabel,
        });
      }
    } catch (e) {
      warnings.push({
        type: "repair_error",
        domain: domain.key,
        message: e.message,
      });
    }
  }

  return result;
}

// ─── UPSERT AUTO-CURRENT ──────────────────────────────────────────

async function upsertAutoCurrentDoc(
  supabase: any,
  domainKey: string,
  title: string,
  content: string,
  snapshotAt: string,
  batchKey: string,
  source: string,
  warnings: StructuredWarning[]
) {
  let truncated = false;
  const fullSize = content.length;
  if (content.length > MAX_DOC_SIZE) {
    content =
      content.substring(0, MAX_DOC_SIZE) +
      "\n\n... усечено, полная версия превышает 100KB";
    truncated = true;
    warnings.push({
      type: "truncated",
      domain: domainKey,
      message: `full_size=${fullSize}`,
    });
  }

  const meta = {
    title,
    domain_key: domainKey,
    source:
      source === "manual" || source === "seed"
        ? "manual_refresh"
        : "nightly_discovery_snapshot",
    snapshot_at: snapshotAt,
    snapshot_tz: "Europe/London",
    batch_id: batchKey,
    managed_by: "system",
    tags: [
      "auto",
      source === "manual" || source === "seed" ? "manual" : "nightly",
      "snapshot",
    ],
    ...(truncated ? { truncated: true, full_size_bytes: fullSize } : {}),
  };

  const { data: existing } = await supabase
    .from("admin_docs")
    .select("id")
    .eq("section_key", domainKey)
    .eq("version_label", "AUTO-CURRENT")
    .limit(2);

  const existingDocs = existing || [];

  if (existingDocs.length > 1) {
    warnings.push({
      type: "duplicate_auto",
      domain: domainKey,
      message: `${existingDocs.length} AUTO-CURRENT records`,
    });
    return;
  }

  if (existingDocs.length === 1) {
    await supabase
      .from("admin_docs")
      .update({ content_text: content, meta, updated_at: snapshotAt })
      .eq("id", existingDocs[0].id);
  } else {
    await supabase.from("admin_docs").insert({
      section_key: domainKey,
      version_label: "AUTO-CURRENT",
      status: "active",
      content_text: content,
      meta,
    });
  }
}

// ─── UNIFIED DOCUMENT BUILDER ─────────────────────────────────────

async function buildDomainDocument(
  supabase: any,
  domainKey: string,
  mode: "auto_current" | "manual_baseline",
  snapshotAt: string,
  changesSummary: string,
  since24h: string,
  warnings: StructuredWarning[]
): Promise<string> {
  const bp = BLUEPRINTS[domainKey];
  if (!bp) return `Документ\n===\n\nНет blueprint для домена: ${domainKey}`;

  const sections: string[] = [];

  // 0. Назначение
  sections.push(`${SECTION_ORDER[0]}\n\n${bp.purpose}`);

  // 1. SoT
  const sotLines = bp.sotTables
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `- ${t.name} — ${t.role}`)
    .join("\n");
  sections.push(`${SECTION_ORDER[1]}\n\n${sotLines}`);

  // 2. Таблицы и связи
  const relLines =
    bp.relatedTables.length > 0
      ? `\nСвязанные таблицы: ${bp.relatedTables.sort().join(", ")}`
      : "";
  const cdLinks = bp.crossDomainLinks
    .map((l) => `- ${l}`)
    .join("\n");
  sections.push(
    `${SECTION_ORDER[2]}${relLines}\n\nCross-domain связи:\n${cdLinks || "(нет)"}`
  );

  // 3. Ключевые потоки
  const flowLines = bp.flows
    .map(
      (f) =>
        `### ${f.name}\n${f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    )
    .join("\n\n");
  sections.push(`${SECTION_ORDER[3]}\n\n${flowLines || "(нет потоков)"}`);

  // 4. Edge Functions
  const efLines = bp.edgeFunctions
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ef) => `- ${ef.name} — ${ef.role}`)
    .join("\n");
  sections.push(`${SECTION_ORDER[4]}\n\n${efLines || "(нет)"}`);

  // 5. UI / маршруты
  const uiLines = bp.uiRoutes
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((r) => `- ${r.path} — ${r.description}`)
    .join("\n");
  sections.push(`${SECTION_ORDER[5]}\n\n${uiLines || "(нет)"}`);

  // 6. Legacy / deprecated
  const legacyLines =
    bp.legacyZones.length > 0
      ? bp.legacyZones.map((l) => `- ${l}`).join("\n")
      : "(нет)";
  sections.push(`${SECTION_ORDER[6]}\n\n${legacyLines}`);

  // 7. Текущее состояние (live snapshot)
  const liveSnapshot = await buildLiveSnapshot(
    supabase,
    domainKey,
    warnings
  );
  let section7 = `${SECTION_ORDER[7]}\n\nОбновлено: ${snapshotAt} (Europe/London)\n\n${liveSnapshot}`;
  if (mode === "auto_current" && changesSummary) {
    section7 += `\n\n### Изменения за последние 24 часа\n\n${changesSummary}`;
  }
  sections.push(section7);

  // 8. Открытые хвосты (4 sources)
  const openTails = await buildOpenTailsSection(
    supabase,
    domainKey,
    bp,
    since24h,
    warnings
  );
  sections.push(`${SECTION_ORDER[8]}\n\n${openTails}`);

  // Special: platform_master adds cross-domain map + evidence boundaries
  if (domainKey === "platform_master") {
    sections.push(
      `9. Cross-domain карта\n\n${bp.crossDomainLinks.map((l) => `- ${l}`).join("\n")}`
    );
    sections.push(
      `10. Границы доказанности\n\n` +
        `Подтверждено по БД (FK):\n` +
        `- products_v2 → tariffs → tariff_offers → orders_v2 → payments_v2 → entitlements\n` +
        `- training_lessons → training_modules, products_v2\n` +
        `- access_rules → products_v2, tariffs\n` +
        `- site_domain_bindings → site_pages (site_page_id FK)\n\n` +
        `Не подтверждено / hypothesis:\n` +
        `- site_domain_bindings ↔ products_v2 (нет прямого FK, связь через контент)\n` +
        `- Telegram clubs ↔ product_club_mappings ↔ subscriptions/access (требует проверки FK)\n`
    );
  }

  // Special: open_tails domain adds generator issues
  if (domainKey === "open_tails") {
    sections.push(
      `9. Проблемы самого генератора документации\n\n` +
        `- actor_user_id proof для manual refresh — pending UI proof\n` +
        `- proof seed/repair полноты snapshot — pending\n` +
        `- proof полноты live snapshot (не scaffold) — pending\n` +
        `- schema mismatch / truncation warnings последних batch — см. audit_logs\n` +
        `- build-proof — pending verification\n`
    );
  }

  // Assemble document
  const title =
    SYSTEM_DOC_DOMAINS.find((d) => d.key === domainKey)?.title || domainKey;
  const header = `${title}\n===`;
  const body = sections.map((s) => `\n===\n\n${s}`).join("\n");

  if (mode === "manual_baseline") {
    return `${header}\n\nСоздано seed: ${snapshotAt}${body}`;
  }
  return `${header}\n\nОбновлено автоматически: ${snapshotAt} (Europe/London)${body}`;
}

// ─── LIVE SNAPSHOT BUILDERS (per domain) ──────────────────────────

async function buildLiveSnapshot(
  supabase: any,
  domainKey: string,
  w: StructuredWarning[]
): Promise<string> {
  switch (domainKey) {
    case "platform_master":
      return await livePlatformMaster(supabase, w);
    case "products_sales":
      return await liveProductsSales(supabase, w);
    case "orders_payments":
      return await liveOrdersPayments(supabase, w);
    case "trainings_access":
      return await liveTrainingsAccess(supabase, w);
    case "sites_pages_forms":
      return await liveSitesPages(supabase, w);
    case "integrations":
      return await liveIntegrations(supabase, w);
    case "open_tails":
      return await liveOpenTails(supabase, w);
    default:
      return "(нет live-данных для этого домена)";
  }
}

async function livePlatformMaster(
  supabase: any,
  w: StructuredWarning[]
): Promise<string> {
  const d = "platform_master";
  const userCount = await safeCount(supabase, "profiles", undefined, d, w);
  const roleCount = await safeCount(supabase, "user_roles", undefined, d, w);
  const efCount = await safeCount(supabase, "edge_functions_registry", undefined, d, w);
  const auditCount = await safeCount(supabase, "audit_logs", undefined, d, w);
  const appSettingsCount = await safeCount(supabase, "app_settings", undefined, d, w);
  const adminMenuCount = await safeCount(supabase, "admin_menu_settings", undefined, d, w);

  // EF registry: real columns: name, enabled, category, tier, notes
  const efList = await safeSelect(
    supabase,
    "edge_functions_registry",
    "name, enabled, category, tier, notes",
    { limit: LIST_LIMIT, order: { col: "name", asc: true } },
    d,
    w
  );
  const efTotal = await safeCount(supabase, "edge_functions_registry", undefined, d, w);
  const efBlock =
    efList.length > 0
      ? efList
          .map(
            (ef: any) =>
              `  - ${ef.name} [${ef.enabled ? "enabled" : "disabled"}] ${ef.category || ""} ${ef.tier || ""} — ${ef.notes || "(без описания)"}`
          )
          .join("\n") +
        (efTotal > efList.length
          ? `\n  (показаны первые ${efList.length} из ${efTotal})`
          : "")
      : "  (нет записей в реестре)";

  return (
    `- Профилей: ${userCount}\n` +
    `- Записей user_roles: ${roleCount}\n` +
    `- Edge Functions в реестре: ${efCount}\n` +
    `- Записей audit_logs: ${auditCount}\n` +
    `- App Settings: ${appSettingsCount}\n` +
    `- Admin Menu Settings: ${adminMenuCount}\n\n` +
    `### Реестр Edge Functions (из edge_functions_registry)\n\n${efBlock}\n\n` +
    `### Доменные документы\n\n` +
    SYSTEM_DOC_DOMAINS.map((dd) => `- ${dd.key} — ${dd.title}`).join("\n") +
    `\n\n### Cron Runbook\n\n` +
    `- Регистрация: SELECT cron.schedule('system-docs-nightly-refresh', '0 * * * *', ...);\n` +
    `- Проверка: SELECT * FROM cron.job WHERE jobname = 'system-docs-nightly-refresh';\n` +
    `- Переустановка: SELECT cron.unschedule(...); затем повторный schedule\n` +
    `\n### Как устроена документация\n\n` +
    `- Хранилище: admin_docs (единственный SoT)\n` +
    `- Ручные версии: POINT A/B/C — через UI (active/draft/archived)\n` +
    `- AUTO-CURRENT: системная версия, nightly/manual refresh, meta.managed_by='system'\n` +
    `- Главный входной артефакт: platform_master AUTO-CURRENT\n` +
    `- Nightly refresh: 03:00 Europe/London, EF system-docs-nightly-refresh, idempotent\n` +
    `- Как использовать: /admin/docs → Архитектура платформы → Автообновление → Копировать`
  );
}

async function liveProductsSales(
  supabase: any,
  w: StructuredWarning[]
): Promise<string> {
  const d = "products_sales";
  const products = await safeSelect(
    supabase,
    "products_v2",
    "id, name, status",
    { limit: LIST_LIMIT, order: { col: "name", asc: true } },
    d,
    w
  );
  const productTotal = await safeCount(supabase, "products_v2", undefined, d, w);
  // tariffs: is_active, NOT status
  const tariffCount = await safeCount(supabase, "tariffs", undefined, d, w);
  const tariffActive = await safeCount(supabase, "tariffs", { col: "is_active", val: true }, d, w);
  const offerCount = await safeCount(supabase, "tariff_offers", undefined, d, w);
  const rulesCount = await safeCount(supabase, "access_rules", { col: "is_active", val: true }, d, w);
  const relationsCount = await safeCount(supabase, "product_relations", undefined, d, w);
  const mappingCount = await safeCount(supabase, "bepaid_product_mappings", undefined, d, w);

  const productList =
    products
      .map(
        (p: any) =>
          `  - ${p.name} [${p.status}] (${p.id.substring(0, 8)})`
      )
      .join("\n") +
    (productTotal > products.length
      ? `\n  (показаны первые ${products.length} из ${productTotal})`
      : "");

  // Tariffs with is_active
  const tariffs = await safeSelect(
    supabase,
    "tariffs",
    "id, name, product_id, is_active",
    { limit: LIST_LIMIT * 3, order: { col: "name", asc: true } },
    d,
    w
  );
  const tariffsByProduct: Record<string, any[]> = {};
  for (const t of tariffs) {
    const pid = t.product_id?.substring(0, 8) || "no-product";
    if (!tariffsByProduct[pid]) tariffsByProduct[pid] = [];
    tariffsByProduct[pid].push(t);
  }
  const tariffBlock = Object.entries(tariffsByProduct)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([pid, ts]) =>
        `  Продукт ${pid}:\n` +
        ts
          .map(
            (t: any) =>
              `    - ${t.name} [${t.is_active ? "active" : "inactive"}]`
          )
          .join("\n")
    )
    .join("\n");

  return (
    `- Продуктов: ${productTotal}\n` +
    `- Тарифов: ${tariffCount} (активных: ${tariffActive})\n` +
    `- Ценовых предложений (offers): ${offerCount}\n` +
    `- Активных правил доступа: ${rulesCount}\n` +
    `- Связей между продуктами: ${relationsCount}\n` +
    `- Маппингов на платёжные системы: ${mappingCount}\n\n` +
    `### Продукты\n\n${productList || "  (нет данных)"}\n\n` +
    `### Тарифы по продуктам\n\n${tariffBlock || "  (нет данных)"}`
  );
}

async function liveOrdersPayments(
  supabase: any,
  w: StructuredWarning[]
): Promise<string> {
  const d = "orders_payments";
  const orderCount = await safeCount(supabase, "orders_v2", undefined, d, w);
  const paidCount = await safeCount(supabase, "orders_v2", { col: "status", val: "paid" }, d, w);
  const pendingCount = await safeCount(supabase, "orders_v2", { col: "status", val: "pending" }, d, w);
  // FIXED: canceled (one l)
  const canceledCount = await safeCount(supabase, "orders_v2", { col: "status", val: "canceled" }, d, w);
  const paymentMethodsCount = await safeCount(supabase, "payment_methods", undefined, d, w);
  const installmentCount = await safeCount(supabase, "installment_payments", undefined, d, w);
  const bepaidRowsCount = await safeCount(supabase, "bepaid_statement_rows", undefined, d, w);
  const reconcileQueueCount = await safeCount(supabase, "payment_reconcile_queue", undefined, d, w);

  return (
    `- Всего заказов: ${orderCount}\n` +
    `- Оплаченных: ${paidCount}\n` +
    `- Ожидающих: ${pendingCount}\n` +
    `- Отменённых (canceled): ${canceledCount}\n` +
    `- Методов оплаты: ${paymentMethodsCount}\n` +
    `- Рассрочек: ${installmentCount}\n` +
    `- Строк банковских выписок: ${bepaidRowsCount}\n` +
    `- В очереди сверки: ${reconcileQueueCount}`
  );
}

async function liveTrainingsAccess(
  supabase: any,
  w: StructuredWarning[]
): Promise<string> {
  const d = "trainings_access";
  const moduleCount = await safeCount(supabase, "training_modules", undefined, d, w);
  const lessonCount = await safeCount(supabase, "training_lessons", undefined, d, w);
  const entitlementCount = await safeCount(supabase, "entitlements", { col: "status", val: "active" }, d, w);
  const subCount = await safeCount(supabase, "subscriptions_v2", undefined, d, w);
  const lessonProgressCount = await safeCount(supabase, "lesson_progress", undefined, d, w);
  const accessRulesCount = await safeCount(supabase, "access_rules", { col: "is_active", val: true }, d, w);

  // FIXED: is_active instead of status
  const modules = await safeSelect(
    supabase,
    "training_modules",
    "id, title, is_active",
    { limit: LIST_LIMIT, order: { col: "title", asc: true } },
    d,
    w
  );
  const moduleTotal = await safeCount(supabase, "training_modules", undefined, d, w);
  const moduleList =
    modules
      .map(
        (m: any) =>
          `  - ${m.title} [${m.is_active ? "active" : "inactive"}]`
      )
      .join("\n") +
    (moduleTotal > modules.length
      ? `\n  (показаны первые ${modules.length} из ${moduleTotal})`
      : "");

  return (
    `- Модулей: ${moduleCount}\n` +
    `- Уроков: ${lessonCount}\n` +
    `- Активных entitlements: ${entitlementCount}\n` +
    `- Подписок: ${subCount}\n` +
    `- Записей lesson_progress: ${lessonProgressCount}\n` +
    `- Активных access_rules: ${accessRulesCount}\n\n` +
    `### Модули\n\n${moduleList || "  (нет данных)"}`
  );
}

async function liveSitesPages(
  supabase: any,
  w: StructuredWarning[]
): Promise<string> {
  const d = "sites_pages_forms";
  const pageCount = await safeCount(supabase, "site_pages", undefined, d, w);
  const formSubmCount = await safeCount(supabase, "site_form_submissions", undefined, d, w);
  const domainBindingsCount = await safeCount(supabase, "site_domain_bindings", undefined, d, w);
  const pageFoldersCount = await safeCount(supabase, "site_page_folders", undefined, d, w);

  const pages = await safeSelect(
    supabase,
    "site_pages",
    "id, title, slug, status",
    { limit: LIST_LIMIT, order: { col: "title", asc: true } },
    d,
    w
  );

  const pageList =
    pages
      .map(
        (p: any) =>
          `  - ${p.title || "(без названия)"} [${p.status || "n/a"}] /${p.slug || ""}`
      )
      .join("\n") +
    (pageCount > pages.length
      ? `\n  (показаны первые ${pages.length} из ${pageCount})`
      : "");

  // FIXED: site_page_id, is_primary, is_home (no product_id, no is_active)
  const bindings = await safeSelect(
    supabase,
    "site_domain_bindings",
    "id, domain, site_page_id, is_primary, is_home",
    { limit: LIST_LIMIT },
    d,
    w
  );
  const bindingList =
    bindings
      .map(
        (b: any) =>
          `  - ${b.domain} → page:${b.site_page_id?.substring(0, 8) || "?"} [primary:${b.is_primary}, home:${b.is_home}]`
      )
      .join("\n") || "  (нет данных)";

  return (
    `- Страниц: ${pageCount}\n` +
    `- Отправок форм: ${formSubmCount}\n` +
    `- Привязок доменов: ${domainBindingsCount}\n` +
    `- Папок: ${pageFoldersCount}\n\n` +
    `### Страницы\n\n${pageList || "  (нет данных)"}\n\n` +
    `### Привязки доменов (site_domain_bindings → site_pages)\n\n${bindingList}\n\n` +
    `Примечание: site_domain_bindings связаны с site_pages через site_page_id FK. Прямого FK на products_v2 нет.`
  );
}

async function liveIntegrations(
  supabase: any,
  w: StructuredWarning[]
): Promise<string> {
  const d = "integrations";
  const botCount = await safeCount(supabase, "telegram_bots", undefined, d, w);
  const mappingCount = await safeCount(supabase, "bepaid_product_mappings", undefined, d, w);
  const instanceCount = await safeCount(supabase, "integration_instances", undefined, d, w);
  const logCount = await safeCount(supabase, "integration_logs", undefined, d, w);
  const syncLogCount = await safeCount(supabase, "bepaid_sync_logs", undefined, d, w);
  const emailAccountCount = await safeCount(supabase, "email_accounts", undefined, d, w);

  // FIXED: status instead of is_active
  const bots = await safeSelect(
    supabase,
    "telegram_bots",
    "id, bot_name, status",
    { limit: LIST_LIMIT },
    d,
    w
  );
  const botList =
    bots
      .map(
        (b: any) =>
          `  - ${b.bot_name || "(без имени)"} [${b.status || "n/a"}]`
      )
      .join("\n") || "  (нет данных)";

  const instances = await safeSelect(
    supabase,
    "integration_instances",
    "id, provider, status",
    { limit: LIST_LIMIT },
    d,
    w
  );
  const instanceList =
    instances
      .map((i: any) => `  - ${i.provider} [${i.status}]`)
      .join("\n") || "  (нет данных)";

  // EF registry snapshot
  const efList = await safeSelect(
    supabase,
    "edge_functions_registry",
    "name, enabled, category, tier, notes",
    { limit: LIST_LIMIT, order: { col: "name", asc: true } },
    d,
    w
  );
  const efBlock =
    efList.length > 0
      ? efList
          .map(
            (ef: any) =>
              `  - ${ef.name} [${ef.enabled ? "enabled" : "disabled"}] cat:${ef.category || "-"} tier:${ef.tier || "-"}`
          )
          .join("\n")
      : "  (нет записей)";

  return (
    `- Telegram ботов: ${botCount}\n` +
    `- Payment маппингов: ${mappingCount}\n` +
    `- Экземпляров интеграций: ${instanceCount}\n` +
    `- Записей integration_logs: ${logCount}\n` +
    `- Записей bepaid_sync_logs: ${syncLogCount}\n` +
    `- Email аккаунтов: ${emailAccountCount}\n\n` +
    `### Telegram боты\n\n${botList}\n\n` +
    `### Экземпляры интеграций\n\n${instanceList}\n\n` +
    `### Реестр EF (из edge_functions_registry, не полный список всех EF)\n\n${efBlock}`
  );
}

async function liveOpenTails(
  supabase: any,
  w: StructuredWarning[]
): Promise<string> {
  const d = "open_tails";
  const banCasesCount = await safeCount(supabase, "ban_cases", { col: "is_active", val: true }, d, w);
  const duplicateCasesCount = await safeCount(supabase, "duplicate_cases", undefined, d, w);
  const reconcileQueueCount = await safeCount(supabase, "payment_reconcile_queue", undefined, d, w);

  return (
    `- Активных блокировок (ban_cases): ${banCasesCount}\n` +
    `- Кейсов дубликатов: ${duplicateCasesCount}\n` +
    `- В очереди сверки платежей: ${reconcileQueueCount}`
  );
}

// ─── OPEN TAILS SECTION (4 sources) ───────────────────────────────

async function buildOpenTailsSection(
  supabase: any,
  domainKey: string,
  bp: DomainBlueprint,
  since24h: string,
  warnings: StructuredWarning[]
): Promise<string> {
  const parts: string[] = [];

  // Source 1: blueprint.knownIssues
  if (bp.knownIssues.length > 0) {
    parts.push(
      `### Известные проблемы (blueprint)\n\n${bp.knownIssues.map((i) => `- ${i}`).join("\n")}`
    );
  }

  // Source 2: pending/failed/deferred from audit_logs
  const pendingAudits = await safeSelect(
    supabase,
    "audit_logs",
    "action, meta, created_at",
    { limit: 50, order: { col: "created_at", asc: false } },
    domainKey,
    warnings
  );
  const filtered = pendingAudits.filter(
    (a: any) =>
      a.action?.includes("pending") ||
      a.action?.includes("failed") ||
      a.action?.includes("deferred")
  );
  if (filtered.length > 0) {
    const pendingList = filtered
      .map(
        (a: any) => `- ${a.created_at.substring(0, 16)} | ${a.action}`
      )
      .join("\n");
    parts.push(
      `### Pending / Failed / Deferred (audit_logs)\n\n${pendingList}`
    );
  }

  // Source 3: warnings from current batch
  const domainWarnings = warnings.filter(
    (w) => w.domain === domainKey || w.domain === "unknown"
  );
  if (domainWarnings.length > 0) {
    const warnList = domainWarnings
      .map(
        (w) =>
          `- [${w.type}] ${w.table ? w.table + (w.column ? "." + w.column : "") + ": " : ""}${w.message}`
      )
      .join("\n");
    parts.push(`### Предупреждения текущего batch\n\n${warnList}`);
  }

  // Source 4: known proof gaps (from blueprint rules)
  if (bp.rules.length > 0) {
    parts.push(
      `### Правила и ограничения\n\n${bp.rules.map((r) => `- ${r}`).join("\n")}`
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : "(нет открытых хвостов)";
}
