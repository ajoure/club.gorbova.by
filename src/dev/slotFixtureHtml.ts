/**
 * DEV-ONLY fixture HTML for /__slot-fixture regression harness.
 *
 * Mirrors the structural contract HtmlIframePreview's slot bridge expects:
 *   .t-rec > .t396 > .t396__artboard
 *     [data-lovable-slot-group="tariff:<code>"]
 *       [data-lovable-offer-wrapper][data-lovable-slot-position="N"]
 *         [data-lovable-position-variant="<variant>"]
 *         [data-lovable-offer-label]
 *       [data-lovable-slot-template="<variant>"]  (hidden)
 *       [data-lovable-slot-extra="tariff:<code>"] (normal-flow overflow bucket)
 *
 * The fixture provides a single tariff with three fixed positions and three
 * templates (primary / installment / legal_entity). A follow-up "next record"
 * .t-rec sits below the artboard so we can observe its `top` after each pass.
 *
 * Variant `omitRecord=true` returns a version without the enclosing .t396
 * record wrapper — used by the "missing record" fail-closed scenario.
 */

const btn = (variant: string, label: string) => `
  <div class="tn-atom" style="width:280px;height:56px;display:flex;align-items:center;justify-content:center;
       border-radius:8px;background:${
         variant === 'primary' ? '#111' : variant === 'installment' ? '#0a6' : '#046'
       };color:#fff;font:600 15px/1 sans-serif;">
    <span data-lovable-offer-label>${label}</span>
  </div>`;

const wrapper = (pos: number, variant: string, top: number, label: string) => `
<div data-lovable-offer-wrapper
     data-lovable-slot-position="${pos}"
     data-lovable-position-variant="${variant}"
     class="tn-elem"
     style="position:absolute;left:40px;top:${top}px;width:280px;height:56px;">
  ${btn(variant, label)}
</div>`;

const template = (variant: string, label: string) => `
<div data-lovable-slot-template="${variant}"
     data-lovable-offer-wrapper
     hidden
     style="display:none;">
  ${btn(variant, label)}
</div>`;

export function buildSlotFixtureHtml(opts: { omitRecord?: boolean } = {}) {
  const inner = `
<div class="t-rec" style="position:relative;">
  <div class="t396" style="position:relative;">
    <div class="t396__artboard" style="position:relative;width:100%;height:280px;min-height:280px;background:#f5f5f5;">
      <div data-lovable-slot-group="tariff:main" style="position:absolute;inset:0;">
        ${wrapper(1, 'primary',       24, 'Купить')}
        ${wrapper(2, 'installment',   96, 'В рассрочку')}
        ${wrapper(3, 'legal_entity', 168, 'От юрлица')}
        <div data-lovable-slot-extra="tariff:main"
             style="position:absolute;left:340px;top:24px;width:280px;
                    display:flex;flex-direction:column;gap:12px;"></div>
        ${template('primary',      'Купить')}
        ${template('installment',  'В рассрочку')}
        ${template('legal_entity', 'От юрлица')}
      </div>
    </div>
  </div>
</div>
<div class="t-rec" data-lovable-next-record="1"
     style="position:relative;height:120px;background:#e0e0e0;">
  <p style="padding:24px;margin:0;">Next record (offset target)</p>
</div>`;

  if (opts.omitRecord) {
    // Strip .t396 wrapper — artboard remains directly under .t-rec so the
    // fail-closed branch in applyGroup can be exercised.
    return inner.replace(/<div class="t396"[^>]*>/, '').replace(/<\/div>\s*<\/div>\s*<div class="t-rec" data-lovable-next-record/, '</div><div class="t-rec" data-lovable-next-record');
  }
  return inner;
}

// Preset manifests keyed by scenario name.
export type SlotVariant = 'primary' | 'installment' | 'legal_entity';
export interface FixtureOffer {
  offer_id: string;
  slot_role: string;
  button_label: string;
  variant: SlotVariant;
  sort_order: number;
  offer_type: string;
  payment_method: string | null;
  amount: number;
}

export function buildManifest(offers: FixtureOffer[]) {
  return {
    version: 1 as const,
    product_id: 'fixture-product',
    tariffs: [
      {
        tariff_id: 'fixture-tariff-main',
        tariff_code: 'main',
        offers: offers.slice().sort(
          (a, b) => a.sort_order - b.sort_order || a.offer_id.localeCompare(b.offer_id),
        ),
      },
    ],
  };
}

const off = (
  id: string,
  variant: SlotVariant,
  label: string,
  sort_order: number,
): FixtureOffer => ({
  offer_id: id,
  slot_role: variant,
  button_label: label,
  variant,
  sort_order,
  offer_type: 'checkout',
  payment_method: null,
  amount: 0,
});

export const SCENARIOS = {
  zero:    () => buildManifest([]),
  one:     () => buildManifest([off('o1', 'primary', 'Купить', 0)]),
  three:   () => buildManifest([
    off('o1', 'primary',      'Купить',       0),
    off('o2', 'installment',  'В рассрочку',  1),
    off('o3', 'legal_entity', 'От юрлица',    2),
  ]),
  // 5 offers → 3 fixed positions filled, 2 overflow clones.
  max: () => buildManifest([
    off('o1', 'primary',      'Купить',       0),
    off('o2', 'installment',  'В рассрочку',  1),
    off('o3', 'legal_entity', 'От юрлица',    2),
    off('o4', 'primary',      'Купить X',     3),
    off('o5', 'installment',  'Рассрочка Y',  4),
  ]),
  // Swap: primary at sort_order=1, legal_entity at 0.
  swapPrimaryLegal: () => buildManifest([
    off('o3', 'legal_entity', 'От юрлица',    0),
    off('o1', 'primary',      'Купить',       1),
    off('o2', 'installment',  'В рассрочку',  2),
  ]),
  // Swap: primary at 1, installment at 0.
  swapPrimaryInstallment: () => buildManifest([
    off('o2', 'installment',  'В рассрочку',  0),
    off('o1', 'primary',      'Купить',       1),
    off('o3', 'legal_entity', 'От юрлица',    2),
  ]),
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;
