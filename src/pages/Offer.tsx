import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";

export default function Offer() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />
      
      <main className="container mx-auto px-4 py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">ПУБЛИЧНАЯ ОФЕРТА</h1>
          <p className="text-muted-foreground text-center mb-12">
            на оказание информационно-консультационных услуг
          </p>
          
          {/* Оглавление */}
          <GlassCard className="p-6 mb-12">
            <h2 className="font-semibold mb-4">Содержание</h2>
            <nav className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <a href="#section-1" className="text-primary hover:underline">1. Общие положения</a>
              <a href="#section-2" className="text-primary hover:underline">2. Термины и определения</a>
              <a href="#section-3" className="text-primary hover:underline">3. Предмет договора</a>
              <a href="#section-4" className="text-primary hover:underline">4. Стоимость услуг и порядок расчётов</a>
              <a href="#section-5" className="text-primary hover:underline">5. Порядок заключения договора</a>
              <a href="#section-6" className="text-primary hover:underline">6. Права и обязанности сторон</a>
              <a href="#section-7" className="text-primary hover:underline">7. Ответственность сторон</a>
              <a href="#section-8" className="text-primary hover:underline">8. Порядок рассмотрения претензий</a>
              <a href="#section-9" className="text-primary hover:underline">9. Форс-мажор</a>
              <a href="#section-10" className="text-primary hover:underline">10. Конфиденциальность</a>
              <a href="#section-11" className="text-primary hover:underline">11. Срок действия и расторжение договора</a>
              <a href="#section-12" className="text-primary hover:underline">12. Реквизиты исполнителя</a>
            </nav>
          </GlassCard>

          <div className="prose prose-sm max-w-none text-foreground/80">
            {/* Раздел 1 */}
            <section id="section-1" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">1. ОБЩИЕ ПОЛОЖЕНИЯ</h2>
                <div className="space-y-3">
                  <p>1.1. Настоящий документ является официальным предложением (публичной офертой) ЗАО «АЖУР инкам» (далее — Исполнитель) и содержит все существенные условия договора на оказание информационно-консультационных услуг.</p>
                  <p>1.2. В соответствии со статьей 407 Гражданского кодекса Республики Беларусь данное предложение является публичной офертой, адресованной неограниченному кругу лиц.</p>
                  <p>1.3. Акцептом настоящей оферты является оплата услуг Исполнителя в порядке, установленном настоящим договором.</p>
                  <p>1.4. Настоящий договор имеет юридическую силу и является эквивалентом договора, подписанного сторонами.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 2 */}
            <section id="section-2" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">2. ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ</h2>
                <div className="space-y-3">
                  <p><strong>2.1. Исполнитель</strong> — ЗАО «АЖУР инкам», оказывающее информационно-консультационные услуги.</p>
                  <p><strong>2.2. Заказчик</strong> — физическое или юридическое лицо, принявшее условия настоящей оферты путём оплаты услуг.</p>
                  <p><strong>2.3. Услуги</strong> — информационно-консультационные услуги, оказываемые Исполнителем в соответствии с описанием на сайте.</p>
                  <p><strong>2.4. Сайт</strong> — интернет-ресурс Исполнителя, расположенный по адресу club.gorbova.by.</p>
                  <p><strong>2.5. Личный кабинет</strong> — защищённый раздел сайта, доступный Заказчику после регистрации и оплаты услуг.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 3 */}
            <section id="section-3" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">3. ПРЕДМЕТ ДОГОВОРА</h2>
                <div className="space-y-3">
                  <p>3.1. Исполнитель обязуется оказать Заказчику информационно-консультационные услуги в сфере законодательства Республики Беларусь, а Заказчик обязуется оплатить эти услуги.</p>
                  <p>3.2. Конкретный перечень услуг, их объём и стоимость определяются выбранным тарифным планом, описание которого размещено на сайте Исполнителя.</p>
                  <p>3.3. Услуги предоставляются в форме:</p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>доступа к информационным материалам в Личном кабинете;</li>
                    <li>участия в вебинарах и онлайн-мероприятиях;</li>
                    <li>консультаций в формате вопрос-ответ;</li>
                    <li>иных форм, предусмотренных выбранным тарифом.</li>
                  </ul>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 4 */}
            <section id="section-4" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">4. СТОИМОСТЬ УСЛУГ И ПОРЯДОК РАСЧЁТОВ</h2>
                <div className="space-y-3">
                  <p>4.1. Стоимость услуг определяется тарифным планом, выбранным Заказчиком, и указана на сайте Исполнителя.</p>
                  <p>4.2. Оплата производится в белорусских рублях одним из следующих способов:</p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>банковской платёжной карточкой через систему bePaid;</li>
                    <li>через систему «Расчёт» (ЕРИП);</li>
                    <li>иными способами, указанными на сайте.</li>
                  </ul>
                  <p>4.3. Услуги считаются оплаченными с момента поступления денежных средств на расчётный счёт Исполнителя.</p>
                  <p>4.4. Исполнитель вправе изменять стоимость услуг, уведомив об этом путём публикации на сайте. Изменение стоимости не распространяется на уже оплаченные услуги.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 5 */}
            <section id="section-5" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">5. ПОРЯДОК ЗАКЛЮЧЕНИЯ ДОГОВОРА</h2>
                <div className="space-y-3">
                  <p>5.1. Договор считается заключённым с момента полной оплаты выбранного тарифа.</p>
                  <p>5.2. Факт оплаты означает полное и безоговорочное принятие Заказчиком условий настоящей оферты.</p>
                  <p>5.3. Доступ к услугам предоставляется в течение 24 часов с момента зачисления средств.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 6 */}
            <section id="section-6" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">6. ПРАВА И ОБЯЗАННОСТИ СТОРОН</h2>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium mb-2">6.1. Исполнитель обязан:</h3>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li>предоставить доступ к услугам в соответствии с оплаченным тарифом;</li>
                      <li>обеспечить работоспособность сайта и Личного кабинета;</li>
                      <li>своевременно информировать Заказчика об изменениях в условиях оказания услуг.</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">6.2. Исполнитель вправе:</h3>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li>вносить изменения в содержание услуг без ухудшения их качества;</li>
                      <li>приостановить доступ к услугам при нарушении Заказчиком условий договора;</li>
                      <li>привлекать третьих лиц для оказания услуг.</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">6.3. Заказчик обязан:</h3>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li>своевременно оплачивать услуги;</li>
                      <li>не передавать доступ к Личному кабинету третьим лицам;</li>
                      <li>не распространять полученные материалы без согласия Исполнителя.</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">6.4. Заказчик вправе:</h3>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li>получать услуги в соответствии с оплаченным тарифом;</li>
                      <li>обращаться к Исполнителю по вопросам оказания услуг;</li>
                      <li>отказаться от услуг в порядке, предусмотренном настоящим договором.</li>
                    </ul>
                  </div>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 7 */}
            <section id="section-7" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">7. ОТВЕТСТВЕННОСТЬ СТОРОН</h2>
                <div className="space-y-3">
                  <p>7.1. Стороны несут ответственность за неисполнение или ненадлежащее исполнение своих обязательств в соответствии с законодательством Республики Беларусь.</p>
                  <p>7.2. Исполнитель не несёт ответственности за:</p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>решения, принятые Заказчиком на основании полученной информации;</li>
                    <li>невозможность доступа к услугам по причинам, не зависящим от Исполнителя;</li>
                    <li>ущерб, причинённый в результате несанкционированного доступа к Личному кабинету.</li>
                  </ul>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 8 */}
            <section id="section-8" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">8. ПОРЯДОК РАССМОТРЕНИЯ ПРЕТЕНЗИЙ</h2>
                <div className="space-y-3">
                  <p>8.1. Претензии направляются на электронный адрес info@ajoure.by.</p>
                  <p>8.2. Срок рассмотрения претензии — 15 календарных дней с момента получения.</p>
                  <p>8.3. Споры, не урегулированные в претензионном порядке, разрешаются в соответствии с законодательством Республики Беларусь.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 9 */}
            <section id="section-9" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">9. ФОРС-МАЖОР</h2>
                <div className="space-y-3">
                  <p>9.1. Стороны освобождаются от ответственности за неисполнение обязательств, если оно явилось следствием обстоятельств непреодолимой силы.</p>
                  <p>9.2. К обстоятельствам непреодолимой силы относятся: стихийные бедствия, военные действия, изменения законодательства, сбои в работе сети Интернет и иные обстоятельства, находящиеся вне контроля сторон.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 10 */}
            <section id="section-10" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">10. КОНФИДЕНЦИАЛЬНОСТЬ</h2>
                <div className="space-y-3">
                  <p>10.1. Исполнитель обязуется не разглашать персональные данные Заказчика третьим лицам, за исключением случаев, предусмотренных законодательством.</p>
                  <p>10.2. Обработка персональных данных осуществляется в соответствии с Политикой конфиденциальности, размещённой на сайте.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 11 */}
            <section id="section-11" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">11. СРОК ДЕЙСТВИЯ И РАСТОРЖЕНИЕ ДОГОВОРА</h2>
                <div className="space-y-3">
                  <p>11.1. Договор действует до полного исполнения сторонами своих обязательств.</p>
                  <p>11.2. Заказчик вправе отказаться от услуг до начала их оказания с возвратом уплаченных средств за вычетом фактически понесённых расходов Исполнителя.</p>
                  <p>11.3. После начала оказания услуг возврат средств осуществляется пропорционально неиспользованному периоду, если иное не предусмотрено тарифом.</p>
                </div>
              </GlassCard>
            </section>

            {/* Раздел 12 */}
            <section id="section-12" className="mb-8 scroll-mt-24">
              <GlassCard className="p-8">
                <h2 className="text-xl font-semibold mb-4">12. РЕКВИЗИТЫ ИСПОЛНИТЕЛЯ</h2>
                <div className="space-y-2">
                  <p><strong>ЗАО «АЖУР инкам»</strong></p>
                  <p>УНП: 193405000</p>
                  <p>Юридический адрес: 220035, г. Минск, ул. Панфилова, 2, офис 49Л</p>
                  <p>Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63</p>
                </div>
              </GlassCard>
            </section>

            {/* Контакты */}
            <section className="mt-12">
              <GlassCard className="p-8 text-center">
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
        </div>
      </main>
      
      <LandingFooter />
    </div>
  );
}
