import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  X,
  Clock,
  HelpCircle,
  Info,
  MessageSquare,
  Megaphone,
  Send,
  ShieldCheck,
  ShieldAlert,
  CircleDot,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ClubMembershipRow {
  club_id: string;
  club_name: string;
  is_active_club: boolean;
  club_has_chat?: boolean | null;
  club_has_channel?: boolean | null;
  in_chat: boolean | null;
  in_channel: boolean | null;
  access_status: string | null;
  link_status: string | null;
  invite_status: string | null;
  invite_sent_at: string | null;
  last_telegram_check_at: string | null;
  last_verified_at: string | null;
  member_updated_at: string | null;
  club_last_status_check_at: string | null;
  club_last_members_sync_at: string | null;
}

interface Props {
  profileId: string | null | undefined;
  enabled: boolean;
}

const FRESH_HOURS = 24;

type Freshness = "fresh" | "stale" | "never";

function freshnessOf(ts: string | null): Freshness {
  if (!ts) return "never";
  const ageH = (Date.now() - new Date(ts).getTime()) / 36e5;
  if (ageH <= FRESH_HOURS) return "fresh";
  return "stale";
}

type SyncState = "full" | "partial" | "stale";

function syncStateOf(row: ClubMembershipRow): SyncState {
  const m = freshnessOf(row.club_last_members_sync_at);
  const s = freshnessOf(row.club_last_status_check_at);
  if (m === "fresh") return "full";
  if (s === "fresh") return "partial";
  return "stale";
}

const SYNC_META: Record<SyncState, { label: string; dot: string; text: string; Icon: any }> = {
  full: {
    label: "Синхронизировано",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    Icon: CircleCheck,
  },
  partial: {
    label: "Частичная синхронизация",
    dot: "bg-amber-500",
    text: "text-amber-700",
    Icon: CircleDot,
  },
  stale: {
    label: "Синхронизация устарела",
    dot: "bg-red-500",
    text: "text-red-700",
    Icon: CircleAlert,
  },
};

const ACCESS_LABELS: Record<string, { label: string; tone: "ok" | "bad" | "muted" }> = {
  ok: { label: "Доступ активен", tone: "ok" },
  active: { label: "Доступ активен", tone: "ok" },
  no_access: { label: "Нет доступа", tone: "bad" },
  removed: { label: "Доступ удалён", tone: "bad" },
  kicked: { label: "Исключён", tone: "bad" },
  expired: { label: "Доступ истёк", tone: "bad" },
  revoked: { label: "Доступ отозван", tone: "bad" },
  pending: { label: "Доступ ожидает", tone: "muted" },
};

function accessLabel(s: string | null) {
  if (!s) return null;
  const key = s.toLowerCase();
  return ACCESS_LABELS[key] ?? { label: s, tone: "muted" as const };
}

function inviteLabel(row: ClubMembershipRow) {
  if (!row.invite_status) return null;
  const s = row.invite_status.toLowerCase();
  if (s === "sent" || s === "delivered") return { label: "Приглашение отправлено", tone: "info" as const };
  if (s === "failed" || s === "error") return { label: "Ошибка приглашения", tone: "bad" as const };
  if (s === "expired") return { label: "Приглашение истекло", tone: "warn" as const };
  return { label: row.invite_status, tone: "muted" as const };
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  try {
    return format(new Date(ts), "dd.MM.yyyy HH:mm", { locale: ru });
  } catch {
    return ts;
  }
}

function ago(ts: string | null) {
  if (!ts) return "никогда";
  try {
    return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ru });
  } catch {
    return "—";
  }
}

// Короткое время: сегодня → "HH:mm", иначе → "dd.MM HH:mm"
function fmtShort(ts: string | null) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return format(d, sameDay ? "HH:mm" : "dd.MM HH:mm", { locale: ru });
  } catch {
    return "—";
  }
}

function partialReason(row: ClubMembershipRow): string {
  const parts: string[] = [];
  const m = row.club_last_members_sync_at;
  const s = row.club_last_status_check_at;
  if (!m) parts.push("полный обход участников ещё не выполнялся");
  else parts.push(`полный обход последний раз: ${fmt(m)} (${ago(m)})`);
  if (s) parts.push(`последняя batch-проверка: ${fmt(s)} (${ago(s)})`);
  parts.push("Cron обходит участников батчами по 200 — следующие тики догонят остаток.");
  return parts.join(" · ");
}

function PresenceIcon({
  present,
  Icon,
  label,
}: {
  present: boolean | null;
  Icon: any;
  label: string;
}) {
  const ok = present === true;
  const bad = present === false;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center w-5 h-5 rounded-full border text-[10px]",
            ok && "bg-emerald-500/10 border-emerald-500/30 text-emerald-700",
            bad && "bg-red-500/10 border-red-500/30 text-red-700",
            !ok && !bad && "bg-muted border-border text-muted-foreground",
          )}
        >
          <Icon className="w-3 h-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}: {ok ? "да" : bad ? "нет" : "неизвестно"}
      </TooltipContent>
    </Tooltip>
  );
}

export function ContactClubMembershipsList({ profileId, enabled }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["contact-club-memberships-all", profileId],
    queryFn: async () => {
      if (!profileId) return [] as ClubMembershipRow[];
      const { data, error } = await supabase.rpc("admin_get_club_memberships_all", {
        p_profile_id: profileId,
      });
      if (error) {
        console.debug("admin_get_club_memberships_all error", error.message);
        return [] as ClubMembershipRow[];
      }
      return (data ?? []) as ClubMembershipRow[];
    },
    enabled: !!profileId && enabled,
    staleTime: 0,
    refetchOnMount: true,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="w-3 h-3 animate-spin" /> Загрузка членства в клубах…
      </div>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <HelpCircle className="w-3 h-3" /> Нет данных о членстве в Telegram-клубах
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          Telegram-клубы ({rows.length})
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground">
                <Info className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs text-xs">
              <div className="space-y-1">
                <div>
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />
                  <b>Синхронизировано</b> — полный обход участников клуба прошёл за последние 24ч.
                </div>
                <div>
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5 align-middle" />
                  <b>Частичная</b> — batch-проверка свежая, но полный обход ещё не закончен.
                </div>
                <div>
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle" />
                  <b>Устарела</b> — обе проверки старше 24ч.
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="space-y-1">
          {rows.map((row) => {
            const sync = syncStateOf(row);
            const meta = SYNC_META[sync];
            const access = accessLabel(row.access_status);
            const invite = inviteLabel(row);
            const memberFresh = freshnessOf(row.last_telegram_check_at);

            return (
              <div
                key={row.club_id}
                className="rounded-md border border-border bg-card/40 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Sync status dot with tooltip */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 shrink-0 cursor-help",
                          meta.text,
                        )}
                      >
                        <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      <div className="font-medium mb-1">{meta.label}</div>
                      {sync === "partial" && (
                        <div className="text-muted-foreground">{partialReason(row)}</div>
                      )}
                      {sync === "full" && (
                        <div className="text-muted-foreground">
                          Полный обход: {fmt(row.club_last_members_sync_at)} ({ago(row.club_last_members_sync_at)})
                        </div>
                      )}
                      {sync === "stale" && (
                        <div className="text-muted-foreground">
                          Последний обход: {fmt(row.club_last_members_sync_at)} ({ago(row.club_last_members_sync_at)}).
                          Cron не доходит до клуба — нужна диагностика.
                        </div>
                      )}
                    </TooltipContent>
                  </Tooltip>

                  {/* Club name */}
                  <span className="text-sm font-medium truncate flex-1 min-w-0">
                    {row.club_name}
                  </span>

                  {/* Presence icons (chat/channel) */}
                  <div className="flex items-center gap-1 shrink-0">
                    <PresenceIcon present={row.in_chat} Icon={MessageSquare} label="В чате" />
                    <PresenceIcon present={row.in_channel} Icon={Megaphone} label="В канале" />
                  </div>
                </div>

                {/* Secondary line: access + invite + freshness — compact text */}
                <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] text-muted-foreground mt-0.5 pl-4">
                  {access && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        access.tone === "ok" && "text-emerald-700",
                        access.tone === "bad" && "text-red-700",
                      )}
                    >
                      {access.tone === "ok" ? (
                        <ShieldCheck className="w-3 h-3" />
                      ) : access.tone === "bad" ? (
                        <ShieldAlert className="w-3 h-3" />
                      ) : (
                        <ShieldCheck className="w-3 h-3" />
                      )}
                      {access.label}
                    </span>
                  )}
                  {invite && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        invite.tone === "info" && "text-blue-700",
                        invite.tone === "bad" && "text-red-700",
                        invite.tone === "warn" && "text-amber-700",
                      )}
                    >
                      <Send className="w-3 h-3" />
                      {invite.label}
                    </span>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        <Clock className="w-3 h-3" />
                        {memberFresh === "fresh"
                          ? "проверен недавно"
                          : memberFresh === "stale"
                            ? "проверка устарела"
                            : "не проверялся"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div>Последняя проверка: {fmt(row.last_telegram_check_at)}</div>
                      <div className="text-muted-foreground">{ago(row.last_telegram_check_at)}</div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
