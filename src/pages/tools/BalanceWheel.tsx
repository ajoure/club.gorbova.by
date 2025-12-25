import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Target, Lightbulb, CheckCircle2, Loader2, Save } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useBalanceWheel } from "@/hooks/useBalanceWheel";

const stages = [
  { 
    key: "audit" as const, 
    title: "Аудит", 
    color: "hsl(217 91% 60%)",
    description: "Анализ текущего состояния дел и ресурсов",
    questions: [
      "Где я нахожусь сейчас?",
      "Какие ресурсы у меня есть?",
      "Что работает, а что нет?"
    ],
    tasks: [
      "Провести инвентаризацию ресурсов",
      "Составить список достижений и провалов",
      "Оценить текущие показатели"
    ]
  },
  { 
    key: "awareness" as const, 
    title: "Осознание", 
    color: "hsl(258 90% 66%)",
    description: "Понимание истинных причин и мотивов",
    questions: [
      "Почему это важно для меня?",
      "Какие убеждения мной управляют?",
      "Что я избегаю признать?"
    ],
    tasks: [
      "Записать свои истинные мотивы",
      "Выявить ограничивающие убеждения",
      "Принять текущую реальность"
    ]
  },
  { 
    key: "intention" as const, 
    title: "Намерение", 
    color: "hsl(330 81% 60%)",
    description: "Формирование твердого решения действовать",
    questions: [
      "Чего я действительно хочу?",
      "Готов ли я заплатить цену?",
      "Что я обещаю себе?"
    ],
    tasks: [
      "Сформулировать чёткое намерение",
      "Принять ответственность",
      "Зафиксировать обязательство"
    ]
  },
  { 
    key: "goal" as const, 
    title: "Цель", 
    color: "hsl(350 89% 60%)",
    description: "Определение конкретного желаемого результата",
    questions: [
      "Как выглядит успех?",
      "Как я узнаю, что достиг цели?",
      "Когда это должно произойти?"
    ],
    tasks: [
      "Сформулировать SMART-цель",
      "Визуализировать результат",
      "Установить дедлайн"
    ]
  },
  { 
    key: "task" as const, 
    title: "Задача", 
    color: "hsl(24 94% 53%)",
    description: "Декомпозиция цели на конкретные шаги",
    questions: [
      "Какие шаги нужно сделать?",
      "Что первое?",
      "Кто может помочь?"
    ],
    tasks: [
      "Разбить цель на подзадачи",
      "Определить зависимости",
      "Назначить ответственных"
    ]
  },
  { 
    key: "plan" as const, 
    title: "План", 
    color: "hsl(48 96% 53%)",
    description: "Выстраивание задач во времени",
    questions: [
      "В каком порядке действовать?",
      "Сколько времени на каждый этап?",
      "Какие риски учесть?"
    ],
    tasks: [
      "Составить дорожную карту",
      "Расставить приоритеты",
      "Предусмотреть план Б"
    ]
  },
  { 
    key: "action" as const, 
    title: "Действие", 
    color: "hsl(142 71% 45%)",
    description: "Систематическое выполнение плана",
    questions: [
      "Что я делаю сегодня?",
      "Следую ли я плану?",
      "Есть ли прогресс?"
    ],
    tasks: [
      "Выполнить первый шаг",
      "Отслеживать прогресс",
      "Корректировать действия"
    ]
  },
  { 
    key: "reflection" as const, 
    title: "Рефлексия", 
    color: "hsl(188 94% 43%)",
    description: "Анализ результатов и извлечение уроков",
    questions: [
      "Что получилось?",
      "Чему я научился?",
      "Что сделать иначе?"
    ],
    tasks: [
      "Подвести итоги",
      "Зафиксировать уроки",
      "Начать новый цикл"
    ]
  },
];

export default function BalanceWheel() {
  const { values, notes, loading, saving, updateValue, updateNotes } = useBalanceWheel();
  const [selectedStage, setSelectedStage] = useState<typeof stages[0] | null>(null);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [localNotes, setLocalNotes] = useState<string>("");

  const handleStageSelect = (stage: typeof stages[0]) => {
    setSelectedStage(stage);
    setLocalNotes(notes[stage.key] || "");
  };

  const handleSaveNotes = async () => {
    if (selectedStage) {
      await updateNotes(selectedStage.key, localNotes);
    }
  };

  const total = Object.values(values).reduce((a, b) => a + b, 0);
  const average = (total / stages.length).toFixed(1);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Target className="w-7 h-7 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">Колесо баланса</h1>
            <p className="text-muted-foreground">Стратегическое планирование через 8 этапов развития</p>
          </div>
          {saving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Сохранение...
            </div>
          )}
        </div>

        {/* Strategy hint */}
        <GlassCard className="bg-primary/5 border-primary/20">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-foreground font-medium">Движение по колесу</p>
              <p className="text-sm text-muted-foreground">
                Каждый этап — шаг к цели. Нажмите на сектор, чтобы погрузиться в работу с этапом. Данные сохраняются автоматически.
              </p>
            </div>
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Interactive Wheel */}
          <GlassCard className="flex items-center justify-center p-8">
            <div className="relative w-80 h-80">
              <svg viewBox="0 0 200 200" className="w-full h-full">
                {/* Background circles */}
                <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                <circle cx="100" cy="100" r="60" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                <circle cx="100" cy="100" r="30" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                
                {/* Sector lines and interactive areas */}
                {stages.map((stage, i) => {
                  const angle = (i * 360) / stages.length - 90;
                  const rad = (angle * Math.PI) / 180;
                  const value = values[stage.key];
                  const radius = 15 + (value / 10) * 75;
                  const x = 100 + Math.cos(rad) * radius;
                  const y = 100 + Math.sin(rad) * radius;
                  const nextAngle = ((i + 1) * 360) / stages.length - 90;
                  const nextRad = (nextAngle * Math.PI) / 180;
                  const nextValue = values[stages[(i + 1) % stages.length].key];
                  const nextRadius = 15 + (nextValue / 10) * 75;
                  const nextX = 100 + Math.cos(nextRad) * nextRadius;
                  const nextY = 100 + Math.sin(nextRad) * nextRadius;
                  
                  const labelRadius = 95;
                  const labelX = 100 + Math.cos(rad) * labelRadius;
                  const labelY = 100 + Math.sin(rad) * labelRadius;
                  
                  const isHovered = hoveredStage === stage.key;
                  
                  return (
                    <g key={stage.key}>
                      {/* Sector line */}
                      <line 
                        x1="100" 
                        y1="100" 
                        x2={100 + Math.cos(rad) * 90} 
                        y2={100 + Math.sin(rad) * 90} 
                        stroke="hsl(var(--border))" 
                        strokeWidth="1" 
                      />
                      
                      {/* Value line connecting points */}
                      <line 
                        x1={x} 
                        y1={y} 
                        x2={nextX} 
                        y2={nextY} 
                        stroke={stage.color} 
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                      
                      {/* Interactive point */}
                      <circle 
                        cx={x} 
                        cy={y} 
                        r={isHovered ? 10 : 7} 
                        fill={stage.color}
                        stroke="hsl(var(--background))"
                        strokeWidth="2"
                        style={{ 
                          cursor: "pointer",
                          transition: "r 0.2s ease"
                        }}
                        onMouseEnter={() => setHoveredStage(stage.key)}
                        onMouseLeave={() => setHoveredStage(null)}
                        onClick={() => handleStageSelect(stage)}
                      />
                      
                      {/* Label */}
                      <text 
                        x={labelX} 
                        y={labelY} 
                        textAnchor="middle" 
                        dominantBaseline="middle"
                        className="fill-muted-foreground text-[6px] font-medium cursor-pointer hover:fill-primary transition-colors"
                        onClick={() => handleStageSelect(stage)}
                      >
                        {stage.title}
                      </text>
                    </g>
                  );
                })}
                
                {/* Center score */}
                <circle cx="100" cy="100" r="22" fill="hsl(var(--card))" />
                <text x="100" y="97" textAnchor="middle" className="fill-foreground text-lg font-bold">{average}</text>
                <text x="100" y="108" textAnchor="middle" className="fill-muted-foreground text-[5px]">баланс</text>
              </svg>
            </div>
          </GlassCard>

          {/* Sliders */}
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-6">Оцените каждый этап (1-10)</h3>
            <div className="space-y-4">
              {stages.map(stage => (
                <div 
                  key={stage.key} 
                  className="group p-3 -mx-3 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => handleStageSelect(stage)}
                >
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full transition-transform group-hover:scale-125" 
                        style={{ backgroundColor: stage.color }} 
                      />
                      <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {stage.title}
                      </span>
                    </div>
                    <span className="text-sm font-bold" style={{ color: stage.color }}>{values[stage.key]}</span>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Slider 
                      value={[values[stage.key]]} 
                      min={1} 
                      max={10} 
                      step={1} 
                      onValueChange={(v) => updateValue(stage.key, v[0])} 
                      className="w-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Stage cards grid */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4">Этапы стратегии</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stages.map((stage, i) => (
              <GlassCard 
                key={stage.key} 
                hover
                onClick={() => handleStageSelect(stage)}
                className="text-center"
              >
                <div 
                  className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-primary-foreground font-bold"
                  style={{ backgroundColor: stage.color }}
                >
                  {i + 1}
                </div>
                <h4 className="font-semibold text-foreground mb-1">{stage.title}</h4>
                <p className="text-xs text-muted-foreground line-clamp-2">{stage.description}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>

      {/* Stage detail dialog */}
      <Dialog open={!!selectedStage} onOpenChange={() => setSelectedStage(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-primary-foreground font-bold"
                style={{ backgroundColor: selectedStage?.color }}
              >
                {stages.findIndex(s => s.key === selectedStage?.key) + 1}
              </div>
              {selectedStage?.title}
            </DialogTitle>
          </DialogHeader>
          
          {selectedStage && (
            <div className="space-y-6 pt-2">
              <p className="text-muted-foreground">{selectedStage.description}</p>
              
              <div>
                <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-primary" />
                  Ключевые вопросы
                </h4>
                <ul className="space-y-2">
                  {selectedStage.questions.map((q, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary">•</span>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div>
                <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Задания
                </h4>
                <ul className="space-y-2">
                  {selectedStage.tasks.map((t, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-muted text-xs flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Notes */}
              <div>
                <h4 className="font-semibold text-foreground mb-3">Ваши заметки</h4>
                <Textarea
                  placeholder="Запишите свои мысли по этому этапу..."
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  className="min-h-[80px]"
                />
                <button
                  onClick={handleSaveNotes}
                  className="mt-2 flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Save className="w-4 h-4" />
                  Сохранить заметки
                </button>
              </div>
              
              <div className="pt-2">
                <label className="text-sm font-medium text-foreground">Ваша оценка этапа</label>
                <div className="flex items-center gap-4 mt-2">
                  <Slider 
                    value={[values[selectedStage.key]]} 
                    min={1} 
                    max={10} 
                    step={1} 
                    onValueChange={(v) => updateValue(selectedStage.key, v[0])} 
                    className="flex-1"
                  />
                  <span 
                    className="text-xl font-bold w-8 text-center"
                    style={{ color: selectedStage.color }}
                  >
                    {values[selectedStage.key]}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
