// PATCH-PACKAGE-CUSTOM-FIELDS-V1 (B5): vitest для dedup + effective override.
import { describe, it, expect } from "vitest";
import { dedupePackageQuestions } from "./packageFieldsDedup";

const FIELD = {
  id: "f1",
  label: "Дата подписания",
  required: false,
  description: "помощь из каталога",
  sort_order: 50,
};

function asg(over: Partial<{
  id: string;
  package_template_item_id: string;
  sort_order: number;
  created_at: string;
  is_required_override: boolean | null;
  label_override: string | null;
  help_override: string | null;
}>) {
  return {
    id: over.id ?? "a1",
    package_template_item_id: over.package_template_item_id ?? "item-1",
    field_catalog_id: "f1",
    visibility_mode: "ask_client",
    sort_order: over.sort_order ?? 100,
    created_at: over.created_at ?? "2026-06-15T00:00:00Z",
    is_required_override: over.is_required_override ?? null,
    label_override: over.label_override ?? null,
    help_override: over.help_override ?? null,
  };
}

describe("dedupePackageQuestions", () => {
  it("дедуп: один вопрос на 3 шаблона", () => {
    const out = dedupePackageQuestions([FIELD], [
      asg({ id: "a", package_template_item_id: "i1" }),
      asg({ id: "b", package_template_item_id: "i2" }),
      asg({ id: "c", package_template_item_id: "i3" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].occurrences).toBe(3);
    expect(out[0].itemIds).toEqual(["i1", "i2", "i3"]);
  });

  it("effective override: assignment с label/required override становится каноничным", () => {
    const out = dedupePackageQuestions([FIELD], [
      asg({ id: "a", sort_order: 10 }), // без override, но меньший sort_order
      asg({
        id: "b",
        sort_order: 100,
        label_override: "Кастомный лейбл",
        is_required_override: true,
        help_override: "помощь override",
      }),
    ]);
    expect(out[0].canonicalAssignment.id).toBe("b");
    expect(out[0].effective.label).toBe("Кастомный лейбл");
    expect(out[0].effective.required).toBe(true);
    expect(out[0].effective.help).toBe("помощь override");
  });

  it("override=false снимает каталоговую обязательность", () => {
    const requiredField = { ...FIELD, required: true };
    const out = dedupePackageQuestions([requiredField], [
      asg({ id: "a", is_required_override: false }),
    ]);
    expect(out[0].effective.required).toBe(false);
  });

  it("tie-break: при равном sort_order побеждает ранний created_at", () => {
    const out = dedupePackageQuestions([FIELD], [
      asg({ id: "later", created_at: "2026-06-15T10:00:00Z" }),
      asg({ id: "earlier", created_at: "2026-06-15T08:00:00Z" }),
    ]);
    expect(out[0].canonicalAssignment.id).toBe("earlier");
  });

  it("игнорирует non ask_client assignments", () => {
    const out = dedupePackageQuestions([FIELD], [
      { ...asg({}), visibility_mode: "internal_only" },
    ]);
    expect(out).toHaveLength(0);
  });

  it("сортировка: required впереди non-required", () => {
    const f2 = { ...FIELD, id: "f2", label: "Б", required: false, sort_order: 10 };
    const f1 = { ...FIELD, id: "f1", label: "А", required: true, sort_order: 200 };
    const out = dedupePackageQuestions([f1, f2], [
      { ...asg({}), id: "x1", field_catalog_id: "f1" },
      { ...asg({}), id: "x2", field_catalog_id: "f2" },
    ]);
    expect(out.map((q) => q.field.id)).toEqual(["f1", "f2"]);
  });
});
