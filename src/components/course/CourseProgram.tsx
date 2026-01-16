import { AnimatedSection } from "@/components/landing/AnimatedSection";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { BookOpen, Gift, Gamepad2, MessageSquare, Video, Brain, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const modules = [
  {
    id: "pre",
    title: "Предобучение",
    subtitle: "Законы эффективного обучения",
    isBonus: true,
    results: [
      "PDF-гайд по эффективному обучению",
      "Рабочая тетрадь для конспектов", 
      "Медитация для настройки на обучение"
    ]
  },
  {
    id: "01",
    title: "Введение в профессию",
    subtitle: "Кто такой бухгалтер?",
    results: [
      "Определите необходимые компетенции",
      "Обозначите свою точку Б после курса"
    ]
  },
  {
    id: "02",
    title: "Классификация имущества",
    subtitle: "ОС vs запасы",
    results: [
      "Научитесь отличать ОС от запасов",
      "Освоите 12 субсчетов счета 10"
    ]
  },
  {
    id: "03",
    title: "Бухгалтерский баланс",
    subtitle: "Структура и принципы",
    results: [
      "Поймете структуру баланса",
      "Научитесь читать финансовую отчетность"
    ]
  },
  {
    id: "04",
    title: "Двойная запись",
    subtitle: "Основа бухучета",
    results: [
      "Освоите принцип двойной записи",
      "Научитесь составлять проводки"
    ]
  },
  {
    id: "05",
    title: "Учет денежных средств",
    subtitle: "Касса и расчетный счет",
    results: [
      "Освоите учет кассовых операций",
      "Научитесь работать с банком"
    ]
  },
  {
    id: "06",
    title: "Учет расчетов",
    subtitle: "Дебиторка и кредиторка",
    results: [
      "Научитесь вести расчеты с контрагентами",
      "Освоите сверку задолженности"
    ]
  },
  {
    id: "07",
    title: "Учет товаров",
    subtitle: "От поступления до продажи",
    results: [
      "Научитесь вести складской учет",
      "Освоите методы оценки товаров"
    ]
  },
  {
    id: "08",
    title: "Учет материалов",
    subtitle: "Производственные запасы",
    results: [
      "Научитесь классифицировать материалы",
      "Освоите методы списания"
    ]
  },
  {
    id: "09",
    title: "Учет основных средств",
    subtitle: "Амортизация и переоценка",
    results: [
      "Научитесь начислять амортизацию",
      "Освоите переоценку ОС"
    ]
  },
  {
    id: "10",
    title: "Учет НМА",
    subtitle: "Нематериальные активы",
    results: [
      "Научитесь идентифицировать НМА",
      "Освоите учет программного обеспечения"
    ]
  },
  {
    id: "11",
    title: "Учет труда и зарплаты",
    subtitle: "Начисления и удержания",
    results: [
      "Научитесь начислять зарплату",
      "Освоите все виды удержаний"
    ]
  },
  {
    id: "12",
    title: "Налоги с ФОТ",
    subtitle: "Подоходный, ФСЗН, страховые",
    results: [
      "Освоите расчет подоходного налога",
      "Научитесь работать с ФСЗН"
    ]
  },
  {
    id: "13",
    title: "Себестоимость",
    subtitle: "Калькулирование затрат",
    results: [
      "Научитесь калькулировать себестоимость",
      "Освоите распределение затрат"
    ]
  },
  {
    id: "14",
    title: "Доходы и расходы",
    subtitle: "Финансовый результат",
    results: [
      "Научитесь формировать финансовый результат",
      "Освоите учет прочих доходов/расходов"
    ]
  },
  {
    id: "15",
    title: "НДС",
    subtitle: "Исчисление и вычеты",
    results: [
      "Освоите механизм НДС",
      "Научитесь применять вычеты"
    ]
  },
  {
    id: "16",
    title: "Налог на прибыль",
    subtitle: "Расчет и декларирование",
    results: [
      "Научитесь рассчитывать налог",
      "Освоите налоговый учет"
    ]
  },
  {
    id: "17",
    title: "Прочие налоги",
    subtitle: "Земельный, экологический",
    results: [
      "Освоите специфические налоги",
      "Научитесь их рассчитывать"
    ]
  },
  {
    id: "18",
    title: "Отчетность",
    subtitle: "Баланс, ОПУ, примечания",
    results: [
      "Научитесь составлять отчетность",
      "Освоите взаимоувязку форм"
    ]
  },
  {
    id: "vip-1",
    title: "Делегирование",
    subtitle: "VIP модуль",
    isVip: true,
    results: [
      "Научитесь делегировать задачи",
      "Освободите время для стратегии"
    ]
  },
  {
    id: "vip-2",
    title: "Найм и адаптация",
    subtitle: "VIP модуль",
    isVip: true,
    results: [
      "Научитесь нанимать помощников",
      "Создадите систему адаптации"
    ]
  },
  {
    id: "vip-3",
    title: "Таймлайн месяца",
    subtitle: "VIP модуль",
    isVip: true,
    results: [
      "Создадите систему работы",
      "Никогда не пропустите сроки"
    ]
  }
];

const boosters = [
  { icon: Gamepad2, label: "Интерактивная игра" },
  { icon: MessageSquare, label: "Разбор ДЗ" },
  { icon: Video, label: "Конференция" },
  { icon: Brain, label: "Майндкарта" },
];

export function CourseProgram() {
  return (
    <section id="program" className="py-20 md:py-28 bg-muted/30 relative overflow-hidden">
      <div className="container mx-auto px-4">
        <AnimatedSection>
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">Программа курса</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              25 модулей с теорией, практикой и разбором реальных кейсов
            </p>
            
            {/* Boosters legend */}
            <div className="flex flex-wrap justify-center gap-4">
              {boosters.map((booster, index) => (
                <div key={index} className="flex items-center gap-2 text-sm text-muted-foreground bg-card/50 px-3 py-1.5 rounded-full border border-border/50">
                  <booster.icon className="w-4 h-4 text-primary" />
                  <span>{booster.label}</span>
                </div>
              ))}
            </div>
          </div>
        </AnimatedSection>

        <div className="max-w-4xl mx-auto">
          <AnimatedSection delay={100}>
            <Accordion type="single" collapsible className="space-y-3">
              {modules.map((module, index) => (
                <AccordionItem 
                  key={module.id} 
                  value={`module-${module.id}`}
                  className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl px-5 data-[state=open]:border-primary/50 data-[state=open]:shadow-lg data-[state=open]:shadow-primary/5 transition-all duration-300"
                >
                  <AccordionTrigger className="hover:no-underline py-5">
                    <div className="flex items-center gap-4 text-left w-full pr-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        module.isBonus 
                          ? 'bg-gradient-to-br from-[hsl(43,50%,55%)] to-[hsl(43,60%,45%)]' 
                          : module.isVip 
                            ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                            : 'bg-primary/10'
                      }`}>
                        {module.isBonus ? (
                          <Gift className="w-5 h-5 text-[hsl(222,47%,11%)]" />
                        ) : (
                          <BookOpen className={`w-5 h-5 ${module.isVip ? 'text-white' : 'text-primary'}`} />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{module.isBonus ? '' : `#${module.id} `}{module.title}</span>
                          {module.isBonus && (
                            <Badge variant="secondary" className="bg-[hsl(43,50%,55%)/0.15] text-[hsl(43,50%,45%)] border-0 text-xs">
                              Бонус
                            </Badge>
                          )}
                          {module.isVip && (
                            <Badge variant="secondary" className="bg-purple-500/15 text-purple-600 border-0 text-xs">
                              VIP
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{module.subtitle}</p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 pl-14">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium mb-2 text-foreground/80">Результаты модуля:</h4>
                        <ul className="space-y-2">
                          {module.results.map((result, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                              <span>{result}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      
                      {/* Boosters for main modules */}
                      {!module.isBonus && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {boosters.map((booster, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
                              <booster.icon className="w-3 h-3 text-primary" />
                              <span>{booster.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </AnimatedSection>
        </div>
      </div>
    </section>
  );
}
