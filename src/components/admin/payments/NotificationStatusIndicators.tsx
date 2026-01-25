import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

export interface NotificationLog {
  subscription_id: string;
  event_type: string;
  status: string;
  reason?: string;
  error_message?: string;
  created_at: string;
}

interface NotificationStatusIndicatorsProps {
  subscriptionId: string;
  channel: 'telegram' | 'email';
  logs: NotificationLog[];
  onOpenContact?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-500',
  skipped: 'bg-amber-400',
  failed: 'bg-red-500',
  pending: 'bg-gray-300',
};

const STATUS_LABELS: Record<string, string> = {
  success: 'Отправлено',
  skipped: 'Пропущено',
  failed: 'Ошибка',
  pending: 'Ещё не было',
};

const REASON_LABELS: Record<string, string> = {
  no_telegram_linked: 'Telegram не привязан',
  no_link_bot_configured: 'Бот не настроен',
  email_missing: 'Email отсутствует',
  send_failed: 'Ошибка отправки',
  log_insert_failed: 'Ошибка записи лога',
};

function normalizeStatus(raw: string | null | undefined): 'success' | 'skipped' | 'failed' | 'pending' {
  if (!raw) return 'pending';
  const lower = raw.toLowerCase();
  if (['success', 'ok', 'sent'].includes(lower)) return 'success';
  if (['skipped'].includes(lower)) return 'skipped';
  if (['failed', 'error'].includes(lower)) return 'failed';
  return 'pending';
}

export function NotificationStatusIndicators({
  subscriptionId,
  channel,
  logs,
  onOpenContact,
}: NotificationStatusIndicatorsProps) {
  const days = [7, 3, 1] as const;
  
  // Build a map of latest logs for this subscription (key: event_type, value: latest log)
  const latestLogsMap = new Map<string, NotificationLog>();
  for (const log of logs) {
    if (log.subscription_id !== subscriptionId) continue;
    const existing = latestLogsMap.get(log.event_type);
    if (!existing || new Date(log.created_at) > new Date(existing.created_at)) {
      latestLogsMap.set(log.event_type, log);
    }
  }
  
  return (
    <div className="flex gap-0.5 justify-center">
      {days.map(day => {
        const eventType = `subscription_reminder_${day}d`;
        // Get the most recent log for this event type from the pre-built map
        const log = latestLogsMap.get(eventType);
        
        const status = log ? normalizeStatus(log.status) : 'pending';
        const reason = log?.reason;
        
        return (
          <Tooltip key={day}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "w-2.5 h-2.5 rounded-full cursor-pointer transition-transform hover:scale-125",
                  STATUS_COLORS[status]
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenContact?.();
                }}
                title={`${day}д`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[220px]">
              <div className="space-y-1">
                <div className="font-medium">
                  {day}д напоминание ({channel === 'telegram' ? 'TG' : 'Email'})
                </div>
                <div className="flex items-center gap-1">
                  <div className={cn("w-2 h-2 rounded-full", STATUS_COLORS[status])} />
                  <span>{STATUS_LABELS[status]}</span>
                </div>
                {reason && (
                  <div className="text-muted-foreground">
                    {REASON_LABELS[reason] || reason}
                  </div>
                )}
                {log?.error_message && (
                  <div className="text-red-400 truncate">
                    {log.error_message.slice(0, 50)}
                  </div>
                )}
                {log?.created_at && (
                  <div className="text-muted-foreground">
                    {format(new Date(log.created_at), 'dd.MM HH:mm', { locale: ru })}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// Legend component for the table header
export function NotificationLegend() {
  return (
    <div className="flex gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span>Отправлено</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-amber-400" />
        <span>Пропущено</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <span>Ошибка</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-gray-300" />
        <span>Ещё не было</span>
      </div>
    </div>
  );
}
