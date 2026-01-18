import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CalendarCheck, Plus, Flame, Target, Check, X, Trash2, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useHabitChallenges, CreateChallengeInput } from "@/hooks/useHabitTracker";
import { format, addDays, parseISO, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isBefore, isAfter, isToday } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

const colorOptions = [
  { value: "emerald", label: "Изумрудный", class: "bg-emerald-500" },
  { value: "blue", label: "Синий", class: "bg-blue-500" },
  { value: "purple", label: "Фиолетовый", class: "bg-purple-500" },
  { value: "orange", label: "Оранжевый", class: "bg-orange-500" },
  { value: "pink", label: "Розовый", class: "bg-pink-500" },
];

const durationOptions = [
  { value: 7, label: "7 дней" },
  { value: 14, label: "14 дней" },
  { value: 21, label: "21 день" },
  { value: 30, label: "30 дней" },
  { value: 60, label: "60 дней" },
  { value: 90, label: "90 дней" },
];

export default function HabitTracker() {
  const navigate = useNavigate();
  const { challenges, isLoading, createChallenge, logDay, deleteChallenge, archiveChallenge } = useHabitChallenges();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newChallenge, setNewChallenge] = useState<CreateChallengeInput>({
    title: "",
    description: "",
    duration_days: 30,
    unit_label: "",
    target_value: undefined,
    color: "emerald",
  });

  const handleCreateChallenge = async () => {
    if (!newChallenge.title.trim()) return;
    
    await createChallenge.mutateAsync(newChallenge);
    setIsDialogOpen(false);
    setNewChallenge({
      title: "",
      description: "",
      duration_days: 30,
      unit_label: "",
      target_value: undefined,
      color: "emerald",
    });
  };

  const handleLogToday = async (challengeId: string, isCompleted: boolean, value?: number) => {
    await logDay.mutateAsync({
      challengeId,
      date: format(new Date(), "yyyy-MM-dd"),
      isCompleted,
      value,
    });
  };

  const getColorClass = (color: string | null) => {
    const colorMap: Record<string, string> = {
      emerald: "from-emerald-500 to-teal-600",
      blue: "from-blue-500 to-indigo-600",
      purple: "from-purple-500 to-violet-600",
      orange: "from-orange-500 to-amber-600",
      pink: "from-pink-500 to-rose-600",
    };
    return colorMap[color || "emerald"] || colorMap.emerald;
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/self-development")}
              className="shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                <CalendarCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Трекер привычек</h1>
                <p className="text-muted-foreground text-sm">Формируйте полезные привычки шаг за шагом</p>
              </div>
            </div>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Новый челлендж
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Создать челлендж</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Название</Label>
                  <Input
                    id="title"
                    placeholder="Например: Пить 2 литра воды"
                    value={newChallenge.title}
                    onChange={(e) => setNewChallenge(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Описание (необязательно)</Label>
                  <Textarea
                    id="description"
                    placeholder="Подробности о вашей цели..."
                    value={newChallenge.description}
                    onChange={(e) => setNewChallenge(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Длительность</Label>
                    <Select
                      value={String(newChallenge.duration_days)}
                      onValueChange={(value) => setNewChallenge(prev => ({ ...prev, duration_days: Number(value) }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {durationOptions.map(opt => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Цвет</Label>
                    <Select
                      value={newChallenge.color}
                      onValueChange={(value) => setNewChallenge(prev => ({ ...prev, color: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {colorOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex items-center gap-2">
                              <div className={cn("w-3 h-3 rounded-full", opt.class)} />
                              {opt.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="target">Цель в день (необязательно)</Label>
                    <Input
                      id="target"
                      type="number"
                      placeholder="2"
                      value={newChallenge.target_value || ""}
                      onChange={(e) => setNewChallenge(prev => ({ 
                        ...prev, 
                        target_value: e.target.value ? Number(e.target.value) : undefined 
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unit">Единица измерения</Label>
                    <Input
                      id="unit"
                      placeholder="л, раз, мин"
                      value={newChallenge.unit_label}
                      onChange={(e) => setNewChallenge(prev => ({ ...prev, unit_label: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Отмена
                </Button>
                <Button onClick={handleCreateChallenge} disabled={!newChallenge.title.trim() || createChallenge.isPending}>
                  {createChallenge.isPending ? "Создание..." : "Создать"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Challenges List */}
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : !challenges?.length ? (
          <Card className="p-12 text-center">
            <CalendarCheck className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Нет активных челленджей</h3>
            <p className="text-muted-foreground mb-4">
              Создайте свой первый челлендж и начните формировать полезные привычки
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Создать челлендж
            </Button>
          </Card>
        ) : (
          <div className="space-y-6">
            {challenges.map((challenge) => (
              <ChallengeCard
                key={challenge.id}
                challenge={challenge}
                colorClass={getColorClass(challenge.color)}
                onLogToday={handleLogToday}
                onDelete={() => deleteChallenge.mutate(challenge.id)}
                onArchive={() => archiveChallenge.mutate(challenge.id)}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

interface ChallengeCardProps {
  challenge: ReturnType<typeof useHabitChallenges>["challenges"] extends (infer T)[] | undefined ? T : never;
  colorClass: string;
  onLogToday: (challengeId: string, isCompleted: boolean, value?: number) => void;
  onDelete: () => void;
  onArchive: () => void;
}

function ChallengeCard({ challenge, colorClass, onLogToday, onDelete, onArchive }: ChallengeCardProps) {
  const [inputValue, setInputValue] = useState<string>("");
  const startDate = parseISO(challenge.start_date);
  const endDate = addDays(startDate, challenge.duration_days - 1);
  
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfWeek = getDay(monthStart); // 0 = Sunday
  const adjustedFirstDay = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Adjust for Monday start

  const completedPercent = challenge.duration_days > 0
    ? Math.round((challenge.completedDays / challenge.duration_days) * 100)
    : 0;

  const handleMarkComplete = () => {
    const value = inputValue ? Number(inputValue) : undefined;
    onLogToday(challenge.id, true, value);
    setInputValue("");
  };

  const getDayStatus = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const log = challenge.logs.find(l => l.log_date === dateStr);
    
    if (isBefore(date, startDate) || isAfter(date, endDate)) {
      return "outside";
    }
    if (isAfter(date, today)) {
      return "future";
    }
    if (log?.is_completed) {
      return "completed";
    }
    if (isSameDay(date, today)) {
      return "today";
    }
    return "missed";
  };

  return (
    <Card className="overflow-hidden border-0 shadow-lg">
      {/* Header */}
      <div className={cn("bg-gradient-to-br text-white p-6", colorClass)}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold">{challenge.title}</h3>
              <p className="text-white/70 text-sm">
                День {challenge.currentDay} из {challenge.duration_days}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {challenge.currentStreak > 0 && (
              <div className="flex items-center gap-1 bg-white/20 rounded-lg px-3 py-1.5">
                <Flame className="w-4 h-4" />
                <span className="font-bold">{challenge.currentStreak}</span>
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onArchive}>
                  Архивировать
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-white/70">Прогресс</span>
            <span>{challenge.completedDays} / {challenge.duration_days} дней ({completedPercent}%)</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${completedPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground mb-3">
          {format(today, "LLLL yyyy", { locale: ru })}
        </p>
        
        <div className="grid grid-cols-7 gap-1 mb-4">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => (
            <div key={day} className="text-center text-xs text-muted-foreground py-1">
              {day}
            </div>
          ))}
          
          {/* Empty cells for alignment */}
          {Array.from({ length: adjustedFirstDay }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          
          {daysInMonth.map((date) => {
            const status = getDayStatus(date);
            
            return (
              <div
                key={date.toISOString()}
                className={cn(
                  "aspect-square flex items-center justify-center rounded-md text-sm transition-all",
                  status === "completed" && "bg-primary text-primary-foreground",
                  status === "missed" && "bg-destructive/20 text-destructive",
                  status === "today" && !challenge.todayLog?.is_completed && "bg-primary/20 text-primary ring-2 ring-primary",
                  status === "today" && challenge.todayLog?.is_completed && "bg-primary text-primary-foreground ring-2 ring-primary",
                  status === "future" && "text-muted-foreground/50",
                  status === "outside" && "text-muted-foreground/30"
                )}
              >
                {status === "completed" || (status === "today" && challenge.todayLog?.is_completed) ? (
                  <Check className="w-4 h-4" />
                ) : status === "missed" ? (
                  <X className="w-3 h-3" />
                ) : (
                  format(date, "d")
                )}
              </div>
            );
          })}
        </div>

        {/* Today's Log */}
        {challenge.isToday && !challenge.todayLog?.is_completed && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">Отметить сегодня</p>
            <div className="flex items-center gap-3">
              {challenge.target_value && challenge.unit_label && (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    type="number"
                    placeholder={String(challenge.target_value)}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">{challenge.unit_label}</span>
                </div>
              )}
              <Button onClick={handleMarkComplete} className="gap-2">
                <Check className="w-4 h-4" />
                Выполнено
              </Button>
            </div>
          </div>
        )}

        {challenge.todayLog?.is_completed && (
          <div className="border-t pt-4 flex items-center gap-2 text-primary">
            <Check className="w-5 h-5" />
            <span className="font-medium">Сегодня выполнено!</span>
            {challenge.todayLog.value && challenge.unit_label && (
              <span className="text-muted-foreground">
                ({challenge.todayLog.value} {challenge.unit_label})
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
