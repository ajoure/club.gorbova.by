import { GlassCard } from "@/components/ui/GlassCard";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { PolicyVersionHistory } from "@/components/privacy/PolicyVersionHistory";
import { usePolicyVersions } from "@/hooks/usePolicyVersions";
import { downloadPolicyPdf } from "@/utils/policyPdfExport";
import { Button } from "@/components/ui/button";
import { 
  Shield, Building2, FileText, Database, 
  Globe, Lock, UserCheck, Scale, Send, Info, Mail
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";

export default function Privacy() {
  const { data: policyVersions, isLoading: isLoadingVersions } = usePolicyVersions();

  return (
    <div className="min-h-screen bg-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-12 max-w-5xl">
        {/* Шапка документа */}
        <div className="mb-10">
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-6 mb-8">
            <div className="flex-1">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                <Shield className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mb-2">
                ПОЛОЖЕНИЕ
              </h1>
              <p className="text-lg text-muted-foreground">
                о политике в отношении обработки персональных данных
              </p>
            </div>
            <div className="text-right border rounded-lg p-4 bg-muted/30">
              <p className="text-sm text-muted-foreground mb-1">УТВЕРЖДАЮ</p>
              <p className="text-sm font-medium">Директор ЗАО «АЖУР инкам»</p>
              <p className="text-sm font-medium">Коврижкин А.И.</p>
              <p className="text-sm text-muted-foreground mt-2">01 января 2026 г.</p>
            </div>
          </div>
          <div className="flex justify-center">
            <Button variant="outline" onClick={downloadPolicyPdf}>
              <Download className="h-4 w-4 mr-2" />
              Скачать PDF
            </Button>
          </div>
        </div>

        {/* 1. Общие положения */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">1. ОБЩИЕ ПОЛОЖЕНИЯ</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  <strong className="text-foreground">1.1.</strong> Закрытое акционерное общество «АЖУР инкам» 
                  (далее – ЗАО «АЖУР инкам») уделяет особое внимание защите персональных данных при их обработке 
                  и с уважением относится к соблюдению прав субъектов персональных данных.
                </p>
                <p>
                  Утверждение Положения о политике в отношении обработки персональных данных (далее – Политика) 
                  является одной из принимаемых ЗАО «АЖУР инкам» мер по защите персональных данных, 
                  предусмотренных статьей 17 Закона Республики Беларусь от 7 мая 2021 г. № 99-З 
                  «О защите персональных данных» (далее – Закон).
                </p>
                <p>
                  <strong className="text-foreground">1.2.</strong> Политика разъясняет субъектам персональных данных, 
                  как и для каких целей их персональные данные собираются, используются или иным образом обрабатываются, 
                  а также отражает имеющиеся в связи с этим у субъектов персональных данных права и механизм их реализации.
                </p>
                <p>
                  Политика не применяется к обработке персональных данных в процессе трудовой деятельности 
                  и при осуществлении административных процедур (в отношении работников и бывших работников), 
                  а также при обработке cookie-файлов на интернет-сайте ЗАО «АЖУР инкам».
                </p>
                <p>
                  <strong className="text-foreground">1.3.</strong> Почтовый адрес ЗАО «АЖУР инкам»:{" "}
                  <span className="text-foreground">220052, Республика Беларусь, г. Минск, а/я 63</span>
                </p>
                <p>Адреса в сети Интернет:</p>
                <div className="flex flex-wrap gap-2 ml-2">
                  <a href="https://gorbova.by" className="text-primary hover:underline px-2 py-1 rounded bg-primary/5">gorbova.by</a>
                  <a href="https://gorbova.club" className="text-primary hover:underline px-2 py-1 rounded bg-primary/5">gorbova.club</a>
                  <a href="https://gorbova.pro" className="text-primary hover:underline px-2 py-1 rounded bg-primary/5">gorbova.pro</a>
                  <a href="https://gorbova.getcourse.ru" className="text-primary hover:underline px-2 py-1 rounded bg-primary/5">gorbova.getcourse.ru</a>
                </div>
                <p>
                  <strong className="text-foreground">1.4.</strong> В настоящей Политике используются термины 
                  и их определения в значении, определенном Законом.
                </p>
                <p>
                  <strong className="text-foreground">1.5.</strong> ЗАО «АЖУР инкам» осуществляет обработку 
                  только тех персональных данных, которые необходимы для выполнения заявленных целей, 
                  и не допускает их избыточной обработки.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* 2. Цели, категории, перечень данных */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Database className="h-6 w-6 text-primary" />
            </div>
            <div className="w-full">
              <h2 className="text-xl font-semibold mb-4">
                2. ЦЕЛИ, КАТЕГОРИИ СУБЪЕКТОВ ПЕРСОНАЛЬНЫХ ДАННЫХ, ЧЬИ ДАННЫЕ ПОДВЕРГАЮТСЯ ОБРАБОТКЕ, 
                ПЕРЕЧЕНЬ ОБРАБАТЫВАЕМЫХ ПЕРСОНАЛЬНЫХ ДАННЫХ, ПРАВОВЫЕ ОСНОВАНИЯ И СРОКИ ОБРАБОТКИ ПЕРСОНАЛЬНЫХ ДАННЫХ
              </h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  ЗАО «АЖУР инкам» осуществляет обработку персональных данных субъектов персональных данных 
                  в целях, объеме, на правовых основаниях и в сроки применительно к каждой категории субъектов 
                  персональных данных согласно приложению 1 к настоящей Политике.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* 3. Трансграничная передача */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Globe className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">3. ТРАНСГРАНИЧНАЯ ПЕРЕДАЧА ПЕРСОНАЛЬНЫХ ДАННЫХ</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  <strong className="text-foreground">3.1.</strong> ЗАО «АЖУР инкам» осуществляет трансграничную 
                  передачу персональных данных для обеспечения непрерывной коммуникации с пользователями социальных 
                  сетей и мессенджеров (Instagram, Telegram, др.).
                </p>
                <p>
                  <strong className="text-foreground">3.2.</strong> Трансграничная передача персональных данных 
                  на территорию иностранного государства может осуществляться ЗАО «АЖУР инкам», если:
                </p>
                <div className="ml-4 space-y-3">
                  <p>
                    <strong className="text-foreground">3.2.1.</strong> на территории иностранного государства 
                    обеспечивается надлежащий уровень защиты прав субъектов персональных данных – без ограничений 
                    при наличии правовых оснований, предусмотренных Законом;
                  </p>
                  <p>
                    <strong className="text-foreground">3.2.2.</strong> на территории иностранного государства 
                    не обеспечивается надлежащий уровень защиты прав субъектов персональных данных – в случаях, 
                    предусмотренных статьей 9 Закона, в том числе:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>
                      когда дано согласие субъекта персональных данных при условии, что субъект персональных данных 
                      проинформирован о рисках, возникающих в связи с отсутствием надлежащего уровня их защиты;
                    </li>
                    <li>
                      при размещении информации о своей деятельности в глобальной компьютерной сети Интернет;
                    </li>
                    <li>
                      когда обработка персональных данных является необходимой для выполнения обязанностей (полномочий), 
                      предусмотренных законодательными актами.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* 4. Права субъектов персональных данных */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <UserCheck className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">4. ПРАВА СУБЪЕКТОВ ПЕРСОНАЛЬНЫХ ДАННЫХ</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  <strong className="text-foreground">4.1.</strong> Субъект персональных данных имеет право:
                </p>
                <div className="ml-4 space-y-3">
                  <p>
                    <strong className="text-foreground">4.1.1.</strong> на отзыв своего согласия, если для обработки 
                    персональных данных ЗАО «АЖУР инкам» обращалось к субъекту персональных данных за получением согласия. 
                    Право на отзыв согласия не может быть реализовано в случае, когда обработка осуществляется на иных 
                    правовых основаниях (например, в соответствии с требованиями законодательства либо на основании договора);
                  </p>
                  <p>
                    <strong className="text-foreground">4.1.2.</strong> на получение информации, касающейся обработки 
                    своих персональных данных ЗАО «АЖУР инкам», содержащей:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>место нахождения ЗАО «АЖУР инкам»;</li>
                    <li>подтверждение факта обработки персональных данных обратившегося лица ЗАО «АЖУР инкам»;</li>
                    <li>персональные данные и источник их получения;</li>
                    <li>правовые основания и цели обработки персональных данных;</li>
                    <li>срок, на который дано согласие (если обработка персональных данных осуществляется на основании согласия);</li>
                    <li>наименование и место нахождения уполномоченного лица (уполномоченных лиц);</li>
                    <li>иную информацию, предусмотренную законодательством;</li>
                  </ul>
                  <p>
                    <strong className="text-foreground">4.1.3.</strong> требовать от ЗАО «АЖУР инкам» внесения изменений 
                    в свои персональные данные в случае, если персональные данные являются неполными, устаревшими или неточными. 
                    В этих целях субъект персональных данных прилагает соответствующие документы и (или) их заверенные 
                    в установленном порядке копии, подтверждающие необходимость внесения изменений в персональные данные;
                  </p>
                  <p>
                    <strong className="text-foreground">4.1.4.</strong> на получение от ЗАО «АЖУР инкам» информации 
                    о предоставлении своих персональных данных, обрабатываемых ЗАО «АЖУР инкам» третьим лицам один раз 
                    в календарный год бесплатно, если иное не предусмотрено Законом и иными законодательными актами;
                  </p>
                  <p>
                    <strong className="text-foreground">4.1.5.</strong> требовать от ЗАО «АЖУР инкам» бесплатного 
                    прекращения обработки своих персональных данных, включая их удаление, при отсутствии оснований 
                    для обработки персональных данных, предусмотренных Законом и иными законодательными актами;
                  </p>
                  <p>
                    <strong className="text-foreground">4.1.6.</strong> на обжалование действий (бездействия) и решений 
                    ЗАО «АЖУР инкам», нарушающих его права при обработке персональных данных, в порядке, установленном 
                    законодательством.
                  </p>
                </div>

                <Separator className="my-4" />

                <p>
                  <strong className="text-foreground">4.2.</strong> Для реализации своих прав, связанных с обработкой 
                  персональных данных ЗАО «АЖУР инкам», субъект персональных данных подает в ЗАО «АЖУР инкам» заявление 
                  в письменной форме по почтовому адресу, указанному в подпункте 1.3 пункта 1 настоящей Политики, 
                  а в случае реализации права на отзыв согласия – в форме, в которой такое согласие было получено.
                </p>
                <p>Такое заявление должно содержать:</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>фамилию, собственное имя, отчество (если таковое имеется) субъекта персональных данных, адрес его места жительства (места пребывания);</li>
                  <li>дату рождения субъекта персональных данных;</li>
                  <li>изложение сути требований субъекта персональных данных;</li>
                  <li>идентификационный номер субъекта персональных данных, при отсутствии такого номера – номер документа, удостоверяющего личность субъекта персональных данных, в случаях, если эта информация указывалась субъектом персональных данных при даче своего согласия или обработка персональных данных осуществляется без согласия субъекта персональных данных;</li>
                  <li>личную подпись субъекта персональных данных.</li>
                </ul>

                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 mt-4">
                  <p className="text-foreground">
                    <Info className="h-4 w-4 inline mr-2 text-amber-600" />
                    ЗАО «АЖУР инкам» не рассматривает заявления субъектов персональных данных, поступившие в его адрес 
                    иными способами (e-mail, телефон и т.п).
                  </p>
                </div>

                <p>
                  <strong className="text-foreground">4.3.</strong> За содействием в реализации прав, связанных с обработкой 
                  персональных данных ЗАО «АЖУР инкам», субъект персональных данных может обратиться в ЗАО «АЖУР инкам», 
                  направив сообщение на электронный адрес{" "}
                  <a href="mailto:client@ajoure.by" className="text-primary hover:underline font-medium">client@ajoure.by</a>.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Приложение 1 */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Scale className="h-6 w-6 text-primary" />
            </div>
            <div className="w-full">
              <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2 mb-4">
                <h2 className="text-xl font-semibold">Приложение 1</h2>
                <p className="text-sm text-muted-foreground">к Положению о политике в отношении обработки персональных данных</p>
              </div>
              
              <h3 className="text-lg font-medium mb-4 text-center">
                Цели, объем, правовые основания и сроки обработки персональных данных ЗАО «АЖУР инкам»
              </h3>
              
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Цели обработки</TableHead>
                      <TableHead className="font-semibold">Категории субъектов</TableHead>
                      <TableHead className="font-semibold">Перечень персональных данных</TableHead>
                      <TableHead className="font-semibold">Правовые основания</TableHead>
                      <TableHead className="font-semibold">Срок хранения</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="align-top font-medium">
                        Предварительная запись на личный прием
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Лица, обращающиеся на личный прием
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Фамилия, собственное имя, отчество, контактный телефон, содержание вопроса
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Обработка персональных данных является необходимой для выполнения обязанностей (полномочий), 
                        предусмотренных законодательными актами (абзац двадцатый статьи 6 Закона, пункт 7 статьи 6 
                        Закона Республики Беларусь «Об обращениях граждан и юридических лиц»)
                      </TableCell>
                      <TableCell className="align-top text-sm font-medium">
                        5 лет
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="align-top font-medium">
                        Рассмотрение и направление ответа на поступившие обращения, в том числе внесенных 
                        в книгу замечаний и предложений, анализ обращений
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Лица, направившие обращение; Иные лица, чьи персональные данные указаны в обращении
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Фамилия, имя, отчество, номер телефона (необязательно), адрес места проживания, 
                        иные персональные данные, указанные в обращении
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Обработка персональных данных является необходимой для выполнения обязанностей (полномочий), 
                        предусмотренных законодательными актами (абзац двадцатый статьи 6 Закона, пункт 1 статьи 3 
                        Закона Республики Беларусь «Об обращениях граждан и юридических лиц»)
                      </TableCell>
                      <TableCell className="align-top text-sm font-medium">
                        5 лет с даты последнего обращения; 5 лет после окончания ведения книги замечаний и предложений
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="align-top font-medium">
                        Заключение, изменение, исполнение, расторжение договоров (в том числе договоров об 
                        оказании услуг на платной основе) с клиентами, учет и анализ договоров, контроль 
                        исполнения договорных обязательств
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Клиенты
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Фамилия, собственное имя, отчество, паспортные данные, адрес места проживания, 
                        номер телефона, адрес электронной почты, данные в мессенджере Telegram и социальной сети Instagram
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Обработка на основании договора с субъектом персональных данных (абзац пятнадцатый статьи 6 Закона)
                      </TableCell>
                      <TableCell className="align-top text-sm font-medium">
                        3 года после проведения налоговыми органами проверки соблюдения налогового законодательства. 
                        Если налоговыми органами проверка соблюдения налогового законодательства не проводилась – 
                        10 лет после окончания срока действия договора
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="align-top font-medium">
                        Заключение и исполнение гражданско-правовых договоров с субъектами хозяйствования 
                        (контрагентами), учет и анализ договоров, контроль исполнения договорных обязательств
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Лица, уполномоченные на подписание договоров; Иные лица, чьи персональные данные указаны в договорах
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Фамилия, имя, отчество либо инициалы лица, должность лица, подписавшего договор, 
                        иные данные в соответствии с условиями договора (при необходимости), номер телефона, электронная почта
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Обработка персональных данных является необходимой для выполнения обязанностей (полномочий), 
                        предусмотренных законодательными актами (абзац двадцатый статьи 6 Закона, статья 49, 
                        пункт 5 статьи 186 Гражданского кодекса Республики Беларусь)
                      </TableCell>
                      <TableCell className="align-top text-sm font-medium">
                        3 года после проведения налоговыми органами проверки соблюдения налогового законодательства. 
                        Если налоговыми органами проверка соблюдения налогового законодательства не проводилась – 
                        10 лет после окончания срока действия договора
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="align-top font-medium">
                        Проведение онлайн занятий в рамках заключенных договоров об оказании услуг на платной основе
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Клиенты
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Данные о социальных сетях (мессенджерах) Instagram, Telegram, электронная почта
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Согласие субъекта персональных данных
                      </TableCell>
                      <TableCell className="align-top text-sm font-medium">
                        Ограничивается сроком действия заключенного договора
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="align-top font-medium">
                        Направление информационной (рекламной, новостной) рассылки
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Клиенты, пользователи сайта
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Адрес электронной почты и (или) номер телефона, данные о социальных сетях (мессенджерах) 
                        Instagram, Telegram
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        Согласие субъекта персональных данных
                      </TableCell>
                      <TableCell className="align-top text-sm font-medium">
                        Ограничивается 5 годами с даты дачи согласия либо до момента отписки от получения рассылки
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Ссылка на согласие */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Send className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Согласие на обработку персональных данных</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Для ознакомления с текстом согласия на обработку персональных данных перейдите по ссылке:
                </p>
                <Link 
                  to="/consent" 
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <FileText className="h-4 w-4" />
                  Согласие на обработку персональных данных
                </Link>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Контактная информация */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Контактная информация</h2>
              <div className="grid gap-3 text-sm text-muted-foreground">
                <p className="flex items-start gap-2">
                  <Building2 className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                  <span>Почтовый адрес: 220052, Республика Беларусь, г. Минск, а/я 63</span>
                </p>
                <p className="flex items-start gap-2">
                  <Mail className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                  <span>
                    E-mail для обращений по вопросам обработки персональных данных:{" "}
                    <a href="mailto:client@ajoure.by" className="text-primary hover:underline">client@ajoure.by</a>
                  </span>
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* История версий */}
        <div className="mt-8">
          <PolicyVersionHistory 
            versions={policyVersions || []} 
            isLoading={isLoadingVersions} 
          />
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
