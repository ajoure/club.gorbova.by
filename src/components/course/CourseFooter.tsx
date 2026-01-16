import { Link, useNavigate } from "react-router-dom";
import logoImage from "@/assets/logo.png";
import paymentSystemsImage from "@/assets/payment-systems.png";
import eripLogoImage from "@/assets/erip-logo.png";

const NAV_SECTIONS = [
  { id: "audience", label: "Для кого" },
  { id: "program", label: "Программа" },
  { id: "expert", label: "Эксперт" },
  { id: "benefits", label: "Результат" },
  { id: "pricing", label: "Тарифы" },
];

export function CourseFooter() {
  const navigate = useNavigate();

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <footer className="py-12 border-t border-border/50 bg-background/50">
      <div className="container mx-auto px-4">
        {/* Main footer content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Company info */}
          <div className="lg:col-span-2">
            <a 
              href="https://club.gorbova.by" 
              className="flex items-center gap-3 mb-4 hover:opacity-80 transition-opacity w-fit"
            >
              <img src={logoImage} alt="Буква Закона" className="h-8 w-auto" />
              <div>
                <span className="font-bold text-foreground">БУКВА ЗАКОНА</span>
                <span className="block text-xs text-muted-foreground">Клуб по законодательству</span>
              </div>
            </a>
            
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">ЗАО «АЖУР инкам»</p>
              <p>УНП: 193405000</p>
              <p>Юр. адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л</p>
              <p>Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63</p>
              <p className="pt-2">
                <a href="tel:+375291714321" className="hover:text-foreground transition-colors">
                  Телефон: +375 29 171-43-21
                </a>
              </p>
              <p>
                <a href="mailto:info@ajoure.by" className="hover:text-foreground transition-colors">
                  E-mail: info@ajoure.by
                </a>
              </p>
              <p>Режим работы: Пн–Пт 9:00–18:00 (Минск)</p>
            </div>
          </div>

          {/* Course Navigation */}
          <div>
            <h4 className="font-semibold text-foreground mb-4">Навигация</h4>
            <nav className="flex flex-col gap-2 text-sm">
              {NAV_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors text-left"
                >
                  {section.label}
                </button>
              ))}
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
              />
            </Link>
            <Link to="/order-payment" className="opacity-70 hover:opacity-100 transition-opacity">
              <img 
                src={eripLogoImage} 
                alt="Оплата через ЕРИП" 
                className="h-8 w-auto"
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
