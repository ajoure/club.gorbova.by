import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Reply, Lock, Globe } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

interface ReplyFormProps {
  liveEventId: string;
  sourceCommentId?: string;
  sourceQuestionId?: string;
  targetUserId?: string;
  targetDisplayName?: string;
  onClose: () => void;
}

export function LiveEventReplyForm({
  liveEventId,
  sourceCommentId,
  sourceQuestionId,
  targetUserId,
  targetDisplayName,
  onClose,
}: ReplyFormProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        live_event_id: liveEventId,
        reply_text: replyText.trim(),
        visibility_scope: visibility,
        created_by: user!.id,
      };
      if (sourceCommentId) payload.source_comment_id = sourceCommentId;
      if (sourceQuestionId) payload.source_question_id = sourceQuestionId;
      if (visibility === "private" && targetUserId) {
        payload.target_user_id = targetUserId;
        payload.target_display_name = targetDisplayName || null;
      }

      const { error } = await supabase.from("live_event_replies").insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ответ отправлен");
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["live-event-replies", liveEventId] });
      onClose();
    },
    onError: (err: any) => toast.error(`Ошибка: ${err.message}`),
  });

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Reply className="h-3 w-3" />
        <span>Ответ {targetDisplayName ? `→ ${targetDisplayName}` : ""}</span>
      </div>
      <Input
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        placeholder="Текст ответа..."
        className="text-sm"
      />
      <div className="flex items-center gap-2">
        <Select value={visibility} onValueChange={(v) => setVisibility(v as "public" | "private")}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public"><Globe className="h-3 w-3 inline mr-1" />Публичный</SelectItem>
            <SelectItem value="private"><Lock className="h-3 w-3 inline mr-1" />Приватный</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => mutation.mutate()} disabled={!replyText.trim() || mutation.isPending}>
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Отправить"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Отмена</Button>
      </div>
    </div>
  );
}

interface LiveEventReply {
  id: string;
  reply_text: string;
  visibility_scope: string;
  target_display_name: string | null;
  created_at: string;
  created_by: string;
}

export function LiveEventRepliesList({ liveEventId, sourceCommentId, sourceQuestionId }: {
  liveEventId: string;
  sourceCommentId?: string;
  sourceQuestionId?: string;
}) {
  const { data: replies, isLoading } = useQuery({
    queryKey: ["live-event-replies", liveEventId, sourceCommentId, sourceQuestionId],
    queryFn: async () => {
      let query = supabase
        .from("live_event_replies")
        .select("id, reply_text, visibility_scope, target_display_name, created_at, created_by")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: true });

      if (sourceCommentId) query = query.eq("source_comment_id", sourceCommentId);
      if (sourceQuestionId) query = query.eq("source_question_id", sourceQuestionId);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as LiveEventReply[];
    },
  });

  if (isLoading) return null;
  if (!replies?.length) return null;

  return (
    <div className="ml-6 mt-1 space-y-1">
      {replies.map((r) => (
        <div key={r.id} className={`text-xs p-2 rounded ${r.visibility_scope === 'private' ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/50'}`}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {r.visibility_scope === 'private' ? <><Lock className="h-2.5 w-2.5 mr-0.5" />Приватный</> : <><Globe className="h-2.5 w-2.5 mr-0.5" />Публичный</>}
            </Badge>
            {r.target_display_name && (
              <span className="text-muted-foreground">→ {r.target_display_name}</span>
            )}
            <span className="text-muted-foreground ml-auto">{format(new Date(r.created_at), "HH:mm", { locale: ru })}</span>
          </div>
          <p className="text-foreground">{r.reply_text}</p>
        </div>
      ))}
    </div>
  );
}
