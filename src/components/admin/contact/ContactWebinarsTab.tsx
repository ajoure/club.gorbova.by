/**
 * ContactWebinarsTab — вкладка «Вебинары» в карточке контакта.
 *
 * SoT: читает напрямую из `live_event_comments` и `live_event_questions`
 * (НЕ из `crm_activity_log`, который остаётся вторичным историческим preview).
 * Mapping: `userId = profiles.user_id` контакта (resolvedUserId в parent).
 *
 * Доступ: только staff/admin — гард в parent (рендерим лишь если isStaff===true).
 * Не утекает email/phone/internal_id — только publicly-сериализуемые поля
 * сообщений (content, author_display_name, created_at).
 *
 * Структура:
 *  - список вебинаров с активностью (Accordion);
 *  - в каждом: title, scheduled_at, comments_count, questions_count, last_activity;
 *  - при раскрытии — единая timeline комментариев + вопросов по времени
 *    с типом (question/comment) и timestamp.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Video, MessageCircle, HelpCircle, Calendar, Clock } from "lucide-react";
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

export function ContactWebinarsTab({ userId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["contact-webinar-activity", userId],
    queryFn: async () => {
      // Параллельно: комментарии + вопросы пользователя
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

      const comments: ActivityRow[] = (commentsRes.data ?? []).map((c) => ({
        ...c,
        kind: "comment" as const,
      }));
      const questions: ActivityRow[] = (questionsRes.data ?? []).map((q) => ({
        ...q,
        kind: "question" as const,
      }));

      // Группируем по live_event_id
      const byEvent = new Map<string, WebinarBucket>();
      for (const row of [...comments, ...questions]) {
        const bucket = byEvent.get(row.live_event_id) ?? {
          live_event_id: row.live_event_id,
          title: null,
          slug: null,
          scheduled_at: null,
          comments_count: 0,
          questions_count: 0,
          last_activity_at: row.created_at,
          items: [],
        };
        if (row.kind === "comment") bucket.comments_count++;
        else bucket.questions_count++;
        if (row.created_at > bucket.last_activity_at) bucket.last_activity_at = row.created_at;
        bucket.items.push(row);
        byEvent.set(row.live_event_id, bucket);
      }

      // Подтягиваем title/slug/scheduled_at для всех вебинаров
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

      // Сортируем items внутри каждого бакета по времени (timeline ASC)
      for (const bucket of byEvent.values()) {
        bucket.items.sort((a, b) => a.created_at.localeCompare(b.created_at));
      }

      // Сортируем вебинары по последней активности (DESC)
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
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          <Video className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Нет активности по вебинарам
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Video className="w-4 h-4" />
          Активность по вебинарам
          <Badge variant="secondary" className="ml-1 text-xs">{data.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {data.map((bucket) => (
            <AccordionItem key={bucket.live_event_id} value={bucket.live_event_id}>
              <AccordionTrigger className="hover:no-underline py-3">
                <div className="flex flex-col items-start gap-1 text-left flex-1 min-w-0 pr-3">
                  <div className="font-medium text-sm truncate w-full">
                    {bucket.title ?? `Эфир ${bucket.live_event_id.slice(0, 8)}…`}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {bucket.scheduled_at && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(bucket.scheduled_at), "d MMM yyyy, HH:mm", { locale: ru })}
                      </span>
                    )}
                    {bucket.comments_count > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" />
                        {bucket.comments_count}
                      </span>
                    )}
                    {bucket.questions_count > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <HelpCircle className="h-3 w-3" />
                        {bucket.questions_count}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(bucket.last_activity_at), "d MMM, HH:mm", { locale: ru })}
                    </span>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pl-2 border-l-2 border-muted">
                  {bucket.items.map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="pl-3 py-1.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                        {item.kind === "question" ? (
                          <Badge variant="outline" className="gap-1 h-5 text-[10px]">
                            <HelpCircle className="h-3 w-3" /> Вопрос
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 h-5 text-[10px]">
                            <MessageCircle className="h-3 w-3" /> Чат
                          </Badge>
                        )}
                        <span>{format(new Date(item.created_at), "d MMM, HH:mm:ss", { locale: ru })}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words">{item.content}</div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
