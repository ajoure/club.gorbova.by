import { Link } from "react-router-dom";
import logoImage from "@/assets/logo.png";
import paymentSystemsImage from "@/assets/payment-systems.png";
import eripLogoImage from "@/assets/erip-logo.png";

export function LandingFooter() {
  return (
    <footer className="py-12 border-t border-border/50 bg-background/50">
      <div className="container mx-auto px-4">
        {/* Main footer content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Company info */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <img src={logoImage} alt="Буква Закона" className="h-8 w-auto" />
              <div>
                <span className="font-bold text-foreground">БУКВА ЗАКОНА</span>
                <span className="block text-xs text-muted-foreground">Клуб по законодательству</span>
              </div>
            </div>
            
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">ЗАО «АЖУР инкам»</p>
              <p>УНП: 193405000</p>
              <p>Юр. адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л</p>
              <p>Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63</p>
              <p className="pt-2">
                <a href="tel:+375447594321" className="hover:text-foreground transition-colors">
                  Телефон: +375 44 759-43-21
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

          {/* Navigation links */}
          <div>
            <h4 className="font-semibold text-foreground mb-4">Навигация</h4>
            <nav className="flex flex-col gap-2 text-sm">
              <a href="#benefits" className="text-muted-foreground hover:text-foreground transition-colors">
                Преимущества
              </a>
              <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                Тарифы
              </a>
              <a href="#faq" className="text-muted-foreground hover:text-foreground transition-colors">
                FAQ
              </a>
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
