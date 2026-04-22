import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Loader2, Radio, Video, CalendarClock, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { parseRoomState, getRoomStateBadgeVM } from "@/lib/liveRoomLifecycle";

interface LiveEventItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  event_type: string;
  platform_status: string;
  scheduled_at: string | null;
  event_timezone: string;
  replay_enabled: boolean;
  room_state?: "closed" | "opened" | "live" | "completed" | null;
}

export default function LiveEvents() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const { data: events, isLoading } = useQuery({
    queryKey: ["user-live-events"],
    queryFn: async () => {
      if (!session?.access_token) return [];
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/live-events-list`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Ошибка загрузки");
      return (json.events || []) as LiveEventItem[];
    },
    enabled: !!session,
  });

  const getStatusBadge = (event: LiveEventItem) => {
    // Sprint 2 PATCH 2.7: приоритет — room_state (новый SoT).
    const rs = parseRoomState(event.room_state);
    if (rs === "live") {
      return <Badge variant="destructive" className="animate-pulse"><Radio className="h-3 w-3 mr-1" />Идёт сейчас</Badge>;
    }
    if (rs === "opened") {
      const vm = getRoomStateBadgeVM(rs);
      return <Badge variant={vm.variant}>{vm.shortLabel}</Badge>;
    }
    if (rs === "completed" && (event.platform_status === "replay_available" || event.replay_enabled)) {
      return <Badge variant="outline"><PlayCircle className="h-3 w-3 mr-1" />Запись</Badge>;
    }
    if (event.platform_status === "scheduled" && event.scheduled_at) {
      return <Badge variant="secondary"><CalendarClock className="h-3 w-3 mr-1" />Запланирован</Badge>;
    }
    if (event.platform_status === "replay_available" || (event.platform_status === "ended" && event.replay_enabled)) {
      return <Badge variant="outline"><PlayCircle className="h-3 w-3 mr-1" />Запись</Badge>;
    }
    return <Badge variant="outline">{event.platform_status}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Radio className="h-6 w-6" />
            Эфиры
          </h1>
          <p className="text-muted-foreground mt-1">Живые эфиры и записи</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !events?.length ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Video className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>Пока нет доступных эфиров</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {events.map((event) => (
              <Card
                key={event.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => {
                  // M2 entry-path hint: помечаем заход из списка эфиров для последующего soft-join.
                  // LiveEvent.tsx прочитает sessionStorage[`live_entry_${slug}`] при первом heartbeat.
                  try {
                    sessionStorage.setItem(`live_entry_${event.slug}`, "menu");
                  } catch {/* sessionStorage may be unavailable in some embeds */}
                  navigate(`/live/${event.slug}`);
                }}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground line-clamp-2">{event.title}</h3>
                    {getStatusBadge(event)}
                  </div>
                  {event.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{event.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {event.event_type === "live_stream" ? "Живой эфир" : "Видео"}
                    </Badge>
                    {event.scheduled_at && (
                      <span>{format(new Date(event.scheduled_at), "dd MMM yyyy, HH:mm", { locale: ru })}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
