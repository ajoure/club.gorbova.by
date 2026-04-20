import { Link } from "react-router-dom";
import { FOOTER_ASSETS, buildFooterDefaultContent, type FooterBlockContent, type FooterNavItem } from "@/components/layout/footerDefaults";

interface FooterSectionProps {
  content: Record<string, unknown>;
}

function normalize(content: Record<string, unknown>): FooterBlockContent {
  const d = buildFooterDefaultContent();
  return {
    brand: { ...d.brand, ...((content.brand as object) ?? {}) } as FooterBlockContent["brand"],
    company: { ...d.company, ...((content.company as object) ?? {}) } as FooterBlockContent["company"],
    navigation: { ...d.navigation, ...((content.navigation as object) ?? {}) } as FooterBlockContent["navigation"],
    legal: { ...d.legal, ...((content.legal as object) ?? {}) } as FooterBlockContent["legal"],
    social: { ...d.social, ...((content.social as object) ?? {}) } as FooterBlockContent["social"],
    payments: { ...d.payments, ...((content.payments as object) ?? {}) } as FooterBlockContent["payments"],
    copyright: { ...d.copyright, ...((content.copyright as object) ?? {}) } as FooterBlockContent["copyright"],
  };
}

function isExternal(href: string) {
  return /^https?:\/\//i.test(href);
}

function FooterLink({ item }: { item: FooterNavItem }) {
  const cls = "text-muted-foreground hover:text-foreground transition-colors";
  const target = item.openInNewTab ? "_blank" : undefined;
  const rel = item.openInNewTab ? "noopener noreferrer" : undefined;

  if (isExternal(item.href) || target) {
    return <a href={item.href} target={target} rel={rel} className={cls}>{item.label}</a>;
  }
  return <Link to={item.href} className={cls}>{item.label}</Link>;
}

export function FooterSection({ content }: FooterSectionProps) {
  const data = normalize(content);

  const anyVisible =
    data.brand.showBrand ||
    data.company.showCompany ||
    data.navigation.showNavigation ||
    data.legal.showLegal ||
    data.social.showSocial ||
    data.payments.showPayments ||
    data.copyright.showCopyright;

  if (!anyVisible) return null;

  const copyrightText = data.copyright.text?.trim()
    ? data.copyright.text
    : `© ${new Date().getFullYear()} ${data.company.name}. Все права защищены.`;

  return (
    <footer className="py-12 border-t border-border/50 bg-background/50">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {(data.brand.showBrand || data.company.showCompany) && (
            <div className="lg:col-span-2">
              {data.brand.showBrand && (
                <div className="flex items-center gap-3 mb-4 w-fit">
                  {data.brand.logoUrl && (
                    <img src={data.brand.logoUrl} alt={data.brand.name} className="h-8 w-auto" width={32} height={32} loading="lazy" />
                  )}
                  <div>
                    {data.brand.name && <span className="font-bold text-foreground">{data.brand.name}</span>}
                    {data.brand.subtitle && <span className="block text-xs text-muted-foreground">{data.brand.subtitle}</span>}
                  </div>
                </div>
              )}
              {data.brand.showBrand && data.brand.description && (
                <p className="text-sm text-muted-foreground mb-4">{data.brand.description}</p>
              )}

              {data.company.showCompany && (
                <div className="text-sm text-muted-foreground space-y-1">
                  {data.company.name && <p className="font-medium text-foreground">{data.company.name}</p>}
                  {data.company.unp && <p>УНП: {data.company.unp}</p>}
                  {data.company.legalAddress && <p>Юр. адрес: {data.company.legalAddress}</p>}
                  {data.company.mailingAddress && <p>Почтовый адрес: {data.company.mailingAddress}</p>}
                  {data.company.phone && (
                    <p className="pt-2">
                      <a href={data.company.phoneHref || `tel:${data.company.phone.replace(/\s/g, "")}`} className="hover:text-foreground transition-colors">
                        Телефон: {data.company.phone}
                      </a>
                    </p>
                  )}
                  {data.company.email && (
                    <p>
                      <a href={`mailto:${data.company.email}`} className="hover:text-foreground transition-colors">
                        E-mail: {data.company.email}
                      </a>
                    </p>
                  )}
                  {data.company.workHours && <p>Режим работы: {data.company.workHours}</p>}
                </div>
              )}
            </div>
          )}

          {data.navigation.showNavigation && data.navigation.items.length > 0 && (
            <div>
              {data.navigation.title && <h4 className="font-semibold text-foreground mb-4">{data.navigation.title}</h4>}
              <nav className="flex flex-col gap-2 text-sm">
                {data.navigation.items.map((item, i) => <FooterLink key={i} item={item} />)}
              </nav>
            </div>
          )}

          {data.legal.showLegal && data.legal.items.length > 0 && (
            <div>
              {data.legal.title && <h4 className="font-semibold text-foreground mb-4">{data.legal.title}</h4>}
              <nav className="flex flex-col gap-2 text-sm">
                {data.legal.items.map((item, i) => <FooterLink key={i} item={item} />)}
              </nav>
            </div>
          )}
        </div>

        {data.social.showSocial && data.social.items.length > 0 && (
          <div className="border-t border-border/50 pt-8 mb-8">
            {data.social.title && <h4 className="font-semibold text-foreground mb-4 text-center">{data.social.title}</h4>}
            <div className="flex flex-wrap items-center justify-center gap-3">
              {data.social.items.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-full border hover:bg-muted transition-colors text-sm text-foreground">
                  {s.label || s.platform}
                </a>
              ))}
            </div>
          </div>
        )}

        {data.payments.showPayments && (
          <div className="border-t border-border/50 pt-8 mb-8">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <Link to="/order-payment" className="opacity-70 hover:opacity-100 transition-opacity">
                <img src={FOOTER_ASSETS.paymentSystems} alt="Принимаем к оплате: Visa, MasterCard, Белкарт, bePaid, Samsung Pay, Google Pay" className="h-8 w-auto" width={347} height={32} loading="lazy" />
              </Link>
              <Link to="/order-payment" className="opacity-70 hover:opacity-100 transition-opacity">
                <img src={FOOTER_ASSETS.erip} alt="Оплата через ЕРИП" className="h-8 w-auto" width={64} height={32} loading="lazy" />
              </Link>
            </div>
          </div>
        )}

        {data.copyright.showCopyright && (
          <div className="border-t border-border/50 pt-6 text-center">
            <p className="text-sm text-muted-foreground">{copyrightText}</p>
          </div>
        )}
      </div>
    </footer>
  );
}
