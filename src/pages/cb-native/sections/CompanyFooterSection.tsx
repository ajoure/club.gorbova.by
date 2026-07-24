import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 11b — "Как открыть доступ" (rec776467190) + Компания / legal (rec1739234301).
 */
export function CompanyFooterSection() {
  const help = rec("rec776467190");
  const legal = rec("rec1739234301");

  return (
    <>
      <section
        id="rec776467190"
        className="py-16 lg:py-20"
        style={{ background: CB_PALETTE.bgSoft }}
      >
        <div className="mx-auto max-w-4xl px-5 text-center">
          <h2
            className="text-2xl sm:text-3xl font-semibold mb-4"
            style={{ color: CB_PALETTE.textStrong }}
          >
            {help.text[0] ?? "КАК ОТКРЫТЬ ДОСТУП"}
          </h2>
          <div className="space-y-2 text-sm sm:text-base" style={{ color: CB_PALETTE.text }}>
            {help.text.slice(1).map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </div>
        </div>
      </section>

      <footer
        id="rec1739234301"
        className="py-12"
        style={{ background: "#1b1b1b", color: "#f6f6f6" }}
      >
        <div className="mx-auto max-w-6xl px-5 space-y-2 text-xs sm:text-sm leading-relaxed">
          <div className="font-semibold uppercase tracking-wider mb-3" style={{ color: CB_PALETTE.accentSoft }}>
            {legal.text[0] ?? "КОМПАНИЯ"}
          </div>
          {legal.text.slice(1).map((t, i) => (
            <p key={i} className="opacity-80">
              {t}
            </p>
          ))}
        </div>
      </footer>
    </>
  );
}
