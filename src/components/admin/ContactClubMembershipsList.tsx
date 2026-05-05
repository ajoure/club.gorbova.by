import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle, XCircle, Clock, HelpCircle, Info } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ClubMembershipRow {
  club_id: string;
  club_name: string;
  is_active_club: boolean;
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
const STALE_HOURS = 24 * 7;

type Freshness = "fresh" | "stale" | "never";

function freshnessOf(ts: string | null): Freshness {
  if (!ts) return "never";
  const ageH = (Date.now() - new Date(ts).getTime()) / 36e5;
  if (ageH <= FRESH_HOURS) return "fresh";
  return "stale";
}

function clubSyncBadge(row: ClubMembershipRow) {
  // full = last_members_sync_at fresh; partial = status fresh, members stale; stale = both stale
  const membersFresh = freshnessOf(row.club_last_members_sync_at);
  const statusFresh = freshnessOf(row.club_last_status_check_at);
  if (membersFresh === "fresh") {
    return {
      label: "Полная синхронизация",
      cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    };
  }
  if (statusFresh === "fresh") {
    return {
      label: "Частичная синхронизация",
      cls: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    };
  }
  return {
    label: "Устаревшая синхронизация",
    cls: "bg-red-500/10 text-red-700 border-red-500/30",
  };
}

function memberFreshnessBadge(row: ClubMembershipRow) {
  const f = freshnessOf(row.last_telegram_check_at);
  if (f === "fresh") {
    return { label: "Свежая проверка", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" };
  }
  if (f === "stale") {
    return { label: "Требует проверки", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" };
  }
  return { label: "Не проверялся", cls: "bg-muted text-muted-foreground border-border" };
}

function presenceBadges(row: ClubMembershipRow) {
  const out: { key: string; label: string; cls: string; Icon: any }[] = [];
  if (row.in_chat === true) {
    out.push({ key: "chat", label: "В чате", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30", Icon: CheckCircle });
  } else if (row.in_chat === false) {
    out.push({ key: "chat", label: "Не в чате", cls: "bg-red-500/10 text-red-700 border-red-500/30", Icon: XCircle });
  }
  if (row.in_channel === true) {
    out.push({ key: "channel", label: "В канале", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30", Icon: CheckCircle });
  } else if (row.in_channel === false) {
    out.push({ key: "channel", label: "Не в канале", cls: "bg-muted text-muted-foreground border-border", Icon: XCircle });
  }
  return out;
}

function inviteBadge(row: ClubMembershipRow) {
  if (!row.invite_status && !row.invite_sent_at) return null;
  const s = (row.invite_status || "").toLowerCase();
  let cls = "bg-muted text-muted-foreground border-border";
  let label = row.invite_status || "invite";
  if (s === "sent" || s === "delivered") {
    cls = "bg-blue-500/10 text-blue-700 border-blue-500/30";
    label = "Invite отправлен";
  } else if (s === "failed" || s === "error") {
    cls = "bg-red-500/10 text-red-700 border-red-500/30";
    label = "Invite ошибка";
  } else if (s === "expired") {
    cls = "bg-amber-500/10 text-amber-700 border-amber-500/30";
    label = "Invite истёк";
  }
  return { label, cls };
}

function accessBadge(row: ClubMembershipRow) {
  const s = (row.access_status || "").toLowerCase();
  if (!s) return null;
  if (s === "ok" || s === "active") {
    return { label: "Доступ активен", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" };
  }
  if (["removed", "kicked", "expired", "no_access", "revoked"].includes(s)) {
    return { label: `Доступ: ${s}`, cls: "bg-red-500/10 text-red-700 border-red-500/30" };
  }
  return { label: `Доступ: ${s}`, cls: "bg-muted text-muted-foreground border-border" };
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
      <div className="space-y-2">
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
                <div><b>Свежая проверка</b> — last_telegram_check_at ≤ {FRESH_HOURS}ч.</div>
                <div><b>Требует проверки</b> — старше {FRESH_HOURS}ч.</div>
                <div className="pt-1 border-t border-border/50">
                  <b>Полная синхронизация</b> — last_members_sync_at ≤ {FRESH_HOURS}ч (cron прошёл всех участников клуба).<br />
                  <b>Частичная</b> — last_status_check_at свежий, но full pass устарел (cron работает по batch).<br />
                  <b>Устаревшая</b> — оба старше {FRESH_HOURS}ч.
                </div>
                <div className="pt-1 border-t border-border/50">
                  <b>last_status_check_at</b> — последний batch/status-check клуба.<br />
                  <b>last_members_sync_at</b> — последний полный проход по всем участникам.
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="space-y-2">
          {rows.map((row) => {
            const sync = clubSyncBadge(row);
            const fresh = memberFreshnessBadge(row);
            const presence = presenceBadges(row);
            const invite = inviteBadge(row);
            const access = accessBadge(row);

            return (
              <div
                key={row.club_id}
                className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{row.club_name}</span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className={cn("text-[10px] py-0 h-5", sync.cls)}>
                        {sync.label}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      <div>last_status_check_at: {fmt(row.club_last_status_check_at)}</div>
                      <div>last_members_sync_at: {fmt(row.club_last_members_sync_at)}</div>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {presence.map((p) => (
                    <Badge key={p.key} variant="outline" className={cn("text-[10px] py-0 h-5", p.cls)}>
                      <p.Icon className="w-3 h-3 mr-1" />
                      {p.label}
                    </Badge>
                  ))}
                  {access && (
                    <Badge variant="outline" className={cn("text-[10px] py-0 h-5", access.cls)}>
                      {access.label}
                    </Badge>
                  )}
                  {invite && (
                    <Badge variant="outline" className={cn("text-[10px] py-0 h-5", invite.cls)}>
                      {invite.label}
                    </Badge>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className={cn("text-[10px] py-0 h-5", fresh.cls)}>
                        {fresh.label}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      <div>last_telegram_check_at: {fmt(row.last_telegram_check_at)} ({ago(row.last_telegram_check_at)})</div>
                      <div>last_verified_at: {fmt(row.last_verified_at)}</div>
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
