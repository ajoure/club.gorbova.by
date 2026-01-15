import { GlassCard } from "@/components/ui/GlassCard";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PolicyVersionHistory } from "@/components/privacy/PolicyVersionHistory";
import { usePolicyVersions } from "@/hooks/usePolicyVersions";
import { downloadPolicyPdf } from "@/utils/policyPdfExport";
import { Button } from "@/components/ui/button";
import { 
  Shield, Building2, Mail, Phone, MapPin, User, FileText, Database, 
  Eye, Lock, UserCheck, Clock, AlertCircle, Download, Camera, CheckCircle,
  UserPlus, Megaphone
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

export default function Privacy() {
  const { data: policyVersions, isLoading: isLoadingVersions } = usePolicyVersions();

  return (
    <div className="min-h-screen bg-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Согласие на обработку персональных данных
          </h1>
          <p className="text-muted-foreground mb-4">
            Действует с 7 января 2026 года
          </p>
          <Button variant="outline" onClick={downloadPolicyPdf}>
            <Download className="h-4 w-4 mr-2" />
            Скачать PDF
          </Button>
        </div>

        {/* Реквизиты оператора */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Оператор персональных данных</h2>
              <div className="space-y-3 text-sm">
                <p className="font-medium text-base">
                  Закрытое акционерное общество «АЖУР инкам»
                </p>
                <div className="grid gap-2 text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0" />
                    УНП 193405000
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0" />
                    220035, г. Минск, ул. Панфилова, 2, офис 49Л
                  </p>
                  <p className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0" />
                    Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63
                  </p>
                  <p className="flex items-center gap-2">
                    <Phone className="h-4 w-4 shrink-0" />
                    +375 29 171-43-21
                  </p>
                  <p className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0" />
                    <a href="mailto:info@ajoure.by" className="text-primary hover:underline">
                      info@ajoure.by
                    </a>
                  </p>
                  <p className="flex items-center gap-2">
                    <User className="h-4 w-4 shrink-0" />
                    Директор: Коврижкин Алексей Игоревич
                  </p>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Согласие на обработку */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <UserCheck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Согласие на обработку персональных данных</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Настоящим принимаю решение о предоставлении моих персональных данных и даю 
                  Оператору — ЗАО «АЖУР инкам», в лице Директора управляющей организации 
                  Коврижкина Алексея Игоревича, действующего на основании Устава, в соответствии 
                  со статьей 5 Закона Республики Беларусь от 07.05.2021 № 99-З «О защите 
                  персональных данных», согласие на обработку персональных данных.
                </p>
                <p>
                  Согласие на обработку персональных данных является конкретным, предметным, 
                  информированным, сознательным и однозначным.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Персональные данные для создания учётной записи */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">
                1. Создание учётной записи
              </h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Если Пользователь дал согласие на создание учётной записи, Оператор обрабатывает 
                  следующие персональные данные:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Фамилия, имя, отчество</li>
                  <li>Пол</li>
                  <li>Возраст</li>
                  <li>Дата и год рождения</li>
                  <li>Телефон</li>
                  <li>Адрес электронной почты (e-mail)</li>
                  <li>Адрес проживания</li>
                  <li>Ссылка на аккаунты в социальных сетях</li>
                  <li>Банковские реквизиты, заполняемые при оплате услуг</li>
                  <li>Изображение Пользователя</li>
                  <li>Видеозапись с изображением Пользователя</li>
                </ul>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Персональные данные для рекламной деятельности */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Megaphone className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">
                2. Осуществление рекламной деятельности
              </h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  С согласия Пользователя, для осуществления рекламной деятельности Оператор 
                  обрабатывает следующие персональные данные:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Фамилия, имя, отчество</li>
                  <li>Пол</li>
                  <li>Возраст</li>
                  <li>Дата и год рождения</li>
                  <li>Телефон</li>
                  <li>Адрес электронной почты (e-mail)</li>
                  <li>Адрес проживания</li>
                  <li>Ссылка на аккаунты в социальных сетях</li>
                  <li>Банковские реквизиты, заполняемые при оплате услуг</li>
                  <li>Данные документа, удостоверяющего личность</li>
                </ul>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Способы обработки */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Database className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Способы обработки персональных данных</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Обработка персональных данных осуществляется следующими способами:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Сбор</li>
                  <li>Запись</li>
                  <li>Систематизация</li>
                  <li>Накопление</li>
                  <li>Хранение</li>
                  <li>Уточнение (обновление, изменение)</li>
                  <li>Извлечение</li>
                  <li>Использование</li>
                  <li>Передача (распространение, предоставление, доступ)</li>
                  <li>Обезличивание</li>
                  <li>Блокирование</li>
                  <li>Удаление</li>
                  <li>Уничтожение</li>
                </ul>
                <p>
                  Обработка осуществляется в информационных системах персональных данных с 
                  использованием средств автоматизации или без использования таких средств.
                </p>
                <p>
                  Обработка персональных данных Пользователей осуществляется в соответствии с 
                  Законом Республики Беларусь от 07.05.2021 № 99-З «О защите персональных данных».
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Cookies и аналитика */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Eye className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Сбор обезличенных данных</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Я соглашаюсь с тем, что на сайте происходит сбор и обработка обезличенных 
                  данных о посетителях (в т.ч. файлов «cookies») с помощью сервисов 
                  интернет-статистики (Яндекс Метрика и других).
                </p>
                <p>
                  Собираемые обезличенные данные включают:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Информация о браузере</li>
                  <li>Время доступа</li>
                  <li>Информация об устройстве, используемом для доступа к сайту</li>
                  <li>Реферер (адрес предыдущей страницы)</li>
                </ul>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Порядок выражения согласия */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Порядок выражения согласия</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Я соглашаюсь с тем, что считаюсь давшим(-ей) согласие на обработку своих 
                  персональных данных, внесенных в поля формы, в момент проставления символа 
                  в чек-боксе (в поле для ввода) в сети Интернет по адресам:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <a href="https://gorbova.by" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                      gorbova.by
                    </a>
                  </li>
                  <li>
                    <a href="https://gorbova.pro" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                      gorbova.pro
                    </a>
                  </li>
                  <li>
                    <a href="https://gorbova.getcourse.ru" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                      gorbova.getcourse.ru
                    </a>
                  </li>
                </ul>
                <p>
                  <strong>включая все домены, субдомены и страницы</strong>, их содержимое, а также 
                  интернет-сервисы и программное обеспечение, предлагаемые Оператором к использованию 
                  на этих Сайтах.
                </p>
                <p>
                  Согласие считается данным при проставлении отметки рядом с текстом: 
                  «Я даю согласие на обработку моих персональных данных в соответствии с условиями 
                  политики конфиденциальности» или иным аналогичным текстом, при условии, что 
                  Субъекту персональных данных предоставлена возможность ознакомиться с полным 
                  текстом настоящей Политики.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Согласие на обработку изображений */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Camera className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Согласие на обработку изображений</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Я соглашаюсь с тем, что считаюсь в том числе давшим(-ей) согласие на обработку 
                  моего изображения (в том числе фотографии, а также видеозаписи), в момент 
                  проставления символа в чек-боксе (в поле для ввода) в сети Интернет по адресам: 
                  gorbova.by, gorbova.pro, gorbova.getcourse.ru рядом с текстом вида: «Я даю согласие 
                  на обработку моих персональных данных в соответствии с условиями политики 
                  конфиденциальности» или иным аналогичным текстом.
                </p>
                <p>
                  Настоящим я выражаю свою осведомленность о том, что Оператор не намеревается 
                  устанавливать на основании моего изображения (в том числе фотографии, а также 
                  видеозаписи), мою личность, а предоставление моего изображения (в том числе 
                  фотографии, а также видеозаписи) требуется только для оценки результата 
                  оказания услуг.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Принятие условий Политики */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Принятие условий Политики</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Я принимаю условия Политики конфиденциальности Оператора, размещенной в сети 
                  Интернет по адресам: gorbova.by, gorbova.pro, gorbova.getcourse.ru, <strong>включая 
                  все домены, субдомены и страницы</strong>, их содержимое, а также интернет-сервисы 
                  и программное обеспечение, предлагаемые Оператором к использованию на этих Сайтах, 
                  и подтверждаю, что ознакомлен(-а) с ней на момент предоставления настоящего Согласия.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Цели и условия обработки */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Цели и условия обработки</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Цель обработки персональных данных, основание обработки персональных данных, 
                  разрешенные мной действия с персональными данными, условия и ограничения их 
                  передачи и срок их обработки, другие требуемые законом условия для каждой цели 
                  обработки персональных данных определены настоящим Согласием и Политикой 
                  конфиденциальности Оператора, и я соглашаюсь с этими условиями.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Срок действия и отзыв */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Clock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Срок действия согласия</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Настоящее согласие действует со дня его подписания до дня отзыва в 
                  письменной/электронной форме.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Отзыв согласия */}
        <GlassCard className="p-6 mb-6 border-primary/20">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <AlertCircle className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Порядок отзыва согласия</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Отзыв настоящего согласия осуществляется в <span className="font-medium text-foreground">письменной 
                  или электронной форме</span> путем направления соответствующего заявления на адрес 
                  электронной почты Оператора:
                </p>
                <p className="flex items-center gap-2 text-base">
                  <Mail className="h-5 w-5 text-primary" />
                  <a href="mailto:info@ajoure.by" className="text-primary font-medium hover:underline">
                    info@ajoure.by
                  </a>
                </p>
                <p>
                  или в письменной форме на почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63.
                </p>
                <Separator className="my-4" />
                <p className="text-xs">
                  После получения отзыва согласия Оператор прекращает обработку персональных данных 
                  и уничтожает их в срок, не превышающий 15 рабочих дней с даты получения отзыва, 
                  за исключением случаев, предусмотренных законодательством Республики Беларусь.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Правовое основание */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-muted shrink-0">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Правовое основание</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Обработка персональных данных осуществляется в соответствии с Законом 
                Республики Беларусь от 07.05.2021 № 99-З «О защите персональных данных».
              </p>
            </div>
          </div>
        </GlassCard>

        {/* История версий */}
        <PolicyVersionHistory 
          versions={policyVersions || []} 
          isLoading={isLoadingVersions} 
        />
      </main>

      <LandingFooter />
    </div>
  );
}