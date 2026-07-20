/** Render-only playback of applied autoweb scenario entries. */
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { HelpCircle, MessageCircle, Sparkles, UserRound } from "lucide-react";

type ScenarioEntry = {
  id: string;
  entry_type: "chat" | "question" | "host_message" | "reaction" | "cta";
  offset_seconds: number;
  actor_display_name: string | null;
  content_text: string;
  metadata: { url?: string };
};

interface Props {
  sessionId: string;
  liveEventId: string;
  playbackSeconds: number;
  enabled: boolean;
}

export function AutowebTimelineOverlay({ sessionId, liveEventId, playbackSeconds, enabled }: Props) {
  const { data: entries = [] } = useQuery({
    queryKey: ["autoweb-scenario-runtime", sessionId, liveEventId],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("autoweb_scenario_runtime_list_v2", {
        _session_id: sessionId,
        _live_event_id: liveEventId,
      });
      if (error) throw error;
      return (data ?? []) as ScenarioEntry[];
    },
  });

  if (!enabled) return null;
  const visible = entries.filter((entry) => entry.offset_seconds <= Math.max(0, playbackSeconds));
  if (visible.length === 0) return null;

  return (
    <div className="mt-2 space-y-2" data-autoweb-scripted-overlay data-session-id={sessionId}>
      {visible.map((entry) => {
        const Icon = entry.entry_type === "question" ? HelpCircle : entry.entry_type === "host_message" ? UserRound : MessageCircle;
        return (
          <Card key={entry.id} className="p-3 flex gap-2 text-sm" data-scenario-type={entry.entry_type}>
            <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                {entry.actor_display_name || (entry.entry_type === "host_message" ? "Ведущий" : "Сообщение из сценария")}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.content_text}</p>
              {entry.entry_type === "cta" && entry.metadata?.url && (
                <a className="inline-block mt-2 text-xs font-medium text-primary underline" href={entry.metadata.url} target="_blank" rel="noreferrer">Открыть</a>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
