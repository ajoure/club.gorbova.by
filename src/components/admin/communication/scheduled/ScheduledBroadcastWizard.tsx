/**
 * ScheduledBroadcastWizard
 *
 * Многошаговый диалог создания/редактирования запланированной (или повторяющейся)
 * рассылки. Сохраняет в broadcast_templates с send_mode='scheduled' | 'recurring'
 * и status='scheduled' | 'recurring'. Реальной отправкой занимается
 * process-scheduled-broadcasts (cron).
 *
 * Шаги:
 *  1. Контент (TG message + email subject/html)
 *  2. Каналы (TG / Email / both, email_only_when_no_telegram)
 *  3. Аудитория (RuleListEditor include/exclude + clubs + bots)
 *  4. Расписание (date+time или recurring rule)
 *  5. Dry-run preview через BroadcastDryRunModal → сохранение
 *
 * Reuse:
 *  - RuleListEditor для include/exclude
 *  - resolve_broadcast_audience (RPC)
 *  - таблица broadcast_templates (без новых полей)
 *  - bucket telegram-media для вложений
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  Mail,
  Eye,
  Save,
  Repeat,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { RuleListEditor, type AudienceRule } from "../RuleListEditor";
import { BroadcastDryRunModal, type DryRunPayload } from "./BroadcastDryRunModal";

type SendMode = "scheduled" | "recurring";

interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  byweekday?: number[]; // 0-6 (Mon=0)
  bymonthday?: number; // 1-31
  hour: number;
  minute: number;
  ends_at?: string | null;
}

interface BroadcastFiltersJson {
  channels: ("telegram" | "email")[];
  include: AudienceRule[];
  exclude: AudienceRule[];
  club_ids: string[];
  club_membership: "current" | "ever" | "any";
  bot_ids: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templateId?: string | null;
  onSaved?: () => void;
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const STEPS = [
  { key: "content", title: "Контент" },
  { key: "channels", title: "Каналы" },
  { key: "audience", title: "Аудитория" },
  { key: "schedule", title: "Расписание" },
] as const;

export function ScheduledBroadcastWizard({ open, onOpenChange, templateId, onSaved }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [channels, setChannels] = useState<("telegram" | "email")[]>(["telegram"]);
  const [emailOnlyNoTg, setEmailOnlyNoTg] = useState(false);

  const [include, setInclude] = useState<AudienceRule[]>([]);
  const [exclude, setExclude] = useState<AudienceRule[]>([]);
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [botIds, setBotIds] = useState<string[]>([]);

  const [sendMode, setSendMode] = useState<SendMode>("scheduled");
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [scheduledTime, setScheduledTime] = useState("12:00");
  const [recurrence, setRecurrence] = useState<RecurrenceRule>({
    freq: "weekly",
    interval: 1,
    byweekday: [0],
    hour: 12,
    minute: 0,
    ends_at: null,
  });

  const [dryRunOpen, setDryRunOpen] = useState(false);

  // Load template for edit mode
  const { data: existing } = useQuery({
    queryKey: ["broadcast-template-edit", templateId],
    queryFn: async () => {
      if (!templateId) return null;
      const { data, error } = await supabase
        .from("broadcast_templates")
        .select("*")
        .eq("id", templateId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!templateId && open,
  });

  // Reset / hydrate on open
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.name || "");
      setMessageText(existing.message_text || "");
      setButtonText(existing.button_text || "");
      setButtonUrl(existing.button_url || "");
      setEmailSubject(existing.email_subject || "");
      setEmailBody(existing.email_body_html || "");
      setChannels(((existing.channels as string[]) || ["telegram"]) as ("telegram" | "email")[]);
      setEmailOnlyNoTg(!!existing.email_only_when_no_telegram);
      const af = (existing.audience_filters || {}) as Partial<BroadcastFiltersJson>;
      setInclude(af.include || []);
      setExclude(af.exclude || []);
      setClubIds(af.club_ids || []);
      setBotIds(af.bot_ids || []);
      const sm = (existing.send_mode as SendMode) || "scheduled";
      setSendMode(sm === "recurring" ? "recurring" : "scheduled");
      if (existing.next_run_at) {
        const d = new Date(existing.next_run_at);
        setScheduledDate(d);
        setScheduledTime(format(d, "HH:mm"));
      }
      if (existing.recurrence_rule) {
        setRecurrence(existing.recurrence_rule as unknown as RecurrenceRule);
      }
    } else {
      setName("");
      setMessageText("");
      setButtonText("");
      setButtonUrl("");
      setEmailSubject("");
      setEmailBody("");
      setChannels(["telegram"]);
      setEmailOnlyNoTg(false);
      setInclude([]);
      setExclude([]);
      setClubIds([]);
      setBotIds([]);
      setSendMode("scheduled");
      setScheduledDate(undefined);
      setScheduledTime("12:00");
    }
    setStep(0);
  }, [open, existing]);

  // Lookups
  const { data: products } = useQuery({
    queryKey: ["wiz-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });
  const referencedProductIds = useMemo(() => {
    const s = new Set<string>();
    [...include, ...exclude].forEach((r) => r.product_id && s.add(r.product_id));
    return Array.from(s);
  }, [include, exclude]);
  const { data: tariffs } = useQuery({
    queryKey: ["wiz-tariffs", referencedProductIds],
    queryFn: async () => {
      if (referencedProductIds.length === 0) return [];
      const { data } = await supabase
        .from("tariffs")
        .select("id, name, product_id")
        .in("product_id", referencedProductIds)
        .eq("is_active", true);
      return data || [];
    },
    enabled: referencedProductIds.length > 0,
  });
  const { data: clubs } = useQuery({
    queryKey: ["wiz-clubs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("telegram_clubs")
        .select("id, club_name")
        .eq("is_active", true);
      return data || [];
    },
  });
  const { data: bots } = useQuery({
    queryKey: ["wiz-bots"],
    queryFn: async () => {
      const { data } = await supabase
        .from("telegram_bots")
        .select("id, bot_name, is_primary")
        .eq("status", "active");
      return (data as unknown as Array<{ id: string; bot_name: string; is_primary: boolean }>) || [];
    },
  });

  // Validation per step
  const stepValid = useMemo(() => {
    if (step === 0) {
      const wantTg = channels.includes("telegram");
      const wantEmail = channels.includes("email");
      const tgOk = !wantTg || messageText.trim().length > 0;
      const emailOk = !wantEmail || (emailSubject.trim().length > 0 && emailBody.trim().length > 0);
      return name.trim().length > 0 && tgOk && emailOk;
    }
    if (step === 1) return channels.length > 0;
    if (step === 2) return true;
    if (step === 3) {
      if (sendMode === "scheduled") {
        return !!scheduledDate && !!scheduledTime;
      }
      return recurrence.freq && recurrence.interval > 0;
    }
    return true;
  }, [step, name, messageText, emailSubject, emailBody, channels, sendMode, scheduledDate, scheduledTime, recurrence]);

  // Build the canonical audience_filters payload
  const audienceFilters: BroadcastFiltersJson = useMemo(
    () => ({
      channels,
      include,
      exclude,
      club_ids: clubIds,
      club_membership: "current",
      bot_ids: botIds,
    }),
    [channels, include, exclude, clubIds, botIds],
  );

  // Compute next_run_at locally for scheduled, or via RPC for recurring
  const computeNextRunAt = async (): Promise<string | null> => {
    if (sendMode === "scheduled") {
      if (!scheduledDate) return null;
      const [hh, mm] = scheduledTime.split(":").map((s) => parseInt(s, 10));
      const d = new Date(scheduledDate);
      d.setHours(hh || 0, mm || 0, 0, 0);
      return d.toISOString();
    }
    // recurring: ask RPC
    const { data, error } = await supabase.rpc("compute_next_broadcast_run", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rule: recurrence as any,
      from_ts: new Date().toISOString(),
    });
    if (error) {
      toast.error("Не удалось рассчитать следующий запуск: " + error.message);
      return null;
    }
    return (data as string) || null;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextRunAt = await computeNextRunAt();
      if (!nextRunAt) throw new Error("Не удалось определить следующее время запуска");

      const channel = channels.includes("telegram") ? "telegram" : "email";
      const status = sendMode === "recurring" ? "recurring" : "scheduled";

      const payload = {
        name: name.trim(),
        channel,
        channels,
        message_text: messageText || null,
        button_text: buttonText || null,
        button_url: buttonUrl || null,
        email_subject: emailSubject || null,
        email_body_html: emailBody || null,
        audience_filters: audienceFilters as unknown as Record<string, unknown>,
        send_mode: sendMode,
        recurrence_rule: sendMode === "recurring" ? (recurrence as unknown as Record<string, unknown>) : null,
        next_run_at: nextRunAt,
        status,
        email_only_when_no_telegram: emailOnlyNoTg,
        template_type: "general" as const,
      };

      if (templateId) {
        const { error } = await supabase
          .from("broadcast_templates")
          .update(payload)
          .eq("id", templateId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("broadcast_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(
        sendMode === "recurring"
          ? "Повторяющаяся рассылка сохранена"
          : "Запланированная рассылка создана",
      );
      qc.invalidateQueries({ queryKey: ["scheduled-broadcasts"] });
      qc.invalidateQueries({ queryKey: ["broadcast-templates"] });
      setDryRunOpen(false);
      onOpenChange(false);
      onSaved?.();
    },
    onError: (e) => toast.error("Ошибка сохранения: " + (e as Error).message),
  });

  const dryRunPayload: DryRunPayload | null = useMemo(() => {
    if (!open) return null;
    return {
      audience_filters: audienceFilters as unknown as Record<string, unknown>,
      channels,
      bot_ids: botIds,
      message_text: messageText,
      email_subject: emailSubject,
      email_body_html: emailBody,
      email_only_when_no_telegram: emailOnlyNoTg,
    };
  }, [open, audienceFilters, channels, botIds, messageText, emailSubject, emailBody, emailOnlyNoTg]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {templateId ? "Редактировать запланированную рассылку" : "Новая запланированная рассылка"}
            </DialogTitle>
            <DialogDescription>
              Шаг {step + 1} из {STEPS.length}: {STEPS[step].title}
            </DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          <div className="flex items-center gap-1 mb-2">
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className={cn(
                  "flex-1 h-1.5 rounded-full",
                  i <= step ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>

          {/* === Step 1: Content === */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Label>Название (внутреннее)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Напоминание о вебинаре..."
                />
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Текст для Telegram
                </Label>
                <Textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  rows={5}
                  placeholder="Привет! Напоминаем..."
                />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Input
                    value={buttonText}
                    onChange={(e) => setButtonText(e.target.value)}
                    placeholder="Текст кнопки (опц.)"
                  />
                  <Input
                    value={buttonUrl}
                    onChange={(e) => setButtonUrl(e.target.value)}
                    placeholder="URL кнопки (опц.)"
                  />
                </div>
              </div>

              <Separator />

              <div>
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </Label>
                <Input
                  className="mt-1"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Тема письма"
                />
                <Textarea
                  className="mt-2"
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={4}
                  placeholder="HTML тело письма"
                />
              </div>
            </div>
          )}

          {/* === Step 2: Channels === */}
          {step === 1 && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Выберите, в какие каналы отправлять. Если выбрано оба — рассылка отправится
                  и в Telegram, и на Email одной задачей.
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    <Label>Telegram</Label>
                  </div>
                  <Switch
                    checked={channels.includes("telegram")}
                    onCheckedChange={(v) =>
                      setChannels((cur) =>
                        v ? Array.from(new Set([...cur, "telegram"])) : cur.filter((c) => c !== "telegram"),
                      )
                    }
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    <Label>Email</Label>
                  </div>
                  <Switch
                    checked={channels.includes("email")}
                    onCheckedChange={(v) =>
                      setChannels((cur) =>
                        v ? Array.from(new Set([...cur, "email"])) : cur.filter((c) => c !== "email"),
                      )
                    }
                  />
                </div>

                {channels.includes("email") && channels.includes("telegram") && (
                  <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
                    <div>
                      <Label className="text-sm">Email только тем, у кого нет Telegram</Label>
                      <p className="text-xs text-muted-foreground">
                        Избегает дублей: получившие в TG не получат на email.
                      </p>
                    </div>
                    <Switch
                      checked={emailOnlyNoTg}
                      onCheckedChange={setEmailOnlyNoTg}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* === Step 3: Audience === */}
          {step === 2 && (
            <div className="space-y-4">
              <RuleListEditor
                title="Включить (кому отправлять)"
                emptyHint="Без условий = вся база"
                rules={include}
                products={products || []}
                tariffs={tariffs || []}
                onChange={setInclude}
              />

              <RuleListEditor
                title="Исключить"
                emptyHint="Никого не исключать"
                rules={exclude}
                products={products || []}
                tariffs={tariffs || []}
                onChange={setExclude}
                destructive
              />

              <Separator />

              <div>
                <Label>Telegram-клубы (опционально)</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(clubs || []).map((c) => {
                    const active = clubIds.includes(c.id);
                    return (
                      <Badge
                        key={c.id}
                        variant={active ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() =>
                          setClubIds((cur) =>
                            active ? cur.filter((x) => x !== c.id) : [...cur, c.id],
                          )
                        }
                      >
                        {c.club_name}
                      </Badge>
                    );
                  })}
                </div>
              </div>

              {channels.includes("telegram") && (
                <div>
                  <Label>Боты для отправки (опц., по умолчанию primary)</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(bots || []).map((b) => {
                      const active = botIds.includes(b.id);
                      return (
                        <Badge
                          key={b.id}
                          variant={active ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() =>
                            setBotIds((cur) =>
                              active ? cur.filter((x) => x !== b.id) : [...cur, b.id],
                            )
                          }
                        >
                          {b.bot_name}
                          {b.is_primary ? " · primary" : ""}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === Step 4: Schedule === */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={sendMode === "scheduled" ? "default" : "outline"}
                  className="gap-2 flex-1"
                  onClick={() => setSendMode("scheduled")}
                >
                  <Clock className="h-4 w-4" />
                  Однократно
                </Button>
                <Button
                  type="button"
                  variant={sendMode === "recurring" ? "default" : "outline"}
                  className="gap-2 flex-1"
                  onClick={() => setSendMode("recurring")}
                >
                  <Repeat className="h-4 w-4" />
                  Повторяющаяся
                </Button>
              </div>

              {sendMode === "scheduled" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Дата</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal mt-1",
                            !scheduledDate && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {scheduledDate
                            ? format(scheduledDate, "dd MMM yyyy", { locale: ru })
                            : "Выберите дату"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={scheduledDate}
                          onSelect={setScheduledDate}
                          disabled={(d) => d < new Date(new Date().toDateString())}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <Label>Время</Label>
                    <Input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}

              {sendMode === "recurring" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Частота</Label>
                      <Select
                        value={recurrence.freq}
                        onValueChange={(v) =>
                          setRecurrence((r) => ({ ...r, freq: v as RecurrenceRule["freq"] }))
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Ежедневно</SelectItem>
                          <SelectItem value="weekly">Еженедельно</SelectItem>
                          <SelectItem value="monthly">Ежемесячно</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Каждые N {recurrence.freq === "daily" ? "дней" : recurrence.freq === "weekly" ? "недель" : "месяцев"}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={recurrence.interval}
                        onChange={(e) =>
                          setRecurrence((r) => ({ ...r, interval: parseInt(e.target.value, 10) || 1 }))
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>

                  {recurrence.freq === "weekly" && (
                    <div>
                      <Label>Дни недели</Label>
                      <div className="flex gap-1 mt-1">
                        {WEEKDAY_LABELS.map((lbl, idx) => {
                          const active = recurrence.byweekday?.includes(idx);
                          return (
                            <Button
                              key={idx}
                              type="button"
                              variant={active ? "default" : "outline"}
                              size="sm"
                              className="w-10"
                              onClick={() =>
                                setRecurrence((r) => {
                                  const cur = r.byweekday || [];
                                  return {
                                    ...r,
                                    byweekday: cur.includes(idx)
                                      ? cur.filter((x) => x !== idx)
                                      : [...cur, idx].sort((a, b) => a - b),
                                  };
                                })
                              }
                            >
                              {lbl}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {recurrence.freq === "monthly" && (
                    <div>
                      <Label>День месяца</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={recurrence.bymonthday ?? 1}
                        onChange={(e) =>
                          setRecurrence((r) => ({
                            ...r,
                            bymonthday: Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)),
                          }))
                        }
                        className="mt-1"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Час</Label>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={recurrence.hour}
                        onChange={(e) =>
                          setRecurrence((r) => ({
                            ...r,
                            hour: Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)),
                          }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Минута</Label>
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        value={recurrence.minute}
                        onChange={(e) =>
                          setRecurrence((r) => ({
                            ...r,
                            minute: Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)),
                          }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Закончить (опц.)</Label>
                      <Input
                        type="date"
                        value={recurrence.ends_at ? recurrence.ends_at.slice(0, 10) : ""}
                        onChange={(e) =>
                          setRecurrence((r) => ({
                            ...r,
                            ends_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                          }))
                        }
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              <Alert>
                <AlertDescription className="text-xs">
                  После сохранения рассылка попадёт в очередь. Реальная отправка произойдёт
                  только если диспетчер включён и production approval выдан.
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2 sm:mr-auto">
              <Button
                variant="outline"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Назад
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => setStep((s) => s + 1)} disabled={!stepValid}>
                  Далее
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : null}
            </div>

            {step === STEPS.length - 1 && (
              <Button
                onClick={() => setDryRunOpen(true)}
                disabled={!stepValid}
                className="gap-2"
              >
                <Eye className="h-4 w-4" />
                Dry-run и сохранить
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BroadcastDryRunModal
        open={dryRunOpen}
        onOpenChange={setDryRunOpen}
        payload={dryRunPayload}
        confirmLabel={
          saveMutation.isPending ? (
            "Сохранение..."
          ) : sendMode === "recurring" ? (
            "Подтвердить и поставить на повтор"
          ) : (
            "Подтвердить и запланировать"
          )
        }
        onConfirm={() => saveMutation.mutate()}
        isConfirming={saveMutation.isPending}
      />
    </>
  );
}
