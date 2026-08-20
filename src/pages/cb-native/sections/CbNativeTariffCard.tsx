/**
 * Native tariff card for /cb-native-preview.
 *
 * Text/visual source of truth (verbatim, char-for-char):
 *   src/pages/cb-native/cbold_manifest.json → rec1219722591.text (182 lines)
 *
 * Rules:
 *  - No paraphrasing/reordering. Every displayed string is a slice of manifest text.
 *  - Prices come from the product tariff's card_config. Checkout amounts still
 *    come from the selected backend offer, so the visual price and payment
 *    flow share the same configurable product source rather than stale Tilda
 *    copy.
 *  - CTA labels come from backend offers (usePublicProduct → tariff.offers),
 *    forced into the canonical administrator-configured order:
 *      1) full card payment
 *      2) Resource Development bank installment application
 *      3) internal installment (two payments)
 *      4) legal-entity invoice
 *      5) ordinary manager application
 *    Uppercase is CSS, not a hardcoded literal — real labels remain whatever
 *    backend returns; we only sort + text-transform.
 *  - Fonts: 'PT Sans' + 'Sf-pro-display' (live Tilda tariff block), NOT Comfortaa.
 */
import { Button } from "@/components/ui/button";
import type { PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";
import { rec, CB_PALETTE } from "../manifest";
import {
  normalizeCbTariffIdentity,
  resolveCbTariffCardIndex,
  selectAndSortCbOffers,
} from "../tariffPublicContract";

const TARIFF_FONT =
  "'PT Sans','Sf-pro-display','Segoe UI',Arial,sans-serif";
const PRICE_FONT =
  "'Sf-pro-display','PT Sans','Segoe UI',Arial,sans-serif";

// --- Verbatim strings from rec1219722591.text (indices are stable) ---
const T = rec("rec1219722591").text;
const t = (i: number) => T[i] ?? "";

type Badge = "VIP" | "Grand" | "Business";
type FeatureItem = {
  badge?: Badge;
  bold?: string;
  text: string;
  locked?: boolean;
};

type CardData = {
  title: string;
  core: FeatureItem[];
  programme: FeatureItem[];
  credentials: FeatureItem[];
  audienceTitle: string;
  audience: string;
  period: string;
};

const CARDS: CardData[] = [
  // ── БУХГАЛТЕР ─────────────────────────────────────────────
  {
    title: t(8), // "БУХГАЛТЕР"
    core: [
      { text: t(10) },                                // Предобучение
      { text: t(12) },                                // 18 основных модулей
      { bold: t(14), text: t(15) },                   // Задания / для личной проработки…
      { bold: t(17), text: t(18) },                   // Дополнительные материалы / , рабочая тетрадь…
      { text: t(20), locked: true },                  // Доступ к клубу «Буква закона»
      { bold: t(22), text: t(23) },                   // Доступ 6 месяцев / после окончания курса
    ],
    programme: [
      { text: t(25) },                                // 5 практических конференций с Катериной
      { text: t(26).replace(/^→\s*/, "") },           // Итоговый конспект для удобной работы
      { badge: "VIP", text: t(29) },                  // «Делегирование»
      { badge: "VIP", text: t(32) },                  // «Найм, адаптация и удержание персонала»
      { badge: "VIP", text: t(35) },                  // «Таймлайн месяца»
      { badge: "Grand", text: t(40), locked: true },  // «Налоговое законодательство Беларуси»
      { badge: "Grand", text: t(42), locked: true },  // «Система в бухгалтерии»
      { badge: "Business", text: t(44), locked: true },
      { badge: "Business", text: t(46), locked: true },
      { bold: t(47), text: t(48), locked: true },
      { bold: t(49), text: t(50), locked: true },
    ],
    credentials: [
      { bold: t(36).replace(/^→\s*/, ""), text: t(37) },
      { bold: t(54), text: t(55), locked: true },
      { text: t(56), locked: true },
    ],
    audienceTitle: t(78),
    audience: t(79),
    period: t(57), // 12 мес
  },

  // ── ГЛАВНЫЙ БУХГАЛТЕР ─────────────────────────────────────
  {
    title: t(61), // "ГЛАВНЫЙ БУХГАЛТЕР"
    core: [
      { text: t(63) },                                // Предобучение
      { text: t(65) },                                // 18 основных модулей
      { bold: t(67), text: t(68) },                   // Задания / для личной проработки…
      { bold: t(70), text: t(71) },                   // Дополнительные материалы / , рабочая тетрадь…
      { bold: t(73), text: t(74) },                   // Доступ к Клубу "Буква закона" / тариф Full на 4 недели
      { bold: t(76), text: t(77) },                   // Доступ 8 месяцев / после окончания курса
    ],
    programme: [
      { text: t(81) },                                // 6 практических конференций с Катериной
      { text: t(82).replace(/^→\s*/, "") },           // Итоговый конспект…
      { badge: "VIP", text: t(85) },                  // «Делегирование»
      { badge: "VIP", text: t(88) },                  // «Найм, адаптация и удержание персонала»
      { badge: "VIP", text: t(91) },                  // «Таймлайн месяца»
      { badge: "Grand", text: t(94) },                // «Налоговое законодательство Беларуси»
      { badge: "Grand", text: t(97) },                // «Система в бухгалтерии»
      { badge: "Business", text: t(105), locked: true },
      { badge: "Business", text: t(107), locked: true },
      { bold: t(108), text: t(109), locked: true },
      { bold: t(110), text: t(111), locked: true },
    ],
    credentials: [
      { bold: t(98).replace(/^→\s*/, ""), text: t(99) },
      { bold: t(101), text: t(102) },
      { text: t(112), locked: true },
    ],
    audienceTitle: t(178),
    audience: [t(179), t(180), t(181)].filter(Boolean).join(" "),
    period: t(116), // 12 мес
  },

  // ── БИЗНЕС-ЛЕДИ ───────────────────────────────────────────
  {
    title: t(120), // "БИЗНЕС-ЛЕДИ"
    core: [
      { text: t(122) },                               // Предобучение
      { text: t(124) },                               // 18 основных модулей
      { bold: t(126), text: t(127) },                 // Задания …
      { bold: t(129), text: t(130) },                 // Дополнительные материалы …
      { bold: t(132), text: t(133) },                 // Доступ к клубу “Буква закона” / тариф Business на 4 недели
      { bold: t(135), text: t(136) },                 // Доступ 10 месяцев / после окончания курса
    ],
    programme: [
      { text: t(138) },                               // 6 практических конференций с Катериной
      { text: t(139).replace(/^→\s*/, "") },          // Итоговый конспект…
      { badge: "VIP", text: t(142) },
      { badge: "VIP", text: t(145) },
      { badge: "VIP", text: t(148) },
      { badge: "Grand", text: t(151) },
      { badge: "Grand", text: t(154) },
      { badge: "Business", text: t(157) },
      { badge: "Business", text: t(160) },
      { bold: t(161), text: t(162) },
      { bold: t(163), text: t(164) },
    ],
    credentials: [
      { bold: t(165).replace(/^→\s*/, ""), text: t(166) },
      { bold: t(168), text: `${t(169)} ${t(170)}` },
      { bold: t(172), text: t(173) },
    ],
    audienceTitle: t(175),
    audience: [t(176), t(177)].filter(Boolean).join(" "),
    period: t(3),    // 12 мес
  },
];

const finiteAmount = (value: unknown): number | null => {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const formatAmount = (amount: number) =>
  new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);

const resolveVisualPricing = (tariff: PublicTariff) => {
  const cardConfig = tariff.meta?.card_config;
  const activeOffers = (tariff.offers ?? []).filter((offer) => offer.is_active !== false);
  const primaryFullPayment = activeOffers.find(
    (offer) =>
      offer.is_primary === true &&
      (offer.offer_type === "pay_now" || offer.payment_method === "full_payment"),
  );
  const firstPayNow = activeOffers.find((offer) => offer.offer_type === "pay_now");
  const firstOffer = activeOffers[0];

  const current =
    finiteAmount(cardConfig?.price_display) ??
    finiteAmount(primaryFullPayment?.amount) ??
    finiteAmount(tariff.current_price) ??
    finiteAmount(firstPayNow?.amount) ??
    finiteAmount(firstOffer?.amount);
  const configuredOld = finiteAmount(cardConfig?.old_price);
  const old = current && configuredOld && configuredOld > current ? configuredOld : null;
  const suffix = cardConfig?.price_suffix?.trim() || "BYN";

  return {
    current,
    old,
    monthly: current ? Math.round(current / 12) : null,
    suffix,
  };
};

// ── CTA appearance is controlled by the saved offer setting ────────
const BUTTON_VARIANT_STYLE = {
  primary: {
    background: CB_PALETTE.accent,
    color: "#ffffff",
    borderColor: CB_PALETTE.accent,
  },
  outline: {
    background: "#ffffff",
    color: CB_PALETTE.accent,
    borderColor: CB_PALETTE.accent,
  },
  installment: {
    background: "#f97316",
    color: "#ffffff",
    borderColor: "#f97316",
  },
  legal_entity: {
    background: "#059669",
    color: "#ffffff",
    borderColor: "#059669",
  },
  lead: {
    background: "#64748b",
    color: "#ffffff",
    borderColor: "#64748b",
  },
} as const;

type ButtonVariant = keyof typeof BUTTON_VARIANT_STYLE;

const legacyButtonVariant = (offer: TariffOffer): ButtonVariant => {
  const label = (offer.button_label ?? "").toLowerCase();
  if (
    offer.offer_type === "invoice" ||
    offer.payment_method === "bank_transfer" ||
    label.includes("юрлиц")
  ) {
    return "legal_entity";
  }
  if (offer.payment_method === "internal_installment") return "outline";
  if (offer.offer_type === "bank_installment" || label.includes("рассроч")) {
    return "installment";
  }
  if (offer.offer_type === "lead" || offer.offer_type === "preregistration") return "lead";
  return "primary";
};

const buttonStyle = (offer: TariffOffer) => {
  const configured = (offer.meta?.site_button_variant ?? "").trim() as ButtonVariant;
  const variant = configured in BUTTON_VARIANT_STYLE ? configured : legacyButtonVariant(offer);
  return BUTTON_VARIANT_STYLE[variant];
};

const BADGE_STYLES: Record<Badge, { label: string; minWidth: number }> = {
  VIP: {
    label: "VIP",
    minWidth: 35,
  },
  Grand: {
    label: "GRAND",
    minWidth: 52,
  },
  Business: {
    label: "BUSINESS",
    minWidth: 66,
  },
};

const LOCK_ASSET =
  "https://static.tildacdn.com/tild6465-3839-4530-b338-666633303264/___80.png";

function FeatureRow({
  item,
  dark = false,
}: {
  item: FeatureItem;
  dark?: boolean;
}) {
  const badge = item.badge ? BADGE_STYLES[item.badge] : null;
  return (
    <li
      className="flex min-w-0 items-start gap-[9px]"
      data-locked={item.locked ? "true" : "false"}
      style={{ opacity: item.locked ? 0.55 : 1 }}
    >
      {item.locked ? (
        <img
          src={LOCK_ASSET}
          alt="Не входит в тариф"
          width={18}
          height={22}
          className="mt-[2px] h-[22px] w-[18px] shrink-0 object-contain"
          style={{ filter: dark ? "none" : "invert(.55)" }}
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="mt-[-1px] w-[18px] shrink-0 text-[19px] leading-none"
          style={{ color: dark ? "#ffffff" : CB_PALETTE.accent }}
        >
          →
        </span>
      )}
      <span className="flex min-w-0 items-start gap-[8px]">
        {badge ? (
          <span
            data-cb-native-feature-badge={item.badge}
            aria-label={badge.label}
            className="mt-[1px] inline-flex h-[21px] shrink-0 items-center justify-center rounded-[4px] bg-black px-[5px] text-center text-[10px] font-bold uppercase leading-none tracking-[-0.01em] text-white"
            style={{ minWidth: badge.minWidth }}
          >
            {badge.label}
          </span>
        ) : null}
        <span className="min-w-0">
          {item.bold ? <strong className="font-bold">{item.bold}</strong> : null}
          {item.bold && item.text ? " " : null}
          {item.text}
        </span>
      </span>
    </li>
  );
}

interface CbNativeTariffCardProps {
  tariff: PublicTariff;
  index: number;
  onSelectOffer: (offer: TariffOffer, tariff: PublicTariff) => void;
}

export function CbNativeTariffCard({ tariff, index, onSelectOffer }: CbNativeTariffCardProps) {
  const card = CARDS[resolveCbTariffCardIndex(tariff, index)] ?? CARDS[0];
  const pricing = resolveVisualPricing(tariff);
  const offers = selectAndSortCbOffers(tariff.offers ?? []);

  return (
    <article
      data-cb-native-tariff={normalizeCbTariffIdentity(tariff.name)}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-[25px] border-2 shadow-none"
      style={{
        background: "#ffffff",
        borderColor: CB_PALETTE.accent,
        fontFamily: TARIFF_FONT,
      }}
    >
      <div className="flex flex-1 flex-col px-[18px] pb-[28px] pt-[34px] sm:px-[20px]">
        <h3
          className="text-[27px] font-bold uppercase leading-[1.15] tracking-[-0.01em]"
          style={{ color: CB_PALETTE.accent, fontFamily: PRICE_FONT }}
        >
          {card.title}
        </h3>

        <ul
          className="mt-6 space-y-[10px] text-[16px] leading-[1.32]"
          style={{ color: "#1b1b1b" }}
        >
          {card.core.map((item, itemIndex) => (
            <FeatureRow key={itemIndex} item={item} />
          ))}
        </ul>

        <div
          className="mt-6 rounded-[25px] px-[14px] py-[20px] text-[15px] leading-[1.24] sm:px-[16px]"
          style={{ background: CB_PALETTE.accent, color: "#ffffff" }}
        >
          <ul className="space-y-[10px]">
            {card.programme.map((item, itemIndex) => (
              <FeatureRow key={itemIndex} item={item} dark />
            ))}
          </ul>
        </div>

        <div
          className="mt-[10px] rounded-[25px] px-[14px] py-[20px] text-[15px] leading-[1.24] sm:px-[16px]"
          style={{ background: "#302c2c", color: "#ffffff" }}
        >
          <ul className="space-y-[11px]">
            {card.credentials.map((item, itemIndex) => (
              <FeatureRow key={itemIndex} item={item} dark />
            ))}
          </ul>
        </div>

        <div className="mt-auto pt-[66px]" style={{ fontFamily: PRICE_FONT }}>
          {pricing.old ? (
            <p
              data-cb-native-old-price
              className="text-[28px] font-semibold leading-none line-through"
              style={{ color: "#1b1b1b" }}
            >
              {formatAmount(pricing.old)} {pricing.suffix}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-[10px]">
            {pricing.monthly ? (
              <p
                data-cb-native-monthly-price
                className="min-w-0 text-[27px] font-bold uppercase leading-none tracking-tight"
                style={{ color: "#1b1b1b" }}
              >
                ОТ {formatAmount(pricing.monthly)} {pricing.suffix}/МЕС
              </p>
            ) : null}
            {card.period ? (
              <p
                className="shrink-0 rounded-full px-[15px] py-[3px] text-[12px] leading-none"
                style={{ background: CB_PALETTE.accent, color: "#ffffff" }}
              >
                {card.period}
              </p>
            ) : null}
          </div>
          {pricing.current ? (
            <p
              data-cb-native-current-price
              className="mt-3 text-[14px] leading-snug"
              style={{ color: "#686868" }}
            >
              или {formatAmount(pricing.current)} {pricing.suffix} при 100% оплате
            </p>
          ) : null}
        </div>

        <div className="mt-7 space-y-[10px]">
          {offers.map((offer) => (
            <Button
              key={offer.id}
              type="button"
              onClick={() => onSelectOffer(offer, tariff)}
              className="h-[62px] w-full whitespace-normal rounded-full border-2 px-4 text-[14px] font-bold uppercase leading-tight tracking-[0.01em] shadow-none hover:opacity-90"
              style={{ ...buttonStyle(offer), fontFamily: PRICE_FONT }}
            >
              {offer.button_label}
            </Button>
          ))}
        </div>

        {card.audience ? (
          <details className="group mt-6 text-[14px] leading-[1.45]" style={{ color: "#343434" }}>
            <summary className="flex cursor-pointer list-none items-center justify-center gap-3 text-[17px]">
              <span>{card.audienceTitle}</span>
              <span
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-full text-[21px] font-bold"
                style={{
                  background: CB_PALETTE.accent,
                  color: "#ffffff",
                  boxShadow: "0 8px 22px rgba(228,34,194,.2)",
                }}
              >
                ?
              </span>
            </summary>
            <p
              className="mt-4 rounded-[18px] border px-4 py-4"
              style={{
                background: "#ffffff",
                borderColor: "#eeeeee",
                boxShadow: "0 12px 30px rgba(27,27,27,.08)",
              }}
            >
              {card.audience}
            </p>
          </details>
        ) : null}
      </div>
    </article>
  );
}
