// Canonical purchase-composition helper (Deno edge mirror of src/lib/purchaseCompositionTitle.ts).
// Формат: «<primary.product_name>, тариф <primary.tariff_name>»
//   плюс, если addons ≠ ∅: «. Модуль <n1>. Модуль <n2>...»

export interface PurchaseCompositionPrimary {
  product_name: string;
  tariff_name?: string | null;
}

export interface PurchaseCompositionAddon {
  product_name: string;
}

export interface PurchaseCompositionInput {
  primary: PurchaseCompositionPrimary;
  addons?: PurchaseCompositionAddon[] | null;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function buildPurchaseCompositionTitle(input: PurchaseCompositionInput): string {
  const productName = clean(input.primary?.product_name);
  if (!productName) return "";
  const tariffName = clean(input.primary?.tariff_name);
  let head = productName;
  if (tariffName) head += `, тариф ${tariffName}`;
  const addons = (input.addons ?? [])
    .map((a) => clean(a?.product_name))
    .filter((n) => n.length > 0);
  if (addons.length === 0) return head;
  return head + addons.map((n) => `. Модуль ${n}`).join("");
}
