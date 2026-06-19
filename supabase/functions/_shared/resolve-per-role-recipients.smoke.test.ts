// PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 — Stage B smoke
//
// Тесты резолвера `resolvePerRoleRecipients` через in-memory fake Supabase.
// Фикстуры скопированы с реальной сессии «Годовое собрание»
// (session 6a61a7e3-…, items: f9962f6b «Приказ» = single,
// febd1821 «Извещение» = per_role_person + uchastnik).
//
// DB не модифицируется — все вызовы идут через локальный fake-клиент.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolvePerRoleRecipients } from "./resolve-per-role-recipients.ts";

const SESSION = "6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53";
const PKG = "21764469-aaaa-bbbb-cccc-000000000001";
const PKG_OTHER = "21764469-aaaa-bbbb-cccc-000000000099";
const ITEM_PRIKAZ = "f9962f6b-b3a5-411d-ad2c-fa651aa8b6e9";
const ITEM_IZVESHCH = "febd1821-fba8-4290-babf-99c59c27f2f4";
const ROLE_UCHASTNIK = "c8fc4200-75c0-4c24-8eea-112c4e468aeb";
const ROLE_REVIZOR = "40b6dd45-7a56-4146-82c3-dec6529120fd";
const ROLE_FOREIGN = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const PERSON_A = "77aa175a-a085-44b9-9d52-73e264b8f478"; // Иванов Петр
const PERSON_B = "9f6a564a-935d-4f03-a42b-04dd5366137b"; // Петров Петр Петрович
const PERSON_C = "26402449-4eb1-4b87-a004-8f5cbbc2ff65"; // Федорчук

type Row = Record<string, unknown>;
interface Fixtures {
  sessions: Row[];
  items: Row[];
  roles: Row[];
  assignments: Row[];
  persons: Row[];
}

function baseFixtures(overrides: Partial<Fixtures> = {}): Fixtures {
  return {
    sessions: [{ id: SESSION, package_template_id: PKG }],
    items: [
      { id: ITEM_PRIKAZ, package_template_id: PKG, generation_mode: "single", repeat_role_catalog_id: null },
      {
        id: ITEM_IZVESHCH,
        package_template_id: PKG,
        generation_mode: "per_role_person",
        repeat_role_catalog_id: ROLE_UCHASTNIK,
      },
    ],
    roles: [
      { id: ROLE_UCHASTNIK, package_template_id: PKG, role_key: "uchastnik", label: "Участник", is_active: true },
      { id: ROLE_REVIZOR, package_template_id: PKG, role_key: "revizor", label: "Ревизор", is_active: true },
      { id: ROLE_FOREIGN, package_template_id: PKG_OTHER, role_key: "uchastnik", label: "Участник (чужой)", is_active: true },
    ],
    assignments: [
      {
        id: "0c458f06-cc15-4f8f-a095-bfadedff660b",
        package_session_id: SESSION,
        package_template_item_id: ITEM_IZVESHCH,
        role_catalog_id: ROLE_UCHASTNIK,
        person_id: PERSON_A,
        sort_order: 20,
        metadata: {},
        is_active: true,
      },
      {
        id: "77540e62-b6b2-45ae-85c6-aff796a61680",
        package_session_id: SESSION,
        package_template_item_id: ITEM_IZVESHCH,
        role_catalog_id: ROLE_UCHASTNIK,
        person_id: PERSON_B,
        sort_order: 10,
        metadata: { position: "директор" },
        is_active: true,
      },
      {
        id: "44d5ce98-785c-4b9b-b454-4581a99441f7",
        package_session_id: SESSION,
        package_template_item_id: ITEM_IZVESHCH,
        role_catalog_id: ROLE_UCHASTNIK,
        person_id: PERSON_C,
        sort_order: 30,
        metadata: {},
        is_active: true,
      },
    ],
    persons: [
      { id: PERSON_A, full_name: "Иванов Петр", email: null, phone: null, address_structured: null },
      { id: PERSON_B, full_name: "Петров Петр Петрович", email: null, phone: null, address_structured: { city: "Минск", street: "Ленина 1" } },
      { id: PERSON_C, full_name: "Федорчук Сергей Валерьвич", email: "7500084@gmail.com", phone: "+48571447124", address_structured: null },
    ],
    ...overrides,
  };
}

function makeFake(fx: Fixtures) {
  function makeBuilder(rows: Row[]) {
    let filtered = [...rows];
    const b = {
      select: (_cols?: string) => b,
      eq: (col: string, val: unknown) => {
        filtered = filtered.filter((r) => r[col] === val);
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        const set = new Set(vals);
        filtered = filtered.filter((r) => set.has(r[col]));
        return b;
      },
      maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
      then: (resolve: (x: { data: Row[]; error: null }) => void) => resolve({ data: filtered, error: null }),
    };
    return b;
  }
  return {
    from(table: string) {
      switch (table) {
        case "document_package_sessions": return makeBuilder(fx.sessions);
        case "document_package_template_items": return makeBuilder(fx.items);
        case "document_package_role_catalog": return makeBuilder(fx.roles);
        case "document_package_item_role_assignments": return makeBuilder(fx.assignments);
        case "legal_details_persons": return makeBuilder(fx.persons);
        default: return makeBuilder([]);
      }
    },
  };
}

Deno.test("S1 single mode → status=single_mode, recipients=[]", async () => {
  const r = await resolvePerRoleRecipients(makeFake(baseFixtures()), {
    session_id: SESSION,
    item_id: ITEM_PRIKAZ,
  });
  assertEquals(r.mode, "single");
  assertEquals(r.status, "single_mode");
  assertEquals(r.recipients.length, 0);
  assertEquals(r.repeat_role_catalog_id, null);
});

Deno.test("S2 per_role_person → ok + deterministic order + recipient context", async () => {
  const r = await resolvePerRoleRecipients(makeFake(baseFixtures()), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.mode, "per_role_person");
  assertEquals(r.status, "ok");
  assertEquals(r.recipients.length, 3);
  // sort_order 10, 20, 30
  assertEquals(r.recipients.map((x) => x.person_id), [PERSON_B, PERSON_A, PERSON_C]);
  assertEquals(r.recipients[0].role_label, "Участник");
  assertEquals(r.recipients[0].recipient.position, "директор");
  assertEquals(r.recipients[0].recipient.full_name, "Петров Петр Петрович");
  assertEquals(r.recipients[0].recipient.short_name, "Петров П.П.");
  assertEquals(r.recipients[0].recipient.address, "Минск, Ленина 1");
  assertEquals(r.recipients[2].recipient.email, "7500084@gmail.com");
  assertEquals(r.recipients[2].recipient.phone, "+48571447124");
});

Deno.test("S3 per_role_person + zero active assignments → no_active_assignments", async () => {
  const fx = baseFixtures();
  fx.assignments = fx.assignments.map((a) => ({ ...a, is_active: false }));
  const r = await resolvePerRoleRecipients(makeFake(fx), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.status, "no_active_assignments");
  assertEquals(r.recipients.length, 0);
});

Deno.test("S4 role from another package → role_package_mismatch", async () => {
  const fx = baseFixtures();
  fx.items = fx.items.map((i) =>
    i.id === ITEM_IZVESHCH ? { ...i, repeat_role_catalog_id: ROLE_FOREIGN } : i
  );
  const r = await resolvePerRoleRecipients(makeFake(fx), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.status, "role_package_mismatch");
  assertEquals(r.recipients.length, 0);
});

Deno.test("S5 session ↔ item mismatch → item_outside_session_package", async () => {
  const fx = baseFixtures();
  fx.sessions = [{ id: SESSION, package_template_id: PKG_OTHER }];
  const r = await resolvePerRoleRecipients(makeFake(fx), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.status, "item_outside_session_package");
});

Deno.test("S6 role_not_configured when repeat_role_catalog_id is NULL but mode=per_role_person", async () => {
  const fx = baseFixtures();
  fx.items = fx.items.map((i) =>
    i.id === ITEM_IZVESHCH ? { ...i, repeat_role_catalog_id: null } : i
  );
  const r = await resolvePerRoleRecipients(makeFake(fx), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.status, "role_not_configured");
});

Deno.test("S7 inactive role → role_inactive", async () => {
  const fx = baseFixtures();
  fx.roles = fx.roles.map((r) => r.id === ROLE_UCHASTNIK ? { ...r, is_active: false } : r);
  const r = await resolvePerRoleRecipients(makeFake(fx), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.status, "role_inactive");
});

Deno.test("S8 duplicate person across assignments → deterministic dedup + reason", async () => {
  const fx = baseFixtures();
  fx.assignments = [
    {
      id: "dup-second", package_session_id: SESSION, package_template_item_id: ITEM_IZVESHCH,
      role_catalog_id: ROLE_UCHASTNIK, person_id: PERSON_A, sort_order: 50, metadata: {}, is_active: true,
    },
    {
      id: "dup-first", package_session_id: SESSION, package_template_item_id: ITEM_IZVESHCH,
      role_catalog_id: ROLE_UCHASTNIK, person_id: PERSON_A, sort_order: 10, metadata: {}, is_active: true,
    },
  ];
  fx.persons = fx.persons.filter((p) => p.id === PERSON_A);
  const r = await resolvePerRoleRecipients(makeFake(fx), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.status, "ok");
  assertEquals(r.recipients.length, 1);
  assertEquals(r.recipients[0].assignment_id, "dup-first"); // первая по sort_order
  assert(r.reasons.some((x) => x.startsWith("duplicate_person_skipped:") && x.includes("dup-second")));
});

Deno.test("S9 non-person assignment (person_id=null) → skipped + reason", async () => {
  const fx = baseFixtures();
  fx.assignments = [
    {
      id: "no-person", package_session_id: SESSION, package_template_item_id: ITEM_IZVESHCH,
      role_catalog_id: ROLE_UCHASTNIK, person_id: null, sort_order: 5, metadata: {}, is_active: true,
    },
    ...fx.assignments,
  ];
  const r = await resolvePerRoleRecipients(makeFake(fx), {
    session_id: SESSION,
    item_id: ITEM_IZVESHCH,
  });
  assertEquals(r.status, "ok");
  assertEquals(r.recipients.length, 3);
  assert(r.reasons.some((x) => x === "non_person_assignment_skipped:no-person"));
});

Deno.test("S10 session_not_found / item_not_found", async () => {
  const empty = makeFake({ ...baseFixtures(), sessions: [] });
  const r1 = await resolvePerRoleRecipients(empty, { session_id: SESSION, item_id: ITEM_IZVESHCH });
  assertEquals(r1.status, "session_not_found");

  const noItem = makeFake({ ...baseFixtures(), items: [] });
  const r2 = await resolvePerRoleRecipients(noItem, { session_id: SESSION, item_id: ITEM_IZVESHCH });
  assertEquals(r2.status, "item_not_found");
});
