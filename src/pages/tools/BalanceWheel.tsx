import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Target, Lightbulb, CheckCircle2, Loader2, Save, Info } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useRef, useCallback, useEffect } from "react";
import { useBalanceWheel } from "@/hooks/useBalanceWheel";
import { SphereTasks } from "@/components/wheel/SphereTasks";
import { SphereGoals } from "@/components/wheel/SphereGoals";
import { HelpIcon } from "@/components/help/HelpComponents";

const stages = [
  { 
    key: "audit" as const, 
    title: "Здоровье и спорт", 
    color: "hsl(217 91% 60%)",
    description: "Физическое и психическое состояние, уровень энергии, сон, питание и регулярная физическая активность. Основа устойчивости и продуктивности.",
    tooltip: "Энергия, сон, питание и физическая форма. Без ресурса тела страдает всё остальное.",
    questions: [
      "Как я оцениваю своё физическое состояние?",
      "Достаточно ли я сплю и отдыхаю?",
      "Что я делаю для поддержания здоровья?"
    ],
    tasks: [
      "Оценить качество сна за последнюю неделю",
      "Составить список физических активностей",
      "Определить одну привычку для улучшения"
    ]
  },
  { 
    key: "awareness" as const, 
    title: "Деньги", 
    color: "hsl(258 90% 66%)",
    description: "Финансовая стабильность, доход, расходы, накопления и уверенность в завтрашнем дне. Материальная база жизни.",
    tooltip: "Доход, расходы, финансовая безопасность и ощущение устойчивости.",
    questions: [
      "Удовлетворён ли я своим доходом?",
      "Есть ли у меня финансовая подушка?",
      "Контролирую ли я свои расходы?"
    ],
    tasks: [
      "Проанализировать доходы и расходы за месяц",
      "Определить финансовую цель на год",
      "Выявить возможности увеличения дохода"
    ]
  },
  { 
    key: "intention" as const, 
    title: "Работа, карьера и бизнес", 
    color: "hsl(330 81% 60%)",
    description: "Профессиональная реализация, рост дохода, развитие бизнеса и удовлетворённость своей деятельностью.",
    tooltip: "Реализация, рост, результаты и удовлетворённость профессиональной деятельностью.",
    questions: [
      "Приносит ли работа удовлетворение?",
      "Есть ли у меня план карьерного роста?",
      "Развиваюсь ли я профессионально?"
    ],
    tasks: [
      "Оценить текущий уровень удовлетворённости работой",
      "Составить список профессиональных целей",
      "Определить навыки для развития"
    ]
  },
  { 
    key: "goal" as const, 
    title: "Любовь, семья и дети", 
    color: "hsl(350 89% 60%)",
    description: "Отношения с партнёром, детьми и близкими. Эмоциональная поддержка, доверие и чувство принадлежности.",
    tooltip: "Качество близких отношений, поддержка и эмоциональная связь.",
    questions: [
      "Как я оцениваю качество отношений с близкими?",
      "Достаточно ли времени я провожу с семьёй?",
      "Чувствую ли я поддержку и доверие?"
    ],
    tasks: [
      "Выделить время для общения с близкими",
      "Определить, что можно улучшить в отношениях",
      "Запланировать совместное время"
    ]
  },
  { 
    key: "task" as const, 
    title: "Окружение и друзья", 
    color: "hsl(24 94% 53%)",
    description: "Социальные связи, друзья, коллеги и профессиональное окружение, которые влияют на мышление и результаты.",
    tooltip: "Люди, которые формируют привычки, мышление и уровень жизни.",
    questions: [
      "Поддерживает ли меня моё окружение?",
      "С кем я провожу больше всего времени?",
      "Развивают ли меня мои связи?"
    ],
    tasks: [
      "Составить список ключевых людей в жизни",
      "Оценить качество каждого общения",
      "Определить, какие связи укреплять"
    ]
  },
  { 
    key: "plan" as const, 
    title: "Личностный рост", 
    color: "hsl(48 96% 53%)",
    description: "Саморазвитие, обучение, навыки, мышление, чтение и работа над качеством личности.",
    tooltip: "Развитие навыков, обучение и работа над собой.",
    questions: [
      "Чему я научился за последний месяц?",
      "Какие навыки хочу развить?",
      "Читаю ли я, учусь ли?"
    ],
    tasks: [
      "Выбрать книгу или курс для изучения",
      "Определить 3 навыка для развития",
      "Запланировать время на обучение"
    ]
  },
  { 
    key: "action" as const, 
    title: "Хобби и развлечения", 
    color: "hsl(142 71% 45%)",
    description: "Отдых, увлечения, новые впечатления и удовольствие от жизни как источник энергии и баланса.",
    tooltip: "Отдых, удовольствие и восстановление через интересы.",
    questions: [
      "Есть ли у меня хобби?",
      "Как часто я отдыхаю по-настоящему?",
      "Что приносит мне радость?"
    ],
    tasks: [
      "Составить список любимых занятий",
      "Запланировать время для хобби",
      "Попробовать что-то новое"
    ]
  },
  { 
    key: "reflection" as const, 
    title: "Духовность", 
    color: "hsl(188 94% 43%)",
    description: "Ценности, смыслы, мировоззрение, внутренняя гармония, философия или вера.",
    tooltip: "Ценности, смыслы, внутренняя опора и гармония.",
    questions: [
      "Понимаю ли я свои ценности?",
      "Есть ли у меня внутренняя опора?",
      "Живу ли я в согласии с собой?"
    ],
    tasks: [
      "Сформулировать свои главные ценности",
      "Определить, что даёт смысл жизни",
      "Выделить время для рефлексии"
    ]
  },
];

export default function BalanceWheel() {
  const { values, notes, loading, saving, updateValue, updateNotes } = useBalanceWheel();
  const [selectedStage, setSelectedStage] = useState<typeof stages[0] | null>(null);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [localNotes, setLocalNotes] = useState<string>("");
  const [draggingStage, setDraggingStage] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleStageSelect = (stage: typeof stages[0]) => {
    setSelectedStage(stage);
    setLocalNotes(notes[stage.key] || "");
  };

  const handleSaveNotes = async () => {
    if (selectedStage) {
      await updateNotes(selectedStage.key, localNotes);
    }
  };

  const handleDragStart = useCallback((stageKey: string) => {
    setDraggingStage(stageKey);
  }, []);

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!draggingStage || !svgRef.current) return;

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const svgWidth = rect.width;
    const svgHeight = rect.height;
    
    // Convert mouse position to SVG coordinates (0-200 scale)
    const mouseX = ((e.clientX - rect.left) / svgWidth) * 200;
    const mouseY = ((e.clientY - rect.top) / svgHeight) * 200;
    
    const centerX = 100;
    const centerY = 100;
    
    // Calculate distance from center
    const dx = mouseX - centerX;
    const dy = mouseY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Convert distance to value (15-90 radius range maps to 1-10)
    const minRadius = 15;
    const maxRadius = 90;
    const clampedDistance = Math.max(minRadius, Math.min(maxRadius, distance));
    const newValue = Math.round(((clampedDistance - minRadius) / (maxRadius - minRadius)) * 9 + 1);
    
    const stageKey = draggingStage as keyof typeof values;
    if (newValue !== values[stageKey]) {
      updateValue(stageKey, newValue);
    }
  }, [draggingStage, values, updateValue]);

  const handleDragEnd = useCallback(() => {
    setDraggingStage(null);
  }, []);

  useEffect(() => {
    if (draggingStage) {
      document.addEventListener('mousemove', handleDrag);
      document.addEventListener('mouseup', handleDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [draggingStage, handleDrag, handleDragEnd]);

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
            <h1 className="text-3xl font-bold text-foreground">Колесо жизненного баланса</h1>
            <p className="text-muted-foreground">Оцените ключевые сферы жизни и найдите точки роста</p>
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
              <p className="text-sm text-foreground font-medium">Принцип колеса баланса</p>
              <p className="text-sm text-muted-foreground">
                Цель — не идеальные «10», а осознанное управление жизнью и ресурсами. Перетаскивайте точки на колесе или используйте слайдеры.
              </p>
            </div>
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Interactive Wheel */}
          <GlassCard className="flex items-center justify-center p-8">
            <div className="relative w-80 h-80">
              <svg 
                ref={svgRef}
                viewBox="0 0 200 200" 
                className="w-full h-full"
                style={{ cursor: draggingStage ? 'grabbing' : 'default' }}
              >
                {/* Background circles */}
                <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                <circle cx="100" cy="100" r="60" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                <circle cx="100" cy="100" r="30" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                
                {/* Scale markers */}
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
                  const r = 15 + ((n - 1) / 9) * 75;
                  return (
                    <text
                      key={n}
                      x="100"
                      y={100 - r - 2}
                      textAnchor="middle"
                      className="fill-muted-foreground/50 text-[4px]"
                    >
                      {n}
                    </text>
                  );
                })}
                
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
                  const isDragging = draggingStage === stage.key;
                  
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
                      
                      {/* Draggable point */}
                      <circle 
                        cx={x} 
                        cy={y} 
                        r={isDragging ? 12 : isHovered ? 10 : 7} 
                        fill={stage.color}
                        stroke="hsl(var(--background))"
                        strokeWidth="2"
                        style={{ 
                          cursor: isDragging ? "grabbing" : "grab",
                          transition: isDragging ? "none" : "r 0.2s ease",
                          filter: isDragging ? "drop-shadow(0 0 8px rgba(0,0,0,0.3))" : undefined,
                        }}
                        onMouseEnter={() => setHoveredStage(stage.key)}
                        onMouseLeave={() => !draggingStage && setHoveredStage(null)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleDragStart(stage.key);
                        }}
                        onClick={(e) => {
                          if (!draggingStage) {
                            e.stopPropagation();
                            handleStageSelect(stage);
                          }
                        }}
                      />
                      
                      {/* Value tooltip on hover/drag */}
                      {(isHovered || isDragging) && (
                        <g>
                          <rect 
                            x={x - 10} 
                            y={y - 22} 
                            width="20" 
                            height="14" 
                            rx="3" 
                            fill="hsl(var(--card))" 
                            stroke={stage.color}
                            strokeWidth="1"
                          />
                          <text 
                            x={x} 
                            y={y - 12} 
                            textAnchor="middle" 
                            className="fill-foreground text-[8px] font-bold"
                          >
                            {value}
                          </text>
                        </g>
                      )}
                      
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
              
              {/* Drag hint */}
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                Перетащите точку для изменения оценки
              </p>
            </div>
          </GlassCard>

          {/* Sliders */}
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-6">Оцените каждую сферу (1-10)</h3>
            <TooltipProvider>
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
                        <Tooltip>
                          <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-primary cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[250px]">
                            <p className="text-xs">{stage.tooltip}</p>
                          </TooltipContent>
                        </Tooltip>
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
            </TooltipProvider>
          </GlassCard>
        </div>

        {/* Stage cards grid */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4">Сферы жизни</h2>
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

        {/* Methodology section */}
        <GlassCard>
          <h2 className="text-xl font-semibold text-foreground mb-4">Как работать с колесом баланса</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</div>
                <h4 className="font-medium text-foreground">Оценка</h4>
              </div>
              <p className="text-sm text-muted-foreground pl-8">
                Оцените каждую сферу по шкале от 1 до 10, опираясь на реальное текущее состояние, а не на желаемый результат.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</div>
                <h4 className="font-medium text-foreground">Анализ формы</h4>
              </div>
              <p className="text-sm text-muted-foreground pl-8">
                Посмотрите на форму колеса: ровное — устойчивость, перекосы — зоны напряжения, провалы — точки риска.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">3</div>
                <h4 className="font-medium text-foreground">Фокус</h4>
              </div>
              <p className="text-sm text-muted-foreground pl-8">
                Выберите 1–2 сферы с наименьшими значениями. Баланс достигается не усилением сильных зон, а подтягиванием слабых.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">4</div>
                <h4 className="font-medium text-foreground">Малые действия</h4>
              </div>
              <p className="text-sm text-muted-foreground pl-8">
                Определите 1–2 простых действия для улучшения выбранных сфер.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">5</div>
                <h4 className="font-medium text-foreground">Регулярность</h4>
              </div>
              <p className="text-sm text-muted-foreground pl-8">
                Возвращайтесь к колесу раз в месяц или квартал, чтобы отслеживать динамику.
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Stage detail dialog */}
      <Dialog open={!!selectedStage} onOpenChange={() => setSelectedStage(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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

              {/* User Goals Section */}
              <SphereGoals sphereKey={selectedStage.key} sphereTitle={selectedStage.title} />

              {/* User Tasks Section */}
              <SphereTasks sphereKey={selectedStage.key} sphereTitle={selectedStage.title} />
              
              <div>
                <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  Рекомендации
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
                  placeholder="Запишите свои мысли по этой сфере..."
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
                <label className="text-sm font-medium text-foreground">Ваша оценка сферы</label>
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
