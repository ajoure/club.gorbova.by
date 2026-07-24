import { Button } from "@/components/ui/button";
import type { PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";
import { rec, CB_PALETTE } from "../manifest";

const ACTIONABLE_TYPES = new Set(["pay_now", "trial", "preregistration", "lead", "bank_installment", "invoice"]);

const tariffText = rec("rec1219722591").text;

const textAt = (index: number) => tariffText[index] ?? "";
const joinText = (...indices: number[]) => indices.map(textAt).filter(Boolean).join(" ");

const CARDS = [
  {
    title: textAt(8),
    oldPrice: textAt(51),
    monthly: textAt(52),
    fullPrice: textAt(53),
    period: textAt(57),
    core: [
      joinText(9, 10),
      joinText(11, 12),
      joinText(13, 14, 15),
      joinText(16, 17, 18),
      joinText(19, 20, 21, 22, 23),
      joinText(24, 25),
      textAt(26),
      joinText(27, 28, 29),
      joinText(30, 31, 32),
      joinText(33, 34, 35),
      joinText(36, 37),
    ],
    bonus: [joinText(39, 40), joinText(41, 42), joinText(43, 44), joinText(45, 46), joinText(47, 48), joinText(49, 50), joinText(54, 55), textAt(56)],
    audienceTitle: textAt(78),
    audience: textAt(79),
  },
  {
    title: textAt(61),
    oldPrice: textAt(113),
    monthly: textAt(114),
    fullPrice: textAt(115),
    period: textAt(116),
    core: [
      joinText(62, 63),
      joinText(64, 65),
      joinText(66, 67, 68),
      joinText(69, 70, 71),
      joinText(72, 73, 74, 75, 76, 77),
      joinText(80, 81),
      textAt(82),
      joinText(83, 84, 85),
      joinText(86, 87, 88),
      joinText(89, 90, 91),
      joinText(92, 93, 94),
      joinText(95, 96, 97),
      joinText(98, 99),
      joinText(100, 101, 102),
    ],
    bonus: [joinText(104, 105), joinText(106, 107), joinText(108, 109), joinText(110, 111), textAt(112)],
    audienceTitle: textAt(178),
    audience: [textAt(179), textAt(180), textAt(181)].filter(Boolean).join(" "),
  },
  {
    title: textAt(120),
    oldPrice: textAt(0),
    monthly: textAt(1),
    fullPrice: textAt(2),
    period: textAt(3),
    core: [
      joinText(121, 122),
      joinText(123, 124),
      joinText(125, 126, 127),
      joinText(128, 129, 130),
      joinText(131, 132, 133, 134, 135, 136),
      joinText(137, 138),
      textAt(139),
      joinText(140, 141, 142),
      joinText(143, 144, 145),
      joinText(146, 147, 148),
      joinText(149, 150, 151),
      joinText(152, 153, 154),
      joinText(155, 156, 157),
      joinText(158, 159, 160),
      joinText(165, 166),
      joinText(167, 168, 169, 170),
      joinText(171, 172, 173),
    ],
    bonus: [joinText(161, 162), joinText(163, 164)],
    audienceTitle: textAt(175),
    audience: [textAt(176), textAt(177)].filter(Boolean).join(" "),
  },
];

const buttonStyle = (offer: TariffOffer, index: number) => {
  const label = offer.button_label.toLowerCase();
  if (offer.offer_type === "pay_now" || label.includes("оплатить обучение")) {
    return { background: CB_PALETTE.accent, color: CB_PALETTE.bg, borderColor: CB_PALETTE.accent };
  }
  if (offer.offer_type === "preregistration" || label.includes("бронь")) {
    return { background: CB_PALETTE.bg, color: CB_PALETTE.accent, borderColor: CB_PALETTE.bg };
  }
  if (offer.offer_type === "bank_installment" || label.includes("рассроч")) {
    return { background: "#343434", color: CB_PALETTE.bg, borderColor: "#343434" };
  }
  if (offer.offer_type === "invoice" || label.includes("юрлиц")) {
    return { background: "#eb3d7f", color: CB_PALETTE.bg, borderColor: "#eb3d7f" };
  }
  return index === 0
    ? { background: CB_PALETTE.accent, color: CB_PALETTE.bg, borderColor: CB_PALETTE.accent }
    : { background: CB_PALETTE.bg, color: CB_PALETTE.accent, borderColor: CB_PALETTE.bg };
};

interface CbNativeTariffCardProps {
  tariff: PublicTariff;
  index: number;
  onSelectOffer: (offer: TariffOffer, tariff: PublicTariff) => void;
}

export function CbNativeTariffCard({ tariff, index, onSelectOffer }: CbNativeTariffCardProps) {
  const card = CARDS[index] ?? CARDS[0];
  const offers = (tariff.offers ?? [])
    .filter((offer) => offer.is_active !== false && ACTIONABLE_TYPES.has(offer.offer_type))
    .slice()
    .sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || a.id.localeCompare(b.id));

  return (
    <article className="flex h-full min-h-[1180px] flex-col rounded-[25px] border px-5 py-9 shadow-none" style={{ background: CB_PALETTE.bg, borderColor: "#ededed" }}>
      <h3 className="min-h-[72px] text-[29px] font-bold uppercase leading-[1.15]" style={{ color: CB_PALETTE.accent }}>
        {card.title}
      </h3>

      <ul className="mt-7 space-y-3 text-[15px] leading-[1.45]" style={{ color: "#000000" }}>
        {card.core.filter(Boolean).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="mt-7 rounded-[18px] px-5 py-5 text-[15px] leading-[1.45]" style={{ background: "#343434", color: CB_PALETTE.bg }}>
        <ul className="space-y-2">
          {card.bonus.filter(Boolean).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {card.audience && (
        <div className="mt-6 rounded-[18px] px-5 py-5 text-[14px] leading-[1.5]" style={{ background: CB_PALETTE.bgSoft, color: CB_PALETTE.text }}>
          {card.audienceTitle && <p className="mb-2 font-bold" style={{ color: CB_PALETTE.accent }}>{card.audienceTitle}</p>}
          <p>{card.audience}</p>
        </div>
      )}

      <div className="mt-auto pt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            {card.oldPrice && <p className="text-[28px] font-semibold leading-none line-through" style={{ color: "#1a1a1a" }}>{card.oldPrice}</p>}
            {card.monthly && <p className="mt-5 text-[24px] font-semibold uppercase leading-none" style={{ color: "#1e1e1e" }}>{card.monthly}</p>}
            {card.fullPrice && <p className="mt-3 text-[13px] leading-snug" style={{ color: CB_PALETTE.text }}>{card.fullPrice}</p>}
          </div>
          {card.period && <p className="pb-12 text-[13px]" style={{ color: CB_PALETTE.text }}>{card.period}</p>}
        </div>

        <div className="mt-7 space-y-[10px]">
          {offers.map((offer, offerIndex) => (
            <Button
              key={offer.id}
              type="button"
              onClick={() => onSelectOffer(offer, tariff)}
              className="h-[62px] w-full rounded-[18px] border text-[14px] font-bold uppercase shadow-none hover:opacity-90"
              style={buttonStyle(offer, offerIndex)}
            >
              {offer.button_label}
            </Button>
          ))}
        </div>
      </div>
    </article>
  );
}