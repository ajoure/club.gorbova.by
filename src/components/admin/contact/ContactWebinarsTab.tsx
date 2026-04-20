/**
 * ContactWebinarsView — подвид «Вебинары» внутри вкладки «Анкеты» в карточке контакта.
 *
 * SoT: читает напрямую из `live_event_comments` и `live_event_questions`
 * (НЕ из `crm_activity_log`, который остаётся вторичным историческим preview).
 * Mapping: `userId = profiles.user_id` контакта (resolvedUserId в parent).
 *
 * Доступ: только staff/admin — гард в parent (рендерим лишь если isStaff===true).
 *
 * Visual contract: тот же канон, что у `ProductGroupSection` в ContactArtifactsTab —
 * `Card + Collapsible` с border, rounded-lg, badge-счётчиками, ChevronDown стрелкой.
 * Внутри раскрытия — единая timeline (comments + questions, ASC по времени).
 */
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Video, MessageCircle, HelpCircle, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface Props {
  userId: string;
}

interface ActivityRow {
  id: string;
  live_event_id: string;
  content: string;
  created_at: string;
  author_display_name: string | null;
  kind: "comment" | "question";
}

interface WebinarBucket {
  live_event_id: string;
  title: string | null;
  slug: string | null;
  scheduled_at: string | null;
  comments_count: number;
  questions_count: number;
  last_activity_at: string;
  items: ActivityRow[];
}

export function ContactWebinarsView({ userId }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["contact-webinar-activity", userId],
    queryFn: async () => {
      const [commentsRes, questionsRes] = await Promise.all([
        supabase
          .from("live_event_comments")
          .select("id, live_event_id, content, created_at, author_display_name")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("live_event_questions")
          .select("id, live_event_id, content, created_at, author_display_name")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (commentsRes.error) throw commentsRes.error;
      if (questionsRes.error) throw questionsRes.error;

      const comments: ActivityRow[] = (commentsRes.data ?? []).map((c) => ({ ...c, kind: "comment" as const }));
      const questions: ActivityRow[] = (questionsRes.data ?? []).map((q) => ({ ...q, kind: "question" as const }));

      const byEvent = new Map<string, WebinarBucket>();
      for (const row of [...comments, ...questions]) {
        const bucket = byEvent.get(row.live_event_id) ?? {
          live_event_id: row.live_event_id,
          title: null, slug: null, scheduled_at: null,
          comments_count: 0, questions_count: 0,
          last_activity_at: row.created_at, items: [],
        };
        if (row.kind === "comment") bucket.comments_count++;
        else bucket.questions_count++;
        if (row.created_at > bucket.last_activity_at) bucket.last_activity_at = row.created_at;
        bucket.items.push(row);
        byEvent.set(row.live_event_id, bucket);
      }

      const eventIds = Array.from(byEvent.keys());
      if (eventIds.length > 0) {
        const { data: events } = await supabase
          .from("live_events")
          .select("id, title, slug, scheduled_at")
          .in("id", eventIds);
        for (const ev of events ?? []) {
          const bucket = byEvent.get(ev.id);
          if (bucket) {
            bucket.title = ev.title;
            bucket.slug = ev.slug;
            bucket.scheduled_at = ev.scheduled_at;
          }
        }
      }

      // Единая timeline по времени ASC
      for (const bucket of byEvent.values()) {
        bucket.items.sort((a, b) => a.created_at.localeCompare(b.created_at));
      }

      return Array.from(byEvent.values()).sort((a, b) =>
        b.last_activity_at.localeCompare(a.last_activity_at),
      );
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Video className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">Нет активности по вебинарам</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {data.map(bucket => {
        const isOpen = !collapsed.has(bucket.live_event_id);
        return (
          <Collapsible key={bucket.live_event_id} open={isOpen} onOpenChange={() => toggle(bucket.live_event_id)}>
            <div className="bg-card border border-border/60 border-l-4 border-l-indigo-300 rounded-lg shadow-sm overflow-hidden">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left group"
                >
                  <div className="w-7 h-7 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
                    <Video className="w-3.5 h-3.5 text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {bucket.title ?? `Эфир ${bucket.live_event_id.slice(0, 8)}…`}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {bucket.scheduled_at && format(new Date(bucket.scheduled_at), "d MMM yyyy, HH:mm", { locale: ru })}
                      {bucket.scheduled_at && " · "}
                      посл. активность {format(new Date(bucket.last_activity_at), "d MMM, HH:mm", { locale: ru })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {bucket.questions_count > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-amber-50 text-amber-600 border-amber-200">
                        <HelpCircle className="w-2.5 h-2.5 mr-0.5" />
                        {bucket.questions_count}
                      </Badge>
                    )}
                    {bucket.comments_count > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-blue-50 text-blue-600 border-blue-200">
                        <MessageCircle className="w-2.5 h-2.5 mr-0.5" />
                        {bucket.comments_count}
                      </Badge>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-0.5 px-2 pb-2">
                  {bucket.items.map(item => (
                    <div
                      key={`${item.kind}-${item.id}`}
                      className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-accent/40 transition-colors"
                    >
                      <div className={`w-7 h-7 rounded-full ${item.kind === 'question' ? 'bg-amber-50' : 'bg-blue-50'} flex items-center justify-center shrink-0 mt-0.5`}>
                        {item.kind === 'question'
                          ? <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
                          : <MessageCircle className="w-3.5 h-3.5 text-blue-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 flex-shrink-0">
                            {item.kind === 'question' ? 'Вопрос' : 'Чат'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {format(new Date(item.created_at), "d MMM, HH:mm:ss", { locale: ru })}
                          </span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap break-words">{item.content}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
