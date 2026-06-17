// PATCH-PACKAGE-CUSTOM-FIELDS-V1 — Smoke test for the snapshot builder.
//
// The snapshot loop currently lives inline in index.ts (lines ~1723-1797) as an
// IIFE. Refactoring it out would touch the canonical generator and is out of
// scope for the narrow follow-up. Instead, this test replays the *exact same*
// loop body against synthetic fixtures that include pf-*, ln-*, and package.*
// tokens with modifiers, proving that:
//   - the ln-* branch emits provider: 'ln' with persons/positions/format/case
//   - the package.* branch emits provider: 'package' with raw/rendered/source
//   - modifiers produce DISTINCT entries (dedup by `${provider}:${raw_inside}`)
//   - item_context is bound to package_template_item_id
//
// Run: deno test supabase/functions/canonical-document-generate-strict/__tests__/snapshot_builder_smoke.test.ts
//
// If you change the snapshot loop in index.ts, mirror the change here.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

type ParsedPfToken = { raw_inside: string; public_id: string; format: string | null };
type ParsedPkgToken = {
  raw_inside: string;
  kind: "ln" | "package";
  bag_key: string;
  format: string | null;
  case_modifier: string | null;
  include_position?: boolean;
  join?: string | null;
};

function buildSnapshot(args: {
  generationContext: "package_session" | "billing";
  parsedPfTokens: ParsedPfToken[];
  parsedPackageTokens: ParsedPkgToken[];
  packageContext: {
    package_session_id: string;
    package_template_item_id: string;
    preresolved_pf_fields: Record<string, any>;
    preresolved_ln_tokens: Record<string, any>;
    preresolved_package_fields: Record<string, any>;
  };
  resolved: Record<string, string>;
  sourceTrace: Record<string, any>;
}): any[] {
  const {
    generationContext,
    parsedPfTokens,
    parsedPackageTokens,
    packageContext,
    resolved,
    sourceTrace,
  } = args;
  // ---- VERBATIM mirror of index.ts:1723-1797 ----
  if (generationContext !== "package_session") return [];
  const seen = new Set<string>();
  const out: any[] = [];
  const itemContext = {
    package_session_id: packageContext!.package_session_id,
    package_template_item_id: packageContext!.package_template_item_id,
  };
  for (const pt of parsedPfTokens) {
    const key = `pf:${pt.raw_inside}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = (packageContext!.preresolved_pf_fields || {})[pt.public_id];
    if (!e) continue;
    const rendered = resolved[pt.raw_inside];
    out.push({
      provider: "pf",
      raw_inside: pt.raw_inside,
      public_id: e.public_id,
      label: e.label,
      data_type: e.data_type,
      raw_value: e.raw_value,
      rendered_value: typeof rendered === "string" ? rendered : (e.rendered_value ?? ""),
      format: pt.format ?? null,
      default_kind_applied: e.default_kind_applied,
      item_context: itemContext,
    });
  }
  for (const pt of parsedPackageTokens) {
    const key = `${pt.kind === "ln" ? "ln" : "package"}:${pt.raw_inside}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rendered = resolved[pt.raw_inside];
    const renderedValue = typeof rendered === "string" ? rendered : "";
    const trace = sourceTrace[pt.raw_inside] || {};
    if (pt.kind === "ln") {
      const e: any = (packageContext!.preresolved_ln_tokens || {})[pt.bag_key] || {};
      out.push({
        provider: "ln",
        raw_inside: pt.raw_inside,
        bag_key: pt.bag_key,
        rendered_value: renderedValue,
        persons: Array.isArray(e.persons) ? e.persons.map((s: any) => String(s)) : [],
        positions: Array.isArray(e.positions) ? e.positions.map((s: any) => String(s)) : [],
        format: pt.format ?? null,
        case_modifier: pt.case_modifier ?? null,
        include_position: pt.include_position === true,
        join: pt.join ?? null,
        format_applied: trace.format_applied === true,
        case_applied: trace.case_applied === true,
        item_context: itemContext,
      });
    } else {
      const e: any = (packageContext!.preresolved_package_fields || {})[pt.bag_key] || {};
      out.push({
        provider: "package",
        raw_inside: pt.raw_inside,
        bag_key: pt.bag_key,
        raw_value: e.value ?? null,
        rendered_value: renderedValue,
        source: e.source ?? trace.source ?? null,
        format: pt.format ?? null,
        case_modifier: pt.case_modifier ?? null,
        format_applied: trace.format_applied === true,
        case_applied: trace.case_applied === true,
        item_context: itemContext,
      });
    }
  }
  return out;
  // ---- end mirror ----
}

Deno.test("snapshot builder — ln-*, package.*, pf-* with modifiers (Идеология fixture)", () => {
  // Fixture reflects the real Идеология template:
  // detected_tokens:
  //   package.ul.FLD-000039
  //   field:FLD-000209
  //   package.ul.FLD-000011
  //   field:FLD-000211
  //   ln-000012|case=genitive|include_position=true
  //   package.ul.FLD-000013
  //   package.ul.FLD-000014|format=signature_short
  //   ln-000012|format=signature_short
  const itemId = "a1291835-8230-47ba-8e1f-2f258e612c2f";
  const sessionId = "b0b229b7-cf7e-4869-988e-8e97bdf54043";
  const snapshot = buildSnapshot({
    generationContext: "package_session",
    parsedPfTokens: [
      { raw_inside: "FLD-000209", public_id: "FLD-000209", format: null },
      { raw_inside: "FLD-000211", public_id: "FLD-000211", format: null },
    ],
    parsedPackageTokens: [
      { raw_inside: "package.ul.FLD-000039", kind: "package", bag_key: "ul.FLD-000039", format: null, case_modifier: null },
      { raw_inside: "package.ul.FLD-000011", kind: "package", bag_key: "ul.FLD-000011", format: null, case_modifier: null },
      { raw_inside: "package.ul.FLD-000013", kind: "package", bag_key: "ul.FLD-000013", format: null, case_modifier: null },
      { raw_inside: "package.ul.FLD-000014|format=signature_short", kind: "package", bag_key: "ul.FLD-000014", format: "signature_short", case_modifier: null },
      { raw_inside: "ln-000012|case=genitive|include_position=true", kind: "ln", bag_key: "ln-000012", format: null, case_modifier: "genitive", include_position: true },
      { raw_inside: "ln-000012|format=signature_short", kind: "ln", bag_key: "ln-000012", format: "signature_short", case_modifier: null },
    ],
    packageContext: {
      package_session_id: sessionId,
      package_template_item_id: itemId,
      preresolved_pf_fields: {
        "FLD-000209": { public_id: "FLD-000209", label: "Дата приказа", data_type: "date", raw_value: "2026-06-17", rendered_value: "17.06.2026", default_kind_applied: null },
        "FLD-000211": { public_id: "FLD-000211", label: "Номер приказа", data_type: "string", raw_value: "1-ОД", rendered_value: "1-ОД", default_kind_applied: null },
      },
      preresolved_ln_tokens: {
        "ln-000012": { persons: ["Иванов Иван Иванович"], positions: ["Директор"] },
      },
      preresolved_package_fields: {
        "ul.FLD-000039": { value: "ООО Тест", source: "client_legal_details" },
        "ul.FLD-000011": { value: "г. Минск, ул. Примерная, 1", source: "client_legal_details" },
        "ul.FLD-000013": { value: "Иванов И.И.", source: "client_legal_details" },
        "ul.FLD-000014": { value: "Иванов Иван Иванович", source: "client_legal_details" },
      },
    },
    resolved: {
      "FLD-000209": "17.06.2026",
      "FLD-000211": "1-ОД",
      "package.ul.FLD-000039": "ООО Тест",
      "package.ul.FLD-000011": "г. Минск, ул. Примерная, 1",
      "package.ul.FLD-000013": "Иванов И.И.",
      "package.ul.FLD-000014|format=signature_short": "Иванов И.И.",
      "ln-000012|case=genitive|include_position=true": "Директора Иванова Ивана Ивановича",
      "ln-000012|format=signature_short": "Иванов И.И.",
    },
    sourceTrace: {
      "package.ul.FLD-000014|format=signature_short": { format_applied: true, source: "client_legal_details" },
      "ln-000012|case=genitive|include_position=true": { case_applied: true, format_applied: false },
      "ln-000012|format=signature_short": { format_applied: true, case_applied: false },
    },
  });

  const ln = snapshot.filter((e) => e.provider === "ln");
  const pkg = snapshot.filter((e) => e.provider === "package");
  const pf = snapshot.filter((e) => e.provider === "pf");

  assertEquals(pf.length, 2, "pf entries");
  assertEquals(pkg.length, 4, "package entries");
  assertEquals(ln.length, 2, "ln entries (2 distinct raw_inside variants)");

  // ln modifiers preserved + format_applied/case_applied reflected
  const lnGen = ln.find((e) => e.raw_inside.includes("genitive"))!;
  assertEquals(lnGen.case_modifier, "genitive");
  assertEquals(lnGen.include_position, true);
  assertEquals(lnGen.case_applied, true);
  assertEquals(lnGen.format_applied, false);
  assertEquals(lnGen.persons, ["Иванов Иван Иванович"]);
  assertEquals(lnGen.positions, ["Директор"]);
  assertEquals(lnGen.rendered_value, "Директора Иванова Ивана Ивановича");

  const lnSig = ln.find((e) => e.raw_inside.includes("signature_short"))!;
  assertEquals(lnSig.format, "signature_short");
  assertEquals(lnSig.format_applied, true);
  assertEquals(lnSig.rendered_value, "Иванов И.И.");

  // package.* modifier branch
  const pkgSig = pkg.find((e) => e.raw_inside.endsWith("|format=signature_short"))!;
  assertEquals(pkgSig.format, "signature_short");
  assertEquals(pkgSig.format_applied, true);
  assertEquals(pkgSig.raw_value, "Иванов Иван Иванович");
  assertEquals(pkgSig.rendered_value, "Иванов И.И.");
  assertEquals(pkgSig.source, "client_legal_details");

  // item_context bound to template item
  for (const e of snapshot) {
    assertEquals(e.item_context.package_session_id, sessionId);
    assertEquals(e.item_context.package_template_item_id, itemId);
  }

  // Dedup safety: re-running with duplicates produces same shape
  const snapshot2 = buildSnapshot({
    generationContext: "package_session",
    parsedPfTokens: [
      { raw_inside: "FLD-000209", public_id: "FLD-000209", format: null },
      { raw_inside: "FLD-000209", public_id: "FLD-000209", format: null },
    ],
    parsedPackageTokens: [
      { raw_inside: "ln-000012", kind: "ln", bag_key: "ln-000012", format: null, case_modifier: null },
      { raw_inside: "ln-000012", kind: "ln", bag_key: "ln-000012", format: null, case_modifier: null },
    ],
    packageContext: {
      package_session_id: sessionId,
      package_template_item_id: itemId,
      preresolved_pf_fields: { "FLD-000209": { public_id: "FLD-000209", label: "x", data_type: "date", raw_value: "x", rendered_value: "x" } },
      preresolved_ln_tokens: { "ln-000012": { persons: ["X"], positions: [] } },
      preresolved_package_fields: {},
    },
    resolved: { "FLD-000209": "x", "ln-000012": "X" },
    sourceTrace: {},
  });
  assertEquals(snapshot2.length, 2, "dedup: 1 pf + 1 ln");
});

Deno.test("snapshot builder — billing context returns []", () => {
  const out = buildSnapshot({
    generationContext: "billing" as any,
    parsedPfTokens: [],
    parsedPackageTokens: [{ raw_inside: "ln-000012", kind: "ln", bag_key: "ln-000012", format: null, case_modifier: null }],
    packageContext: { package_session_id: "x", package_template_item_id: "y", preresolved_pf_fields: {}, preresolved_ln_tokens: {}, preresolved_package_fields: {} },
    resolved: {},
    sourceTrace: {},
  });
  assertEquals(out, []);
});
