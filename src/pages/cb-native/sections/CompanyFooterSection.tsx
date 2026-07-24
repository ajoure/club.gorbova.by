import { rec, CB_PALETTE } from "../manifest";

/**
 * Section 11b — "Как открыть доступ" (rec776467190) + Legal footer (rec1739234301).
 * Content, links and logos come strictly from cbold_manifest.json.
 */
export function CompanyFooterSection() {
  const help = rec("rec776467190");
  const legal = rec("rec1739234301");

  const helpTitle = help.text[0] ?? "КАК ОТКРЫТЬ ДОСТУП";
  const helpSubtitle = help.text[1] ?? "";
  const helpBody = help.text[2] ?? "";
  const helpCtaLabel = help.text[3] ?? "Скачать";
  const helpCtaHref = help.cta_links[0] ?? "#";
  const helpLogo = help.images.find((src) => /logotypes-transparen|HORIZONTAL_COLOR/i.test(src))
    ?? help.images.find((src) => src.endsWith(".png") || src.endsWith(".webp"))
    ?? "";

  // Legal block — exact cbold order.
  const companyTitle = legal.text[0] ?? "КОМПАНИЯ";
  const companyLines = legal.text.slice(1, 8); // t1..t7
  const infoTitle = legal.text[8] ?? "ИНФОРМАЦИЯ";
  const linkLabels = [legal.text[9] ?? "Публичная оферта", legal.text[10] ?? "Заказ и оплата"];
  const copyrightLines = legal.text.slice(11, 17); // t11..t16
  const brandLabel = legal.text[17] ?? "KATERINA GORBOVA";

  const ctaLinks = legal.cta_links;
  const legalLinks = [
    { label: linkLabels[0], href: ctaLinks[0] ?? "#" },
    { label: linkLabels[1], href: ctaLinks[1] ?? "#" },
  ];
  const socialLinks = [
    { label: "Instagram", href: ctaLinks[2] ?? "#", icon: legal.images.find((s) => /instagram\.svg/i.test(s)) ?? "" },
    { label: "Telegram", href: ctaLinks[3] ?? "#", icon: legal.images.find((s) => /noroot\.png/i.test(s)) ?? "" },
  ];
  const footerLogo =
    legal.images.find((s) => /HORIZONTAL_COLOR/i.test(s) && s.endsWith(".webp"))
    ?? legal.images.find((s) => /HORIZONTAL_COLOR/i.test(s))
    ?? "";
  const partnerLogo = legal.images.find((s) => /logotypes-transparen/i.test(s)) ?? "";

  return (
    <>
      <section
        id="rec776467190"
        data-cb-native-section="help"
        className="py-16 lg:py-20"
        style={{ background: CB_PALETTE.bgSoft }}
      >
        <div className="mx-auto grid max-w-4xl gap-6 px-5 md:grid-cols-[auto_1fr] md:items-center">
          {helpLogo && (
            <img
              src={helpLogo}
              alt=""
              aria-hidden
              data-cb-native-help-logo
              className="mx-auto h-20 w-20 object-contain md:h-24 md:w-24"
            />
          )}
          <div className="text-center md:text-left">
            <h2
              className="text-2xl font-bold uppercase leading-tight sm:text-3xl"
              style={{ color: CB_PALETTE.textStrong }}
            >
              {helpTitle}
            </h2>
            {helpSubtitle && (
              <p
                className="mt-1 text-base sm:text-lg"
                style={{ color: CB_PALETTE.text }}
              >
                {helpSubtitle}
              </p>
            )}
            {helpBody && (
              <p className="mt-4 text-sm sm:text-base" style={{ color: CB_PALETTE.text }}>
                {helpBody}
              </p>
            )}
            <a
              href={helpCtaHref}
              target="_blank"
              rel="noopener noreferrer"
              data-cb-native-help-cta
              className="mt-5 inline-flex h-[54px] items-center justify-center rounded-[28px] px-8 text-[14px] font-bold uppercase tracking-wide transition hover:opacity-90"
              style={{ background: CB_PALETTE.accent, color: CB_PALETTE.bg }}
            >
              {helpCtaLabel}
            </a>
          </div>
        </div>
      </section>

      <footer
        id="rec1739234301"
        data-cb-native-section="footer"
        className="py-14"
        style={{ background: "#1b1b1b", color: "#f6f6f6" }}
      >
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid gap-10 md:grid-cols-3">
            <div data-cb-native-footer-col="company">
              <h3
                className="mb-4 text-sm font-bold uppercase tracking-[0.18em]"
                style={{ color: CB_PALETTE.accentSoft }}
              >
                {companyTitle}
              </h3>
              <div className="space-y-1.5 text-xs leading-relaxed opacity-85 sm:text-sm">
                {companyLines.map((t, i) => (
                  <p key={i} data-cb-native-footer-legal-line>
                    {t}
                  </p>
                ))}
              </div>
            </div>

            <div data-cb-native-footer-col="info">
              <h3
                className="mb-4 text-sm font-bold uppercase tracking-[0.18em]"
                style={{ color: CB_PALETTE.accentSoft }}
              >
                {infoTitle}
              </h3>
              <ul className="space-y-2 text-sm">
                {legalLinks.map((l, i) => (
                  <li key={i}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-cb-native-footer-link
                      className="underline-offset-2 hover:underline"
                      style={{ color: "#f6f6f6" }}
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex items-center gap-3">
                {socialLinks.map((s, i) => (
                  <a
                    key={i}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    data-cb-native-footer-social
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:opacity-80"
                    style={{ background: "#2a2a2a" }}
                  >
                    {s.icon ? (
                      <img
                        src={s.icon}
                        alt=""
                        aria-hidden
                        data-cb-native-footer-social-icon
                        className="h-5 w-5 object-contain"
                        style={{ filter: "brightness(0) invert(1)" }}
                      />
                    ) : (
                      <span className="text-xs">{s.label[0]}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>

            <div data-cb-native-footer-col="brand" className="md:text-right">
              {footerLogo && (
                <img
                  src={footerLogo}
                  alt={brandLabel}
                  data-cb-native-footer-logo
                  className="mb-4 h-16 w-auto object-contain md:ml-auto"
                />
              )}
              <p
                className="text-sm font-semibold uppercase tracking-[0.2em]"
                style={{ color: CB_PALETTE.accentSoft }}
              >
                {brandLabel}
              </p>
              {partnerLogo && (
                <img
                  src={partnerLogo}
                  alt=""
                  aria-hidden
                  data-cb-native-footer-partner-logo
                  className="mt-4 h-8 w-auto object-contain opacity-80 md:ml-auto"
                />
              )}
            </div>
          </div>

          <div
            className="mt-10 border-t pt-6 text-xs leading-relaxed opacity-70"
            style={{ borderColor: "#2a2a2a" }}
          >
            <p data-cb-native-footer-copyright>
              {copyrightLines.slice(0, 3).join(" ")}
            </p>
            {copyrightLines.slice(3).map((t, i) => (
              <p key={i} className="mt-1" data-cb-native-footer-copyright>
                {t}
              </p>
            ))}
          </div>
        </div>
      </footer>
    </>
  );
}
