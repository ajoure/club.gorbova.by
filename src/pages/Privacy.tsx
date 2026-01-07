import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { Shield, FileText, Lock, Eye, Trash2, UserCheck, Globe, Mail, Building2 } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />
      
      <main className="container mx-auto px-4 py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ</h1>
          <p className="text-muted-foreground text-center mb-2">
            и обработки персональных данных
          </p>
          <p className="text-muted-foreground text-center mb-12">
            Закрытое акционерное общество «АЖУР инкам» (далее — Оператор)
          </p>
          
          <div className="space-y-6">
            {/* 1. Общие положения */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">1. Общие положения</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>
                      1.1. Настоящая Политика конфиденциальности и обработки персональных данных (далее — Политика) 
                      определяет порядок обработки и защиты персональных данных пользователей сайта{" "}
                      <a href="https://club.gorbova.by" className="text-primary hover:underline">club.gorbova.by</a>.
                    </p>
                    <p>
                      1.2. Политика разработана в соответствии с:
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Законом Республики Беларусь от 07.05.2021 № 99-З «О защите персональных данных»;</li>
                      <li>иными нормативными правовыми актами Республики Беларусь.</li>
                    </ul>
                    <p>
                      1.3. <strong>Оператор персональных данных:</strong><br />
                      Закрытое акционерное общество «АЖУР инкам»,<br />
                      УНП 193405000,<br />
                      юридический адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л,<br />
                      почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63,<br />
                      e-mail: <a href="mailto:info@ajoure.by" className="text-primary hover:underline">info@ajoure.by</a>,<br />
                      телефон: <a href="tel:+375447594321" className="text-primary hover:underline">+375 44 759-43-21</a>
                    </p>
                    <p>
                      1.4. Пользователь — физическое лицо, использующее Сайт.
                    </p>
                    <p>
                      1.5. Использование Сайта означает согласие Пользователя с настоящей Политикой.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 2. Персональные данные */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">2. Персональные данные, подлежащие обработке</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Оператор обрабатывает следующие персональные данные:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>фамилия, имя;</li>
                      <li>адрес электронной почты;</li>
                      <li>номер телефона;</li>
                      <li>данные учетной записи (логин, идентификаторы);</li>
                      <li>сведения о заказах, оплатах, подписках, тарифах;</li>
                      <li>Telegram ID (при добровольной привязке);</li>
                      <li>технические данные (IP-адрес, cookies, сведения о браузере и устройстве).</li>
                    </ul>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 3. Цели обработки */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Eye className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">3. Цели обработки персональных данных</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Персональные данные обрабатываются в целях:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>регистрации и авторизации Пользователя;</li>
                      <li>предоставления доступа к услугам и продуктам;</li>
                      <li>исполнения договоров и подписок;</li>
                      <li>приема и обработки платежей, возвратов;</li>
                      <li>взаимодействия с Пользователем (уведомления, поддержка);</li>
                      <li>соблюдения требований законодательства;</li>
                      <li>бухгалтерского и налогового учета;</li>
                      <li>предотвращения мошенничества.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 4. Правовые основания */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">4. Правовые основания обработки</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Обработка персональных данных осуществляется на основании:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>согласия Пользователя;</li>
                      <li>заключения и исполнения договора;</li>
                      <li>требований законодательства Республики Беларусь.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 5. Порядок обработки и хранения */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Lock className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">5. Порядок обработки и хранения</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>
                      5.1. Обработка персональных данных осуществляется с использованием автоматизированных 
                      и неавтоматизированных средств.
                    </p>
                    <p>
                      5.2. Оператор принимает необходимые организационные и технические меры для защиты 
                      персональных данных от несанкционированного доступа.
                    </p>
                    <p>
                      5.3. Срок хранения персональных данных определяется целями обработки и требованиями законодательства.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 6. Передача третьим лицам */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Globe className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">6. Передача персональных данных третьим лицам</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>6.1. Персональные данные могут передаваться:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>платежным системам (BePaid, ЕРИП);</li>
                      <li>банкам-эквайерам (ОАО «Паритетбанк»);</li>
                      <li>CRM-системам;</li>
                      <li>сервисам уведомлений и рассылок;</li>
                      <li>иным контрагентам, участвующим в оказании услуг.</li>
                    </ul>
                    <p>
                      6.2. Передача осуществляется с соблюдением требований законодательства и договорных обязательств.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 7. Права пользователя */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <UserCheck className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">7. Права Пользователя</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Пользователь имеет право:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>получать информацию о своих персональных данных;</li>
                      <li>требовать их уточнения, блокирования или удаления;</li>
                      <li>отзывать согласие на обработку персональных данных;</li>
                      <li>обращаться с жалобами в уполномоченные органы.</li>
                    </ul>
                    <p className="mt-3">
                      Запросы направляются на e-mail:{" "}
                      <a href="mailto:info@ajoure.by" className="text-primary hover:underline">info@ajoure.by</a>.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 8. Сроки хранения */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Trash2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">8. Сроки хранения и удаление данных</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>
                      Персональные данные хранятся в течение срока, необходимого для достижения целей обработки, 
                      но не менее сроков, установленных законодательством.
                    </p>
                    <p>
                      После прекращения использования Сервиса данные могут храниться в архивных целях 
                      в течение 3 лет, если иное не предусмотрено законодательством.
                    </p>
                    <p>
                      Пользователь может запросить удаление своих данных, направив письмо на{" "}
                      <a href="mailto:info@ajoure.by" className="text-primary hover:underline">info@ajoure.by</a>.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* 9. Заключительные положения */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">9. Заключительные положения</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>
                      9.1. Оператор вправе изменять Политику без предварительного уведомления.
                    </p>
                    <p>
                      9.2. Актуальная версия Политики размещается на Сайте.
                    </p>
                    <p className="text-sm mt-4 pt-4 border-t border-border/50">
                      <strong>Версия:</strong> v2026-01-07<br />
                      <strong>Дата последнего обновления:</strong> 7 января 2026 года
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Контакты */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">Контактная информация</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p><strong>ЗАО «АЖУР инкам»</strong></p>
                    <p>УНП: 193405000</p>
                    <p>Юридический адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л</p>
                    <p>Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63</p>
                    <div className="flex flex-col sm:flex-row gap-4 mt-4">
                      <a href="tel:+375447594321" className="text-primary hover:underline">
                        +375 44 759-43-21
                      </a>
                      <a href="mailto:info@ajoure.by" className="text-primary hover:underline">
                        info@ajoure.by
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>
      </main>
      
      <LandingFooter />
    </div>
  );
}
