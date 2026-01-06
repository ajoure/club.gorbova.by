import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { Shield, FileText, Lock, Eye, Trash2, UserCheck, Globe, Mail } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />
      
      <main className="container mx-auto px-4 py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ</h1>
          <p className="text-muted-foreground text-center mb-12">
            Закрытое акционерное общество «АЖУР инкам» (далее — Оператор)
          </p>
          
          <div className="space-y-6">
            {/* Введение */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">1. Общие положения</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>
                      Настоящая Политика конфиденциальности (далее — Политика) определяет порядок обработки 
                      и защиты персональных данных пользователей сервиса «АЖУР» (далее — Сервис), 
                      расположенного по адресу <a href="https://ajoure.by" className="text-primary hover:underline">https://ajoure.by</a>.
                    </p>
                    <p>
                      Использование Сервиса означает безоговорочное согласие Пользователя с данной Политикой 
                      и указанными в ней условиями обработки персональных данных.
                    </p>
                    <p>
                      Оператор не контролирует и не несёт ответственности за сайты третьих лиц, 
                      на которые Пользователь может перейти по ссылкам, размещённым на Сервисе.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Какие данные собираются */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">2. Категории обрабатываемых данных</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Оператор может обрабатывать следующие категории персональных данных:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Фамилия, имя, отчество</li>
                      <li>Адрес электронной почты</li>
                      <li>Номер телефона</li>
                      <li>Данные, связанные с аккаунтом Telegram (идентификатор, имя пользователя)</li>
                      <li>Платёжные данные (при оплате через bePaid)</li>
                      <li>IP-адрес, cookies, данные о браузере и устройстве</li>
                      <li>Информация о действиях Пользователя на Сервисе</li>
                    </ul>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Цели обработки */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Eye className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">3. Цели обработки персональных данных</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Персональные данные обрабатываются в следующих целях:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Регистрация и авторизация пользователей</li>
                      <li>Предоставление доступа к платным сервисам и функциям</li>
                      <li>Обработка платежей и управление подписками</li>
                      <li>Связь с пользователями (уведомления, техподдержка)</li>
                      <li>Управление доступом к закрытым Telegram-сообществам</li>
                      <li>Улучшение качества Сервиса и аналитика</li>
                      <li>Выполнение требований законодательства Республики Беларусь</li>
                    </ul>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Защита данных */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Lock className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">4. Меры по защите данных</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Оператор применяет следующие меры для защиты персональных данных:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Шифрование данных при передаче (HTTPS/TLS)</li>
                      <li>Хранение данных на защищённых серверах</li>
                      <li>Ограничение доступа к персональным данным</li>
                      <li>Регулярный аудит систем безопасности</li>
                      <li>Применение современных методов аутентификации</li>
                    </ul>
                    <p className="mt-3">
                      Платёжные данные обрабатываются сертифицированным платёжным провайдером bePaid 
                      и не хранятся на серверах Оператора.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Права пользователя */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <UserCheck className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">5. Права пользователя</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Пользователь имеет право:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Получить информацию об обрабатываемых персональных данных</li>
                      <li>Требовать исправления неточных данных</li>
                      <li>Требовать удаления персональных данных</li>
                      <li>Отозвать согласие на обработку данных</li>
                      <li>Обратиться в уполномоченный орган по защите прав субъектов персональных данных</li>
                    </ul>
                    <p className="mt-3">
                      Для реализации указанных прав Пользователь может направить запрос на адрес{" "}
                      <a href="mailto:info@ajoure.by" className="text-primary hover:underline">info@ajoure.by</a>.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Удаление данных */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Trash2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">6. Сроки хранения и удаление данных</h2>
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

            {/* Передача третьим лицам */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Globe className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">7. Передача данных третьим лицам</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>Оператор может передавать персональные данные:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Платёжному провайдеру bePaid — для обработки платежей</li>
                      <li>Telegram — для управления доступом к закрытым сообществам</li>
                      <li>Государственным органам — по запросу в соответствии с законодательством</li>
                    </ul>
                    <p className="mt-3">
                      Оператор не продаёт и не передаёт персональные данные третьим лицам 
                      для маркетинговых целей без согласия Пользователя.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Cookies */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">8. Использование cookies</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>
                      Сервис использует cookies для обеспечения работы функций авторизации, 
                      сохранения пользовательских настроек и сбора аналитики.
                    </p>
                    <p>
                      Пользователь может отключить cookies в настройках браузера, 
                      однако это может ограничить функциональность Сервиса.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Изменения политики */}
            <GlassCard className="p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">9. Изменения Политики</h2>
                  <div className="text-muted-foreground space-y-3">
                    <p>
                      Оператор вправе вносить изменения в настоящую Политику. 
                      Новая редакция Политики вступает в силу с момента её размещения на Сервисе.
                    </p>
                    <p>
                      Рекомендуем периодически проверять данную страницу для ознакомления 
                      с актуальной версией Политики.
                    </p>
                    <p className="text-sm mt-4">
                      Дата последнего обновления: 6 января 2026 года
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
                  <h2 className="text-xl font-semibold mb-2">10. Контактная информация</h2>
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
