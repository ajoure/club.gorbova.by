import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Video, MessageSquare, HelpCircle, Reply, ShieldX } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const activityTypeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  webinar_comment: { label: "Комментарий", icon: <MessageSquare className="h-3 w-3" />, color: "bg-primary/10 text-primary border-primary/20" },
  webinar_question: { label: "Вопрос", icon: <HelpCircle className="h-3 w-3" />, color: "bg-blue-500/10 text-blue-700 border-blue-200" },
  webinar_reply: { label: "Ответ", icon: <Reply className="h-3 w-3" />, color: "bg-green-500/10 text-green-700 border-green-200" },
  webinar_moderation: { label: "Модерация", icon: <ShieldX className="h-3 w-3" />, color: "bg-destructive/10 text-destructive border-destructive/20" },
};

interface WebinarActivitySectionProps {
  userId: string;
  isStaff?: boolean;
}

export function WebinarActivitySection({ userId, isStaff = false }: WebinarActivitySectionProps) {
  const { data: activities, isLoading } = useQuery({
    queryKey: ["webinar-activity", userId],
    queryFn: async () => {
      let query = supabase
        .from("crm_activity_log")
        .select("id, activity_type, title_snapshot, text_snapshot, author_snapshot, visibility_scope, created_at, live_event_id")
        .eq("user_id", userId)
        .like("activity_type", "webinar_%")
        .order("created_at", { ascending: false })
        .limit(50);

      // Non-staff cannot see private entries
      if (!isStaff) {
        query = query.neq("visibility_scope", "private");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Video className="w-4 h-4" /> Вебинары
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!activities?.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Video className="w-4 h-4" />
          Вебинары
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{activities.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {activities.map((act) => {
          const config = activityTypeConfig[act.activity_type] || activityTypeConfig.webinar_comment;
          return (
            <div key={act.id} className="flex items-start gap-2 p-2 rounded border-l-2 border-l-primary/30 bg-muted/30">
              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 shrink-0 mt-0.5 ${config.color}`}>
                {config.icon}
                <span className="ml-1">{config.label}</span>
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {act.title_snapshot && (
                    <span className="text-xs font-medium text-foreground">{act.title_snapshot}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(act.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                  </span>
                  {act.visibility_scope === "private" && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0">Приватный</Badge>
                  )}
                </div>
                {act.text_snapshot && (
                  <p className="text-xs text-muted-foreground break-words line-clamp-2">{act.text_snapshot}</p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
