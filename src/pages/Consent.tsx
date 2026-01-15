import { GlassCard } from "@/components/ui/GlassCard";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { 
  Shield, Building2, Mail, Phone, MapPin, User, FileText, 
  UserPlus, Megaphone, Camera, ExternalLink
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

export default function Consent() {
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
          <p className="text-muted-foreground">
            Действует с 7 января 2026 года
          </p>
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

        {/* Согласие на обработку персональных данных */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div className="w-full">
              <h2 className="text-xl font-semibold mb-4">Согласие на обработку персональных данных</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Настоящим принимаю решение о предоставлении моих персональных данных и даю 
                  Оператору — ЗАО «АЖУР инкам», в лице Директора управляющей организации 
                  Коврижкина Алексея Игоревича, действующего на основании Устава, в соответствии 
                  со статьей 5 Закона Республики Беларусь от 07.05.2021 № 99-З «О защите 
                  персональных данных», согласие на обработку следующих персональных данных:
                </p>

                <Separator className="my-4" />

                {/* 1. При создании учётной записи */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-5 w-5 text-primary" />
                    <h3 className="font-medium text-foreground">1. При создании учётной записи:</h3>
                  </div>
                  <ul className="list-disc list-inside space-y-1 ml-7">
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

                <Separator className="my-4" />

                {/* 2. При осуществлении рекламной деятельности */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-primary" />
                    <h3 className="font-medium text-foreground">2. При осуществлении рекламной деятельности:</h3>
                  </div>
                  <ul className="list-disc list-inside space-y-1 ml-7">
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

                <Separator className="my-4" />

                <p>
                  Согласие на обработку персональных данных является конкретным, предметным, 
                  информированным, сознательным и однозначным.
                </p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Таблица с категориями персональных данных для распространения */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <Camera className="h-6 w-6 text-primary" />
            </div>
            <div className="w-full">
              <h2 className="text-xl font-semibold mb-4">Согласие на распространение персональных данных</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Настоящим даю согласие на распространение следующих категорий персональных данных:
                </p>
                
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">№</TableHead>
                        <TableHead>Категория персональных данных</TableHead>
                        <TableHead>Перечень персональных данных</TableHead>
                        <TableHead className="text-center">Разрешение к распространению</TableHead>
                        <TableHead>Условия и запреты</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">1</TableCell>
                        <TableCell>Общие</TableCell>
                        <TableCell>Изображение (в том числе фотографии) Пользователя</TableCell>
                        <TableCell className="text-center text-primary font-medium">да</TableCell>
                        <TableCell className="text-muted-foreground">отсутствуют</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">2</TableCell>
                        <TableCell>Общие</TableCell>
                        <TableCell>Видеозапись с изображением Пользователя</TableCell>
                        <TableCell className="text-center text-primary font-medium">да</TableCell>
                        <TableCell className="text-muted-foreground">отсутствуют</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Ссылка на политику конфиденциальности */}
        <GlassCard className="p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 shrink-0">
              <ExternalLink className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-4">Дополнительная информация</h2>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                <p>
                  Полный текст политики конфиденциальности, включая способы обработки данных, 
                  порядок отзыва согласия и правовые основания, доступен по ссылке:
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link 
                    to="/privacy" 
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <FileText className="h-4 w-4" />
                    Политика конфиденциальности
                  </Link>
                  <a 
                    href="https://gorbova.getcourse.ru/politika" 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Политика на GetCourse
                  </a>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </main>

      <LandingFooter />
    </div>
  );
}
