import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MessageSquare, HelpCircle, Reply, ShieldX } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface ScenarioEntry {
  entry_id: string;
  entry_type: string;
  user_id: string;
  display_name: string | null;
  entry_text: string;
  visibility_scope: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
}

const entryTypeLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  comment: { label: "Комментарий", icon: <MessageSquare className="h-3 w-3" />, color: "bg-primary/10 text-primary" },
  question: { label: "Вопрос", icon: <HelpCircle className="h-3 w-3" />, color: "bg-blue-500/10 text-blue-700" },
  reply: { label: "Ответ", icon: <Reply className="h-3 w-3" />, color: "bg-green-500/10 text-green-700" },
  moderation: { label: "Модерация", icon: <ShieldX className="h-3 w-3" />, color: "bg-destructive/10 text-destructive" },
};

export function LiveEventScenario({ liveEventId }: { liveEventId: string }) {
  const [filterType, setFilterType] = useState<string>("all");

  const { data: entries, isLoading } = useQuery({
    queryKey: ["live-event-scenario", liveEventId, filterType],
    queryFn: async () => {
      const params: Record<string, any> = { _live_event_id: liveEventId };
      if (filterType !== "all") params._entry_type = filterType;

      const { data, error } = await supabase.rpc("get_live_event_scenario", params);
      if (error) throw error;
      return (data || []) as ScenarioEntry[];
    },
  });

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <SelectValue placeholder="Фильтр" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все записи</SelectItem>
            <SelectItem value="comment">Комментарии</SelectItem>
            <SelectItem value="question">Вопросы</SelectItem>
            <SelectItem value="reply">Ответы</SelectItem>
            <SelectItem value="moderation">Модерация</SelectItem>
          </SelectContent>
        </Select>
        {entries && (
          <span className="text-xs text-muted-foreground">{entries.length} записей</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !entries?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Нет записей</p>
      ) : (
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {entries.map((entry) => {
            const typeInfo = entryTypeLabels[entry.entry_type] || entryTypeLabels.comment;
            return (
              <div key={entry.entry_id} className="flex gap-2 border-b py-2 text-sm">
                <div className="shrink-0 pt-0.5">
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${typeInfo.color}`}>
                    {typeInfo.icon}
                    <span className="ml-1">{typeInfo.label}</span>
                  </Badge>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium">{entry.display_name || "—"}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(entry.created_at), "HH:mm:ss", { locale: ru })}
                    </span>
                    {entry.visibility_scope === "private" && (
                      <Badge variant="outline" className="text-[8px] px-1 py-0">Приватный</Badge>
                    )}
                  </div>
                  <p className="text-xs text-foreground break-words">{entry.entry_text}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
