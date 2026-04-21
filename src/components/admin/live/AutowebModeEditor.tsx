/**
 * Sprint A: Конструктор режима автовебинара.
 *
 * 4 user-modes (UI):
 *   - one_time      → сохраняется как event_type='recorded_webinar' (без дублей в БД)
 *   - scheduled     → event_type='autowebinar' + autoweb_mode='scheduled'
 *   - just_in_time  → event_type='autowebinar' + autoweb_mode='just_in_time'
 *   - on_demand     → event_type='autowebinar' + autoweb_mode='on_demand'
 *
 * RRULE генерируется внутри из визуального редактора (дни недели + временные слоты).
 * Для админа RRULE никогда не показывается в сыром виде — только превью «Ближайшие N запусков».
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Calendar, Clock, Zap, PlayCircle, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

export type AutowebUserMode = "one_time" | "scheduled" | "just_in_time" | "on_demand";

export interface AutowebConfig {
  schedule?: {
    /** PATCH-1: массив RRULE — по одному на каждый time-slot (нет декартова BYHOUR×BYMINUTE). */
    rrules?: string[];
    /** Legacy single RRULE — оставлен для обратной совместимости при чтении. */
    rrule?: string;
    timezone?: string;
    occurrences_window_days?: number;
    blackout_dates?: string[];
    /** UI-only — храним отдельно для последующей пересборки RRULE */
    weekdays?: number[]; // 1=ПН .. 7=ВС
    times?: string[]; // ["19:00", "20:30"]
  };
  just_in_time?: {
    offsets_minutes?: number[];
    show_countdown?: boolean;
  };
  on_demand?: {
    min_delay_seconds?: number;
  };
  replay?: {
    enabled?: boolean;
    open_strategy?: "immediate" | "after_delay";
    delay_minutes?: number;
    window_hours?: number;
    show_chat_history?: boolean;
    cta_strategy?: "same_as_live" | "replay_only";
  };
  video?: {
    kinescope_video_id?: string;
    duration_seconds?: number;
  };
  viewer_controls?: {
    allow_pause?: boolean;
    allow_seek?: boolean;
    allow_speed_control?: boolean;
    resume_from_last_position?: boolean;
    allow_rewatch_before_end?: boolean;
  };
}

interface Props {
  userMode: AutowebUserMode;
  onUserModeChange: (mode: AutowebUserMode) => void;
  config: AutowebConfig;
  onConfigChange: (cfg: AutowebConfig) => void;
  timezone: string;
}

const WEEKDAYS_RU = [
  { idx: 1, label: "Пн", rrule: "MO" },
  { idx: 2, label: "Вт", rrule: "TU" },
  { idx: 3, label: "Ср", rrule: "WE" },
  { idx: 4, label: "Чт", rrule: "TH" },
  { idx: 5, label: "Пт", rrule: "FR" },
  { idx: 6, label: "Сб", rrule: "SA" },
  { idx: 7, label: "Вс", rrule: "SU" },
];

const JIT_OFFSET_OPTIONS = [5, 10, 15, 30, 60];

/**
 * PATCH-1: строим МАССИВ RRULE — по одному per time-slot.
 * Это устраняет баг декартова произведения BYHOUR × BYMINUTE
 * (раньше 09:15 + 10:30 разворачивались в 09:15 / 09:30 / 10:15 / 10:30).
 */
function buildRRules(weekdays: number[], times: string[]): string[] {
  if (weekdays.length === 0 || times.length === 0) return [];
  const byday = weekdays
    .map((idx) => WEEKDAYS_RU.find((w) => w.idx === idx)?.rrule)
    .filter(Boolean)
    .join(",");
  return times
    .map((t) => {
      const [hh, mm] = t.split(":");
      const h = parseInt(hh ?? "0", 10);
      const m = parseInt(mm ?? "0", 10);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return `FREQ=WEEKLY;BYDAY=${byday};BYHOUR=${h};BYMINUTE=${m}`;
    })
    .filter((s): s is string => !!s);
}

export function AutowebModeEditor({ userMode, onUserModeChange, config, onConfigChange, timezone }: Props) {
  const cfg = config ?? {};
  const sched = cfg.schedule ?? {};
  const jit = cfg.just_in_time ?? {};
  const od = cfg.on_demand ?? {};
  const replay = cfg.replay ?? {};
  const vc = cfg.viewer_controls ?? {};

  const weekdays = sched.weekdays ?? [1, 3, 5];
  const times = sched.times ?? ["19:00"];
  const windowDays = sched.occurrences_window_days ?? 14;
  const blackoutDates = sched.blackout_dates ?? [];

  const jitOffsets = jit.offsets_minutes ?? [5, 10, 15, 30];
  const showCountdown = jit.show_countdown !== false;
  const minDelay = od.min_delay_seconds ?? 0;

  // Превью ближайших запусков (только для scheduled)
  const [preview, setPreview] = useState<Array<{ starts_at: string; ends_at: string }>>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const rrules = useMemo(() => buildRRules(weekdays, times), [weekdays, times]);
  const rrulesKey = useMemo(() => rrules.join("|"), [rrules]);
  const storedKey = useMemo(() => (sched.rrules ?? []).join("|"), [sched.rrules]);

  // Auto-update rrules в config при изменениях
  useEffect(() => {
    if (userMode !== "scheduled") return;
    if (storedKey === rrulesKey) return;
    onConfigChange({
      ...cfg,
      schedule: {
        ...sched,
        rrules,
        // legacy single rrule НЕ записываем — readers умеют fallback на rrules
        rrule: undefined,
        timezone: sched.timezone ?? timezone,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rrulesKey, userMode]);

  async function loadPreview() {
    if (rrules.length === 0) {
      setPreview([]);
      setPreviewError("Выберите дни и время для расписания");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // PATCH B: dry_run передаём ЧЕРЕЗ BODY. supabase-js v2 не парсит query string из имени функции.
      const { data, error } = await supabase.functions.invoke("autoweb-generate-occurrences", {
        body: {
          dry_run: true,
          preview_rrules: rrules,
          preview_config: {
            schedule: {
              occurrences_window_days: windowDays,
              blackout_dates: blackoutDates,
              timezone: sched.timezone ?? timezone,
            },
            video: cfg.video ?? {},
            replay: replay,
          },
          preview_limit: 10,
        },
      });
      if (error) throw error;
      if ((data as any)?.status !== "ok") {
        setPreviewError((data as any)?.message ?? "Не удалось загрузить превью. Попробуйте ещё раз.");
        setPreview([]);
        return;
      }
      setPreview((data as any).preview ?? []);
    } catch (e: any) {
      // PATCH B: техническую причину — только в console, пользователю — понятный текст.
      console.error("[AutowebModeEditor] preview error:", e);
      setPreviewError("Не удалось загрузить превью. Попробуйте ещё раз.");
      setPreview([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (userMode === "scheduled" && rrules.length > 0) {
      loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMode, rrulesKey, windowDays, JSON.stringify(blackoutDates)]);

  function patchSchedule(p: Partial<NonNullable<AutowebConfig["schedule"]>>) {
    onConfigChange({ ...cfg, schedule: { ...sched, ...p } });
  }
  function patchJit(p: Partial<NonNullable<AutowebConfig["just_in_time"]>>) {
    onConfigChange({ ...cfg, just_in_time: { ...jit, ...p } });
  }
  function patchOd(p: Partial<NonNullable<AutowebConfig["on_demand"]>>) {
    onConfigChange({ ...cfg, on_demand: { ...od, ...p } });
  }
  function patchReplay(p: Partial<NonNullable<AutowebConfig["replay"]>>) {
    onConfigChange({ ...cfg, replay: { ...replay, ...p } });
  }
  function patchVc(p: Partial<NonNullable<AutowebConfig["viewer_controls"]>>) {
    onConfigChange({ ...cfg, viewer_controls: { ...vc, ...p } });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ModeCard
          active={userMode === "one_time"}
          icon={<PlayCircle className="h-4 w-4" />}
          title="Разовый показ"
          desc="Одна дата запуска"
          onClick={() => onUserModeChange("one_time")}
        />
        <ModeCard
          active={userMode === "scheduled"}
          icon={<Calendar className="h-4 w-4" />}
          title="По расписанию"
          desc="Повторяется по дням недели"
          onClick={() => onUserModeChange("scheduled")}
        />
        <ModeCard
          active={userMode === "just_in_time"}
          icon={<Clock className="h-4 w-4" />}
          title="Через N минут"
          desc="Старт через 5 / 10 / 15 / 30 мин"
          onClick={() => onUserModeChange("just_in_time")}
        />
        <ModeCard
          active={userMode === "on_demand"}
          icon={<Zap className="h-4 w-4" />}
          title="Сразу"
          desc="Стартует мгновенно"
          onClick={() => onUserModeChange("on_demand")}
        />
      </div>

      {userMode === "one_time" && (
        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">
            Дата задаётся в основном поле «Дата и время эфира» выше.
            Сохраняется как обычный «recorded_webinar» — без расписания и сессий.
          </CardContent>
        </Card>
      )}

      {userMode === "scheduled" && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label>Дни недели</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS_RU.map((w) => {
                  const checked = weekdays.includes(w.idx);
                  return (
                    <button
                      type="button"
                      key={w.idx}
                      onClick={() => {
                        const next = checked ? weekdays.filter((x) => x !== w.idx) : [...weekdays, w.idx].sort();
                        patchSchedule({ weekdays: next });
                      }}
                      className={`h-9 w-11 rounded-md border-2 text-sm font-medium transition-colors ${
                        checked
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-muted text-muted-foreground hover:border-muted-foreground/40"
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Времена запуска</Label>
              <div className="flex flex-wrap gap-2">
                {times.map((t, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      type="time"
                      value={t}
                      className="h-9 w-28"
                      onChange={(e) => {
                        const next = [...times];
                        next[i] = e.target.value;
                        patchSchedule({ times: next });
                      }}
                    />
                    {times.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => patchSchedule({ times: times.filter((_, j) => j !== i) })}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => patchSchedule({ times: [...times, "20:00"] })}
                >
                  + Добавить время
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Окно генерации (дней вперёд)</Label>
                <Select
                  value={String(windowDays)}
                  onValueChange={(v) => patchSchedule({ occurrences_window_days: Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 дней</SelectItem>
                    <SelectItem value="14">14 дней</SelectItem>
                    <SelectItem value="30">30 дней</SelectItem>
                    <SelectItem value="90">90 дней</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Часовой пояс</Label>
                <Input
                  value={sched.timezone ?? timezone}
                  onChange={(e) => patchSchedule({ timezone: e.target.value })}
                  placeholder="Europe/Minsk"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Исключённые даты (blackout)</Label>
              <div className="flex flex-wrap items-end gap-2">
                {blackoutDates.map((d, i) => (
                  <Badge key={i} variant="secondary" className="gap-1">
                    {format(parseISO(d), "d MMM yyyy", { locale: ru })}
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-destructive"
                      onClick={() => patchSchedule({ blackout_dates: blackoutDates.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </Badge>
                ))}
                <div className="w-44">
                  <DatePicker
                    value=""
                    placeholder="+ добавить дату"
                    onChange={(v) => {
                      if (!v) return;
                      if (!blackoutDates.includes(v)) {
                        patchSchedule({ blackout_dates: [...blackoutDates, v].sort() });
                      }
                    }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Сравнение даты делается в часовом поясе эфира ({sched.timezone ?? timezone}).
              </p>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm">Превью ближайших запусков</Label>
                <Button type="button" variant="ghost" size="sm" onClick={loadPreview} disabled={previewLoading}>
                  {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Обновить"}
                </Button>
              </div>
              {previewError && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{previewError}</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadPreview}
                    disabled={previewLoading}
                  >
                    {previewLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Повторить
                  </Button>
                </div>
              )}
              {!previewError && preview.length === 0 && !previewLoading && (
                <p className="text-xs text-muted-foreground">Нет запусков в выбранном окне.</p>
              )}
              {preview.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {preview.map((o, i) => (
                    <li key={i} className="font-mono text-muted-foreground">
                      {format(parseISO(o.starts_at), "EEE, d MMM yyyy HH:mm", { locale: ru })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {userMode === "just_in_time" && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label>Доступные офсеты для зрителя (минут)</Label>
              <div className="flex flex-wrap gap-2">
                {JIT_OFFSET_OPTIONS.map((m) => {
                  const checked = jitOffsets.includes(m);
                  return (
                    <button
                      type="button"
                      key={m}
                      onClick={() => {
                        const next = checked ? jitOffsets.filter((x) => x !== m) : [...jitOffsets, m].sort((a, b) => a - b);
                        patchJit({ offsets_minutes: next });
                      }}
                      className={`h-9 px-3 rounded-md border-2 text-sm font-medium transition-colors ${
                        checked
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-muted text-muted-foreground hover:border-muted-foreground/40"
                      }`}
                    >
                      {m} мин
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={showCountdown} onCheckedChange={(v) => patchJit({ show_countdown: v })} />
              <Label>Показывать обратный отсчёт зрителю</Label>
            </div>
          </CardContent>
        </Card>
      )}

      {userMode === "on_demand" && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label>Минимальная задержка перед стартом (секунд)</Label>
              <Input
                type="number"
                min={0}
                max={120}
                value={minDelay}
                onChange={(e) => patchOd({ min_delay_seconds: Math.max(0, Number(e.target.value || 0)) })}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                0 — стартует мгновенно. До 120 сек — даёт время на загрузку плеера.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Replay (общий блок для всех режимов кроме one_time) */}
      {userMode !== "one_time" && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Replay-окно (повторный просмотр после окончания)</Label>
              <Switch checked={replay.enabled !== false} onCheckedChange={(v) => patchReplay({ enabled: v })} />
            </div>
            {replay.enabled !== false && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Открыть replay</Label>
                    <Select
                      value={replay.open_strategy ?? "immediate"}
                      onValueChange={(v) => patchReplay({ open_strategy: v as any })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">Сразу после окончания</SelectItem>
                        <SelectItem value="after_delay">Через задержку</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {replay.open_strategy === "after_delay" && (
                    <div className="space-y-2">
                      <Label>Задержка (минут)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={replay.delay_minutes ?? 0}
                        onChange={(e) => patchReplay({ delay_minutes: Math.max(0, Number(e.target.value || 0)) })}
                      />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Длительность окна (часов)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={720}
                      value={replay.window_hours ?? 48}
                      onChange={(e) => patchReplay({ window_hours: Math.max(0, Number(e.target.value || 0)) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>CTA в replay</Label>
                    <Select
                      value={replay.cta_strategy ?? "same_as_live"}
                      onValueChange={(v) => patchReplay({ cta_strategy: v as any })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="same_as_live">Те же, что в эфире</SelectItem>
                        <SelectItem value="replay_only">Отдельные replay-CTA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!replay.show_chat_history}
                    onCheckedChange={(v) => patchReplay({ show_chat_history: v })}
                  />
                  <Label>Показывать историю чата в replay</Label>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Viewer controls (общий блок для всех режимов кроме one_time) */}
      {userMode !== "one_time" && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <Label className="text-sm font-medium">Управление плеером для зрителя</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <ToggleRow
                label="Пауза"
                checked={vc.allow_pause !== false}
                onChange={(v) => patchVc({ allow_pause: v })}
              />
              <ToggleRow
                label="Перемотка"
                checked={!!vc.allow_seek}
                onChange={(v) => patchVc({ allow_seek: v })}
              />
              <ToggleRow
                label="Изменение скорости"
                checked={!!vc.allow_speed_control}
                onChange={(v) => patchVc({ allow_speed_control: v })}
              />
              <ToggleRow
                label="Продолжить с прошлой позиции"
                checked={vc.resume_from_last_position !== false}
                onChange={(v) => patchVc({ resume_from_last_position: v })}
              />
              <ToggleRow
                label="Повторный просмотр до конца эфира"
                checked={!!vc.allow_rewatch_before_end}
                onChange={(v) => patchVc({ allow_rewatch_before_end: v })}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border-2 p-3 text-left transition-colors ${
        active ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"
      }`}
    >
      <div className="flex items-center gap-2 mb-1 text-primary">
        {icon}
        <span className="font-medium text-sm text-foreground">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <Label className="text-sm cursor-pointer" onClick={() => onChange(!checked)}>
        {label}
      </Label>
    </div>
  );
}
