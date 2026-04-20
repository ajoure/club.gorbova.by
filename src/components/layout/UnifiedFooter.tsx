import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { BRAND_INFO, COMPANY_INFO, LEGAL_LINKS, FOOTER_ASSETS } from "./footerDefaults";

interface UnifiedFooterProps {
  /** Включить навигацию по якорям на главной странице */
  showAnchorNav?: boolean;
  /** Путь главной страницы для якорной навигации */
  homePath?: string;
}

export function UnifiedFooter({ 
  showAnchorNav = true, 
  homePath = "/" 
}: UnifiedFooterProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHomePage = location.pathname === homePath;

  // Handle scrolling to anchor after navigation
  useEffect(() => {
    if (isHomePage && location.hash) {
      const element = document.querySelector(location.hash);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    }
  }, [isHomePage, location.hash]);

  const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>, anchor: string) => {
    e.preventDefault();
    
    if (isHomePage) {
      const element = document.querySelector(anchor);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      navigate(homePath + anchor);
    }
  };

  return (
    <footer className="py-12 border-t border-border/50 bg-background/50">
      <div className="container mx-auto px-4">
        {/* Main footer content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Company info */}
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-3 mb-4 hover:opacity-80 transition-opacity w-fit">
              <img src={BRAND_INFO.logoUrl} alt={BRAND_INFO.name} className="h-8 w-auto" width={32} height={32} loading="lazy" />
              <div>
                <span className="font-bold text-foreground">{BRAND_INFO.name}</span>
                <span className="block text-xs text-muted-foreground">{BRAND_INFO.subtitle}</span>
              </div>
            </Link>
            
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">{COMPANY_INFO.name}</p>
              <p>УНП: {COMPANY_INFO.unp}</p>
              <p>Юр. адрес: {COMPANY_INFO.legalAddress}</p>
              <p>Почтовый адрес: {COMPANY_INFO.mailingAddress}</p>
              <p className="pt-2">
                <a href={COMPANY_INFO.phoneHref} className="hover:text-foreground transition-colors">
                  Телефон: {COMPANY_INFO.phone}
                </a>
              </p>
              <p>
                <a href={`mailto:${COMPANY_INFO.email}`} className="hover:text-foreground transition-colors">
                  E-mail: {COMPANY_INFO.email}
                </a>
              </p>
              <p>Режим работы: {COMPANY_INFO.workHours}</p>
            </div>
          </div>

          {/* Navigation links */}
          <div>
            <h4 className="font-semibold text-foreground mb-4">Навигация</h4>
            <nav className="flex flex-col gap-2 text-sm">
              {showAnchorNav && (
                <>
                  <a 
                    href="#benefits" 
                    onClick={(e) => handleAnchorClick(e, "#benefits")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Преимущества
                  </a>
                  <a 
                    href="#tariffs" 
                    onClick={(e) => handleAnchorClick(e, "#tariffs")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Тарифы
                  </a>
                  <a 
                    href="#faq" 
                    onClick={(e) => handleAnchorClick(e, "#faq")}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    FAQ
                  </a>
                </>
              )}
              <Link to="/contacts" className="text-muted-foreground hover:text-foreground transition-colors">
                Контакты
              </Link>
              <Link to="/help" className="text-muted-foreground hover:text-foreground transition-colors">
                Помощь
              </Link>
              <Link to="/auth" className="text-muted-foreground hover:text-foreground transition-colors">
                Вход
              </Link>
            </nav>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="font-semibold text-foreground mb-4">Документы</h4>
            <nav className="flex flex-col gap-2 text-sm">
              <Link to="/offer" className="text-muted-foreground hover:text-foreground transition-colors">
                Публичная оферта
              </Link>
              <Link to="/order-payment" className="text-muted-foreground hover:text-foreground transition-colors">
                Заказ и оплата услуг
              </Link>
              <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                Политика конфиденциальности
              </Link>
              <Link to="/consent" className="text-muted-foreground hover:text-foreground transition-colors">
                Согласие на обработку данных
              </Link>
            </nav>
          </div>
        </div>

        {/* Payment systems */}
        <div className="border-t border-border/50 pt-8 mb-8">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <Link to="/order-payment" className="opacity-70 hover:opacity-100 transition-opacity">
              <img 
                src={paymentSystemsImage} 
                alt="Принимаем к оплате: Visa, MasterCard, Белкарт, bePaid, Samsung Pay, Google Pay" 
                className="h-8 w-auto"
                width={347}
                height={32}
                loading="lazy"
              />
            </Link>
            <Link to="/order-payment" className="opacity-70 hover:opacity-100 transition-opacity">
              <img 
                src={eripLogoImage} 
                alt="Оплата через ЕРИП" 
                className="h-8 w-auto"
                width={64}
                height={32}
                loading="lazy"
              />
            </Link>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-border/50 pt-6 text-center">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} ЗАО «АЖУР инкам». Все права защищены.
          </p>
        </div>
      </div>
    </footer>
  );
}
