import { Link } from "react-router-dom";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { CreditCard, Shield, Lock, RotateCcw, Banknote, ChevronRight } from "lucide-react";
import paymentSystemsImage from "@/assets/payment-systems.png";
import eripLogoImage from "@/assets/erip-logo.png";

export default function OrderPayment() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />
      
      <main className="container mx-auto px-4 py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">ЗАКАЗ И ОПЛАТА УСЛУГ</h1>
          <p className="text-muted-foreground text-center mb-12">
            Информация о способах оплаты, безопасности и условиях возврата
          </p>
          
          {/* Navigation */}
          <div className="flex flex-wrap justify-center gap-3 mb-12">
            <a href="#payment-cards" className="px-4 py-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors text-sm">
              Оплата картой
            </a>
            <a href="#security" className="px-4 py-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors text-sm">
              Безопасность
            </a>
            <a href="#refund" className="px-4 py-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors text-sm">
              Возврат
            </a>
            <a href="#erip" className="px-4 py-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors text-sm">
              ЕРИП
            </a>
          </div>

          {/* Payment Systems Logos */}
          <div className="flex justify-center mb-12">
            <img 
              src={paymentSystemsImage} 
              alt="Принимаем к оплате: Visa, MasterCard, Белкарт, bePaid, Samsung Pay, Google Pay" 
              className="max-w-full h-auto max-h-12 opacity-80"
            />
          </div>

          {/* Оплата банковскими карточками */}
          <section id="payment-cards" className="mb-12">
            <GlassCard className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-primary/10">
                  <CreditCard className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold">Оплата банковскими карточками</h2>
              </div>
              
              <div className="prose prose-sm max-w-none text-foreground/80 space-y-4">
                <p>
                  Оплата банковскими карточками осуществляется через ОАО «Паритетбанк». К оплате принимаются карты международных платежных систем VISA, MasterCard, платежной системы БЕЛКАРТ, платежной системы МИР. Оплату также можно совершить посредством сервисов Apple Pay, Samsung Pay.
                </p>
                
                <p>
                  Безопасность совершения платежа обеспечивается современными методами проверки, шифрования и передачи данных по закрытым каналам связи.
                </p>
                
                <p>
                  Ввод данных карточки осуществляется на защищенной авторизационной странице банка. Для оплаты необходимо ввести реквизиты карточки: номер, имя держателя, срок действия и трехзначный код безопасности. Трёхзначный код безопасности (CVV2 для VISA, CVC2 для MasterCard) — это три цифры, находящиеся на обратной стороне карточки. Если карточка поддерживает технологию 3DSecure или Интернет-пароль для держателей карточек БЕЛКАРТ, или Mir Accept для держателей карточек МИР Вы будете перенаправлены на страницу банка, выпустившего карточку, для ввода кода безопасности.
                </p>
                
                <p>
                  При оплате с помощью Apple Pay, выберете карту из приложения Wallet, воспользуйтесь кодпаролем или иным способом аутентификации, в зависимости от того, какой способ выбран в приложении. При оформлении заказа с помощью Samsung Pay нажмите «Оплатить Samsung Pay», введите ваш Samsung Account и подтвердите покупку на вашем смартфоне (по отпечатку пальца, радужке или PIN-коду Samsung Pay).
                </p>
              </div>
            </GlassCard>
          </section>

          {/* Безопасность платежей */}
          <section id="security" className="mb-12">
            <GlassCard className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold">Безопасность платежей</h2>
              </div>
              
              <div className="prose prose-sm max-w-none text-foreground/80">
                <p>
                  Безопасность совершения платежа обеспечивается современными методами проверки, шифрования и передачи данных по закрытым каналам связи.
                </p>
              </div>
            </GlassCard>
          </section>

          {/* Конфиденциальность информации */}
          <section id="confidentiality" className="mb-12">
            <GlassCard className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Lock className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold">Конфиденциальность информации</h2>
              </div>
              
              <div className="prose prose-sm max-w-none text-foreground/80">
                <p>
                  Предоставляемая Вами персональная информация (например: имя, адрес, телефон, e-mail, номер банковской карты и прочее) является конфиденциальной и не подлежит разглашению. Данные карточки передаются только в зашифрованном виде и не сохраняются на данном интернет-ресурсе.
                </p>
              </div>
            </GlassCard>
          </section>

          {/* Правила возврата */}
          <section id="refund" className="mb-12">
            <GlassCard className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-primary/10">
                  <RotateCcw className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold">Правила возврата</h2>
              </div>
              
              <div className="prose prose-sm max-w-none text-foreground/80 space-y-4">
                <p>
                  При оплате банковской платежной карточкой, возврат наличными денежными средствами не допускается. Расчеты с потребителем, при возврате уплаченной за товар денежной суммы, при расторжении договора о выполнении работы (оказании услуги) осуществляются в той же форме, в которой производилась оплата товара, работы (услуги), если иное не предусмотрено соглашением сторон. Порядок возврата регулируется правилами платежных систем.
                </p>
                
                <p>
                  Процедура возврата товара, отказа от исполнения договора о выполнении работы (оказании услуги) регламентируется Законом Республики Беларусь от 9 января 2002 г. N90-З «О защите прав потребителей». Перечень непродовольственных товаров надлежащего качества, не подлежащих обмену и возврату, утверждается Правительством Республики Беларусь.
                </p>
                
                <p>
                  Для возврата денежных средств на банковскую платежную карточку необходимо связаться по контактным данным, указанным на интернет-ресурсе. По операциям, проведенным с ошибками, необходимо обратиться с приложением чеков/квитанций, подтверждающих ошибочное списание. Срок возврата денежных средств на карточку как правило составляет 7 (семь) календарных дней и зависит от банка эмитента, выпустившего карточку. Сумма возврата будет равняться сумме покупки.
                </p>
              </div>
            </GlassCard>
          </section>

          {/* Условия возврата денежных средств */}
          <section id="refund-conditions" className="mb-12">
            <GlassCard className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Banknote className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-2xl font-semibold">Условия возврата денежных средств</h2>
              </div>
              
              <div className="prose prose-sm max-w-none text-foreground/80">
                <p>
                  Для возврата денежных средств Вам необходимо написать письмо в произвольной форме по адресу{" "}
                  <a href="mailto:info@ajoure.by" className="text-primary hover:underline">info@ajoure.by</a>{" "}
                  с описанием причины и просьбой о возврате денежных средств. Срок рассмотрения требования о возврате денежных средств 15 календарных дней.
                </p>
              </div>
            </GlassCard>
          </section>

          {/* ЕРИП */}
          <section id="erip" className="mb-12">
            <GlassCard className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <img src={eripLogoImage} alt="ЕРИП" className="h-10 w-auto" />
                <h2 className="text-2xl font-semibold">Как оплатить через систему "Расчет" (ЕРИП)</h2>
              </div>
              
              <div className="prose prose-sm max-w-none text-foreground/80 space-y-4">
                <p>
                  Оплатить заказ Вы можете через систему "Расчет" (ЕРИП), в любом удобном для Вас месте, в удобное для Вас время, в удобном для Вас пункте банковского обслуживания –
                </p>
                
                <ul className="list-none space-y-1 pl-0">
                  <li className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-primary" />интернет-банке,</li>
                  <li className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-primary" />с помощью мобильного банкинга,</li>
                  <li className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-primary" />инфокиоске,</li>
                  <li className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-primary" />кассе банков,</li>
                  <li className="flex items-center gap-2"><ChevronRight className="h-4 w-4 text-primary" />банкомате и т.д.</li>
                </ul>
                
                <p>
                  Совершить оплату можно с использованием наличных денежных средств, электронных денег и банковских платежных карточек, в пунктах банковского обслуживания банков, которые оказывают услуги по приему платежей, а также посредством инструментов дистанционного банковского обслуживания.
                </p>
                
                <div className="bg-primary/5 rounded-xl p-6 mt-6">
                  <h3 className="font-semibold text-lg mb-4">ДЛЯ ПРОВЕДЕНИЯ ПЛАТЕЖА НЕОБХОДИМО:</h3>
                  <ol className="list-decimal list-inside space-y-3">
                    <li>
                      Выбрать
                      <ul className="list-none ml-6 mt-2 space-y-1">
                        <li>• Пункт "Система "Расчет" (ЕРИП)</li>
                        <li>• Информационные услуги</li>
                        <li>• Республика Беларусь</li>
                        <li>• АЖУР инкам</li>
                      </ul>
                    </li>
                    <li></li>
                    <li>Для оплаты ввести Номер заказа</li>
                    <li>Проверить корректность информации</li>
                    <li>Совершить платеж.</li>
                  </ol>
                </div>
                
                <p className="text-muted-foreground italic">
                  Если Вы осуществляете платеж в кассе банка, пожалуйста, сообщите кассиру о необходимости проведения платежа через систему "Расчет" (ЕРИП).
                </p>
                
                <div className="bg-accent/20 rounded-xl p-6 mt-6">
                  <p className="font-medium">
                    Вы также можете оплатить заказ по коду услуги в ЕРИП:
                  </p>
                  <ul className="list-none mt-3 space-y-1">
                    <li>• Пункт "Система "Расчет" (ЕРИП)</li>
                    <li>• Оплата в ЕРИП по коду услуги</li>
                    <li>• Вводите код <span className="font-bold text-primary text-lg">5342891</span></li>
                  </ul>
                </div>
              </div>
            </GlassCard>
          </section>

          {/* Контакты */}
          <section className="text-center">
            <GlassCard className="p-8">
              <h2 className="text-xl font-semibold mb-4">Контакты для связи</h2>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                <a href="tel:+375447594321" className="text-primary hover:underline">
                  +375 44 759-43-21
                </a>
                <a href="mailto:info@ajoure.by" className="text-primary hover:underline">
                  info@ajoure.by
                </a>
              </div>
            </GlassCard>
          </section>
        </div>
      </main>
      
      <LandingFooter />
    </div>
  );
}
