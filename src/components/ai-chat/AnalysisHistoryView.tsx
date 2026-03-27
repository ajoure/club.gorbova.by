import { useAnalysisHistory, type AnalysisSession } from "@/hooks/useAnalysisHistory";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText, MessageSquare, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const MAX_VISIBLE_FILES = 3;

interface AnalysisHistoryViewProps {
  onOpen: (conversationId: string) => void;
  onResume: (conversationId: string) => void;
}

function SessionCard({ session, onOpen, onResume }: {
  session: AnalysisSession;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const createdAt = format(new Date(session.created_at), "d MMM yyyy, HH:mm", { locale: ru });
  const updatedAt = format(new Date(session.updated_at), "d MMM yyyy, HH:mm", { locale: ru });
  const showUpdated = session.created_at !== session.updated_at;

  const visibleFiles = session.file_names.slice(0, MAX_VISIBLE_FILES);
  const extraCount = session.file_names.length - MAX_VISIBLE_FILES;

  return (
    <GlassCard className="p-4 flex flex-col gap-2.5 overflow-hidden min-h-0">
      {/* Title */}
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-4 w-4 text-primary shrink-0" />
        <h4 className="font-medium text-sm truncate min-w-0">{session.title}</h4>
      </div>

      {/* File badges */}
      {visibleFiles.length > 0 && (
        <div className="flex flex-wrap gap-1 min-w-0">
          {visibleFiles.map((fn, i) => (
            <Badge
              key={i}
              variant="outline"
              className="text-[10px] max-w-[180px] truncate inline-flex shrink min-w-0"
            >
              {fn}
            </Badge>
          ))}
          {extraCount > 0 && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              +{extraCount} ещё
            </Badge>
          )}
        </div>
      )}

      {/* Preview */}
      {session.preview && (
        <p className="text-xs text-muted-foreground line-clamp-2 overflow-hidden">{session.preview}</p>
      )}

      {/* Dates */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {createdAt}
        </span>
        {showUpdated && (
          <span className="text-muted-foreground/70">обн. {updatedAt}</span>
        )}
      </div>

      {/* Actions — pinned to bottom */}
      <div className="flex gap-2 mt-auto pt-1">
        <Button
          variant="outline"
          size="sm"
          className="text-xs flex-1"
          onClick={() => onOpen(session.conversation_id)}
        >
          <MessageSquare className="h-3 w-3 mr-1" />
          Открыть
        </Button>
        <Button
          size="sm"
          className="text-xs flex-1"
          onClick={() => onResume(session.conversation_id)}
        >
          Продолжить
        </Button>
      </div>
    </GlassCard>
  );
}

export function AnalysisHistoryView({ onOpen, onResume }: AnalysisHistoryViewProps) {
  const { sessions, loading } = useAnalysisHistory();

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <GlassCard className="p-6">
        <div className="text-center text-muted-foreground">
          <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <h3 className="font-semibold mb-1">Нет анализов</h3>
          <p className="text-sm">Загрузите документ для анализа в чате, и он появится здесь</p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((session) => (
        <SessionCard
          key={session.conversation_id}
          session={session}
          onOpen={onOpen}
          onResume={onResume}
        />
      ))}
    </div>
  );
}
