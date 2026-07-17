// B3. Единый UI-компонент настроек уведомлений об автоматических списаниях.
// Используется:
//  - для обычной подписки (offer_type='pay_now', meta.recurring.is_recurring, payment_method !== 'internal_installment')
//    — сохраняет через существующий recurring-контракт (legacy fields).
//  - для внутренней рассрочки (offer_type='pay_now', payment_method='internal_installment', max_months>=2)
//    — сохраняет в canonical meta.installment.charge_notifications.
//
// SoT для схемы политики: src/lib/chargeNotificationPolicy.ts (зеркало _shared/charge-notification-policy.ts).

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DEFAULT_CHARGE_NOTIFICATION_POLICY,
  readChargeNotificationPolicy,
  REMINDER_DAY_OPTIONS,
  TIMEZONE_OPTIONS,
  type ChargeNotificationPolicy,
} from "@/lib/chargeNotificationPolicy";

type Mode = "subscription" | "installment";

interface Props {
  mode: Mode;
  /** Полный offerForm.meta. Компонент не мутирует его напрямую — возвращает next через onChange. */
  meta: Record<string, any> | null | undefined;
  onChange: (nextMeta: Record<string, any>) => void;
}

function subsectionOf(meta: Record<string, any> | null | undefined, mode: Mode): unknown {
  const m = (meta ?? {}) as Record<string, any>;
  if (mode === "subscription") return m; // resolver: recurring.charge_notifications → legacy recurring.*
  return m.installment ?? null;           // resolver: installment.charge_notifications
}

export function ChargeNotificationSettings({ mode, meta, onChange }: Props) {
  const current: ChargeNotificationPolicy = readChargeNotificationPolicy(subsectionOf(meta, mode));

  const emit = (patch: Partial<ChargeNotificationPolicy>) => {
    const next: ChargeNotificationPolicy = { ...current, ...patch };
    const sortedDays = [...next.reminder_days].sort((a, b) => b - a);
    const base = (meta ?? {}) as Record<string, any>;
    const canonical = {
      enabled: next.enabled,
      reminder_days: sortedDays,
      timezone: next.timezone,
      notify_on_failure: next.notify_on_failure,
      notify_on_retry_exhausted: next.notify_on_retry_exhausted,
    };
    if (mode === "subscription") {
      // Canonical SoT: meta.recurring.charge_notifications.
      // Legacy зеркала сохраняем для старого runtime подписок.
      const prevRec = (base.recurring ?? {}) as Record<string, any>;
      onChange({
        ...base,
        recurring: {
          ...prevRec,
          charge_notifications: canonical,
          // Legacy mirrors (derived).
          pre_due_reminders_days: sortedDays,
          notify_before_each_charge: next.enabled,
          notify_grace_events: next.notify_on_failure || next.notify_on_retry_exhausted,
          timezone: next.timezone,
        },
      });
      return;
    }
    // installment: canonical snapshot.
    const prevInst = (base.installment ?? {}) as Record<string, any>;
    onChange({
      ...base,
      installment: {
        ...prevInst,
        charge_notifications: canonical,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-normal">Напоминать о предстоящем списании</Label>
          <p className="text-xs text-muted-foreground">
            Отправляем уведомление за N дней до автоматического платежа.
          </p>
        </div>
        <Switch checked={current.enabled} onCheckedChange={(v) => emit({ enabled: v })} />
      </div>

      <div className="space-y-2">
        <Label className="text-sm">За сколько дней напоминать</Label>
        <div className="flex gap-3 flex-wrap">
          {REMINDER_DAY_OPTIONS.map((day) => {
            const checked = current.reminder_days.includes(day);
            return (
              <label key={day} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!current.enabled}
                  onChange={(e) => {
                    const nextDays = e.target.checked
                      ? Array.from(new Set([...current.reminder_days, day]))
                      : current.reminder_days.filter((d) => d !== day);
                    emit({
                      reminder_days: nextDays.length
                        ? nextDays
                        : DEFAULT_CHARGE_NOTIFICATION_POLICY.reminder_days,
                    });
                  }}
                  className="rounded border-border"
                />
                <span className="text-sm">
                  {day} {day === 1 ? "день" : day > 4 ? "дней" : "дня"}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Часовой пояс уведомлений</Label>
        <Select value={current.timezone} onValueChange={(v) => emit({ timezone: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-sm font-normal">Уведомлять о неудачной попытке списания</Label>
        <Switch
          checked={current.notify_on_failure}
          onCheckedChange={(v) => emit({ notify_on_failure: v })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-sm font-normal">
          Уведомлять, если все попытки исчерпаны
        </Label>
        <Switch
          checked={current.notify_on_retry_exhausted}
          onCheckedChange={(v) => emit({ notify_on_retry_exhausted: v })}
        />
      </div>

      {mode === "installment" && (
        <p className="text-xs text-muted-foreground border-t pt-3">
          Повторные попытки списания выполняет bePaid. Их количество задаётся выше в поле
          «Попытки списания при неудаче» — отдельно настраивать частоту и время попыток не нужно.
        </p>
      )}
    </div>
  );
}
