/**
 * Native tariff card for /cb-native-preview.
 *
 * Text/visual source of truth (verbatim, char-for-char):
 *   src/pages/cb-native/cbold_manifest.json → rec1219722591.text (182 lines)
 *
 * Rules:
 *  - No paraphrasing/reordering. Every displayed string is a slice of manifest text.
 *  - Prices come from the manifest (static display), same as live Tilda card.
 *  - CTA labels come from backend offers (usePublicProduct → tariff.offers),
 *    forced into the canonical Tilda order:
 *      1) pay_now              → ОПЛАТИТЬ ОБУЧЕНИЕ
 *      2) preregistration      → ВНЕСТИ БРОНЬ 100BYN
 *      3) bank_installment     → ЗАЯВКА НА РАССРОЧКУ
 *      4) invoice              → ОПЛАТИТЬ ОТ ЮРЛИЦА
 *    Uppercase is CSS, not a hardcoded literal — real labels remain whatever
 *    backend returns; we only sort + text-transform.
 *  - Fonts: 'PT Sans' + 'Sf-pro-display' (live Tilda tariff block), NOT Comfortaa.
 */
import { Button } from "@/components/ui/button";
import type { PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";
import { rec, CB_PALETTE } from "../manifest";

const ACTIONABLE_TYPES = new Set([
  "pay_now",
  "trial",
  "preregistration",
  "lead",
  "bank_installment",
  "invoice",
]);

// Fixed Tilda CTA order.
const CTA_ORDER: Record<string, number> = {
  pay_now: 0,
  preregistration: 1,
  lead: 2, // some deployments use `lead` for bank rassrochka
  bank_installment: 2,
  invoice: 3,
};

const TARIFF_FONT =
  "'PT Sans','Sf-pro-display','Segoe UI',Arial,sans-serif";
const PRICE_FONT =
  "'Sf-pro-display','PT Sans','Segoe UI',Arial,sans-serif";

// --- Verbatim strings from rec1219722591.text (indices are stable) ---
const T = rec("rec1219722591").text;
const t = (i: number) => T[i] ?? "";

type Bullet = { bold?: string; text?: string };
type BonusItem = { badge?: "VIP" | "Grand" | "Business"; cert?: boolean; text: string };

type CardData = {
  title: string;
  core: Bullet[];
  bonus: BonusItem[];
  audienceTitle: string;
  audience: string;
  oldPrice: string;
  monthly: string;
  fullPrice: string;
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
      { text: t(20) },                                // Доступ к клубу «Буква закона»
      { bold: t(22), text: t(23) },                   // Доступ 6 месяцев / после окончания курса
      { text: t(25) },                                // 5 практических конференций с Катериной
      { text: t(26).replace(/^→\s*/, "") },           // Итоговый конспект для удобной работы
    ],
    bonus: [
      { badge: "VIP", text: t(29) },                  // «Делегирование»
      { badge: "VIP", text: t(32) },                  // «Найм, адаптация и удержание персонала»
      { badge: "VIP", text: t(35) },                  // «Таймлайн месяца»
      { cert: true, text: `${t(36).replace(/^→\s*/, "")} ${t(37)}` },
      { badge: "Grand", text: t(40) },                // «Налоговое законодательство Беларуси»
      { badge: "Grand", text: t(42) },                // «Система в бухгалтерии»
      { badge: "Business", text: t(44) },             // «Экспресс-аудит»
      { badge: "Business", text: t(46) },             // «Восстановление учета»
      { text: `${t(47)} ${t(48)}` },                  // Скидка 50% на модули…
      { text: `${t(49)} ${t(50)}` },                  // Дополнительная живая встреча…
      { text: `${t(54)} ${t(55)}` },                  // Письменная характеристика для работодателя
      { text: t(56) },                                // Личная рекомендация Катерины…
    ],
    audienceTitle: t(78),
    audience: t(79),
    oldPrice: t(51), // 1690 BYN
    monthly: t(52), // ОТ 136 BYN/МЕС
    fullPrice: t(53), // или 1490 BYN при 100% оплате
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
      { text: t(81) },                                // 6 практических конференций с Катериной
      { text: t(82).replace(/^→\s*/, "") },           // Итоговый конспект…
    ],
    bonus: [
      { badge: "VIP", text: t(85) },                  // «Делегирование»
      { badge: "VIP", text: t(88) },                  // «Найм, адаптация и удержание персонала»
      { badge: "VIP", text: t(91) },                  // «Таймлайн месяца»
      { badge: "Grand", text: t(94) },                // «Налоговое законодательство Беларуси»
      { badge: "Grand", text: t(97) },                // «Система в бухгалтерии»
      { cert: true, text: `${t(98).replace(/^→\s*/, "")} ${t(99)}` },
      { text: `${t(101)} ${t(102)}` },                // Письменная характеристика для работодателя
      { badge: "Business", text: t(105) },            // «Экспресс-аудит»
      { badge: "Business", text: t(107) },            // «Восстановление учета»
      { text: `${t(108)} ${t(109)}` },                // Скидка 50% на модули…
      { text: `${t(110)} ${t(111)}` },                // Дополнительная живая встреча…
      { text: t(112) },                               // Личная рекомендация Катерины…
    ],
    audienceTitle: t(178),
    audience: [t(179), t(180), t(181)].filter(Boolean).join(" "),
    oldPrice: t(113), // 1990 BYN
    monthly: t(114), // ОТ 163 BYN/МЕС
    fullPrice: t(115), // или 1790 BYN при 100% оплате
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
      { text: t(138) },                               // 6 практических конференций с Катериной
      { text: t(139).replace(/^→\s*/, "") },          // Итоговый конспект…
    ],
    bonus: [
      { badge: "VIP", text: t(142) },
      { badge: "VIP", text: t(145) },
      { badge: "VIP", text: t(148) },
      { badge: "Grand", text: t(151) },
      { badge: "Grand", text: t(154) },
      { badge: "Business", text: t(157) },
      { badge: "Business", text: t(160) },
      { text: `${t(161)} ${t(162)}` },                // Скидка 50%…
      { text: `${t(163)} ${t(164)}` },                // Дополнительная живая встреча…
      { cert: true, text: `${t(165).replace(/^→\s*/, "")} ${t(166)}` },
      { text: `${t(168)} ${t(169)} ${t(170)}` },      // Письменная характеристика для работодателя и клиента
      { text: `${t(172)} ${t(173)}` },                // Личная рекомендация Катерины по итогам…
    ],
    audienceTitle: t(175),
    audience: [t(176), t(177)].filter(Boolean).join(" "),
    oldPrice: t(0),  // 2690 BYN
    monthly: t(1),   // ОТ 227 BYN/МЕС
    fullPrice: t(2), // или 2490 BYN при 100% оплате
    period: t(3),    // 12 мес
  },
];

// ── CTA appearance mirrors live Tilda ─────────────────────────
const buttonStyle = (offer: TariffOffer, index: number) => {
  const label = (offer.button_label ?? "").toLowerCase();
  if (offer.offer_type === "pay_now" || label.includes("оплатить обучение")) {
    return { background: CB_PALETTE.accent, color: "#ffffff", borderColor: CB_PALETTE.accent };
  }
  if (offer.offer_type === "preregistration" || label.includes("бронь")) {
    return {
      background: "#ffffff",
      color: CB_PALETTE.accent,
      borderColor: CB_PALETTE.accent,
    };
  }
  if (
    offer.offer_type === "bank_installment" ||
    offer.offer_type === "lead" ||
    label.includes("рассроч")
  ) {
    return { background: "#343434", color: "#ffffff", borderColor: "#343434" };
  }
  if (offer.offer_type === "invoice" || label.includes("юрлиц")) {
    return { background: "#1b1b1b", color: "#ffffff", borderColor: "#1b1b1b" };
  }
  return index === 0
    ? { background: CB_PALETTE.accent, color: "#ffffff", borderColor: CB_PALETTE.accent }
    : { background: "#ffffff", color: CB_PALETTE.accent, borderColor: CB_PALETTE.accent };
};

// Badge chip colors (VIP / Grand / Business).
const badgeStyle = (b: NonNullable<BonusItem["badge"]>) => {
  switch (b) {
    case "VIP":
      return { background: "#ffffff", color: "#1b1b1b" };
    case "Grand":
      return { background: CB_PALETTE.accent, color: "#ffffff" };
    case "Business":
      return { background: "#f9aeff", color: "#1b1b1b" };
  }
};

interface CbNativeTariffCardProps {
  tariff: PublicTariff;
  index: number;
  onSelectOffer: (offer: TariffOffer, tariff: PublicTariff) => void;
}

export function CbNativeTariffCard({ tariff, index, onSelectOffer }: CbNativeTariffCardProps) {
  const card = CARDS[index] ?? CARDS[0];

  const offers = (tariff.offers ?? [])
    .filter((o) => o.is_active !== false && ACTIONABLE_TYPES.has(o.offer_type))
    .slice()
    .sort((a, b) => {
      const oa = CTA_ORDER[a.offer_type] ?? 99;
      const ob = CTA_ORDER[b.offer_type] ?? 99;
      if (oa !== ob) return oa - ob;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });

  return (
    <article
      className="flex h-full flex-col rounded-[20px] border shadow-none"
      style={{
        background: "#ffffff",
        borderColor: "#ededed",
        fontFamily: TARIFF_FONT,
        padding: "36px 28px 32px",
      }}
    >
      {/* Title */}
      <h3
        className="text-[26px] font-bold uppercase leading-[1.15] tracking-[-0.01em]"
        style={{ color: CB_PALETTE.accent, fontFamily: PRICE_FONT }}
      >
        {card.title}
      </h3>

      {/* Core bullets with arrow prefix, bold + regular runs */}
      <ul className="mt-6 space-y-[10px] text-[15px] leading-[1.5]" style={{ color: "#1b1b1b" }}>
        {card.core.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden style={{ color: CB_PALETTE.accent, fontWeight: 700 }}>→</span>
            <span>
              {b.bold ? <strong className="font-bold">{b.bold}</strong> : null}
              {b.bold && b.text ? " " : null}
              {b.text}
            </span>
          </li>
        ))}
      </ul>

      {/* Dark certificate/bonus block */}
      <div
        className="mt-6 rounded-[14px] text-[14px] leading-[1.5]"
        style={{ background: "#1b1b1b", color: "#ffffff", padding: "18px 18px" }}
      >
        <ul className="space-y-[9px]">
          {card.bonus.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              {b.badge && (
                <span
                  className="mt-[2px] shrink-0 rounded-[6px] px-[8px] py-[2px] text-[11px] font-bold uppercase tracking-wide"
                  style={badgeStyle(b.badge)}
                >
                  {b.badge}
                </span>
              )}
              {b.cert && (
                <span
                  className="mt-[2px] shrink-0 rounded-[6px] px-[8px] py-[2px] text-[11px] font-bold uppercase tracking-wide"
                  style={{ background: CB_PALETTE.accent, color: "#ffffff" }}
                >
                  Сертификат
                </span>
              )}
              <span className={b.badge ? "font-bold" : b.cert ? "" : ""}>{b.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Для кого? — audience */}
      {card.audience && (
        <div
          className="mt-5 rounded-[14px] text-[13px] leading-[1.55]"
          style={{ background: "#f6f6f6", color: "#343434", padding: "16px 18px" }}
        >
          {card.audienceTitle && (
            <p className="mb-2 font-bold uppercase" style={{ color: CB_PALETTE.accent }}>
              {card.audienceTitle}
            </p>
          )}
          <p>{card.audience}</p>
        </div>
      )}

      {/* Price block */}
      <div className="mt-auto pt-8" style={{ fontFamily: PRICE_FONT }}>
        <div className="flex items-end justify-between gap-4">
          <div>
            {card.oldPrice && (
              <p
                className="text-[22px] font-semibold leading-none line-through"
                style={{ color: "#8a8a8a" }}
              >
                {card.oldPrice}
              </p>
            )}
            {card.monthly && (
              <p
                className="mt-3 text-[26px] font-bold uppercase leading-none tracking-tight"
                style={{ color: "#1b1b1b" }}
              >
                {card.monthly}
              </p>
            )}
            {card.fullPrice && (
              <p className="mt-2 text-[13px] leading-snug" style={{ color: "#686868" }}>
                {card.fullPrice}
              </p>
            )}
          </div>
          {card.period && (
            <p className="pb-1 text-[13px]" style={{ color: "#686868" }}>
              {card.period}
            </p>
          )}
        </div>

        {/* CTAs (fixed order, uppercase via CSS, backend labels preserved) */}
        <div className="mt-6 space-y-[10px]">
          {offers.map((offer, offerIndex) => (
            <Button
              key={offer.id}
              type="button"
              onClick={() => onSelectOffer(offer, tariff)}
              className="h-[54px] w-full rounded-[12px] border-2 text-[13px] font-bold uppercase tracking-[0.02em] shadow-none hover:opacity-90"
              style={{ ...buttonStyle(offer, offerIndex), fontFamily: PRICE_FONT }}
            >
              {offer.button_label}
            </Button>
          ))}
        </div>
      </div>
    </article>
  );
}
