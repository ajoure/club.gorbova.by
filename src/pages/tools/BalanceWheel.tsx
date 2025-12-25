import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Target } from "lucide-react";
import { Slider } from "@/components/ui/slider";

const stages = [
  { key: "audit", title: "Аудит", color: "#3B82F6" },
  { key: "awareness", title: "Осознание", color: "#8B5CF6" },
  { key: "intention", title: "Намерение", color: "#EC4899" },
  { key: "goal", title: "Цель", color: "#F43F5E" },
  { key: "task", title: "Задача", color: "#F97316" },
  { key: "plan", title: "План", color: "#EAB308" },
  { key: "action", title: "Действие", color: "#22C55E" },
  { key: "reflection", title: "Рефлексия", color: "#06B6D4" },
];

export default function BalanceWheel() {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(stages.map(s => [s.key, 5]))
  );

  const updateValue = (key: string, value: number[]) => {
    setValues(prev => ({ ...prev, [key]: value[0] }));
  };

  const total = Object.values(values).reduce((a, b) => a + b, 0);
  const average = (total / stages.length).toFixed(1);

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Target className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Колесо баланса</h1>
            <p className="text-muted-foreground">Стратегия через 8 этапов развития</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Wheel visualization */}
          <GlassCard className="flex items-center justify-center p-8">
            <div className="relative w-72 h-72">
              <svg viewBox="0 0 200 200" className="w-full h-full">
                {stages.map((stage, i) => {
                  const angle = (i * 360) / stages.length - 90;
                  const rad = (angle * Math.PI) / 180;
                  const value = values[stage.key];
                  const radius = 20 + (value / 10) * 70;
                  const x = 100 + Math.cos(rad) * radius;
                  const y = 100 + Math.sin(rad) * radius;
                  const nextAngle = ((i + 1) * 360) / stages.length - 90;
                  const nextRad = (nextAngle * Math.PI) / 180;
                  const nextValue = values[stages[(i + 1) % stages.length].key];
                  const nextRadius = 20 + (nextValue / 10) * 70;
                  const nextX = 100 + Math.cos(nextRad) * nextRadius;
                  const nextY = 100 + Math.sin(nextRad) * nextRadius;
                  
                  return (
                    <g key={stage.key}>
                      <line x1="100" y1="100" x2={100 + Math.cos(rad) * 90} y2={100 + Math.sin(rad) * 90} stroke="hsl(var(--border))" strokeWidth="1" />
                      <line x1={x} y1={y} x2={nextX} y2={nextY} stroke={stage.color} strokeWidth="2" />
                      <circle cx={x} cy={y} r="6" fill={stage.color} />
                    </g>
                  );
                })}
                <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                <circle cx="100" cy="100" r="45" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4" />
                <text x="100" y="105" textAnchor="middle" className="fill-foreground text-2xl font-bold">{average}</text>
              </svg>
            </div>
          </GlassCard>

          {/* Sliders */}
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-6">Оцените каждый этап (1-10)</h3>
            <div className="space-y-5">
              {stages.map(stage => (
                <div key={stage.key} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-sm font-medium text-foreground">{stage.title}</span>
                    </div>
                    <span className="text-sm font-bold text-primary">{values[stage.key]}</span>
                  </div>
                  <Slider value={[values[stage.key]]} min={1} max={10} step={1} onValueChange={(v) => updateValue(stage.key, v)} className="w-full" />
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
