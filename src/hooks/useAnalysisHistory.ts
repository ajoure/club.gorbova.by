import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AnalysisSession {
  conversation_id: string;
  title: string;
  file_names: string[];
  created_at: string;
  updated_at: string;
  preview: string;
  scenario_type?: string;
}

export function useAnalysisHistory() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    try {
      // Get assistant messages with scenario metadata for current user
      const { data, error } = await supabase
        .from("ai_chat_messages")
        .select("conversation_id, role, content, created_at, metadata")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      if (!data || data.length === 0) {
        setSessions([]);
        return;
      }

      // Group by conversation_id, but only include conversations that have
      // at least one assistant message with scenario_type
      const convMap = new Map<string, {
        messages: typeof data;
        hasScenario: boolean;
        scenarioType?: string;
        launcherTitle?: string;
        promptTitle?: string;
      }>();

      for (const row of data) {
        const convId = row.conversation_id;
        if (!convMap.has(convId)) {
          convMap.set(convId, { messages: [], hasScenario: false });
        }
        const entry = convMap.get(convId)!;
        entry.messages.push(row);

        const meta = row.metadata as Record<string, any> | null;
        if (row.role === "assistant" && meta?.scenario_type) {
          entry.hasScenario = true;
          entry.scenarioType = meta.scenario_type;
          entry.launcherTitle = meta.launcher_title_snapshot;
          entry.promptTitle = meta.prompt_title_snapshot;
        }
      }

      const result: AnalysisSession[] = [];

      for (const [convId, entry] of convMap) {
        if (!entry.hasScenario) continue;

        const allMsgs = entry.messages;
        const assistantMsgs = allMsgs.filter(m => m.role === "assistant");
        const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
        const firstMsg = allMsgs[0];
        const lastMsg = allMsgs[allMsgs.length - 1];

        // Collect file_names from user messages
        const fileNames: string[] = [];
        for (const m of allMsgs) {
          const meta = m.metadata as Record<string, any> | null;
          if (meta?.file_names && Array.isArray(meta.file_names)) {
            fileNames.push(...meta.file_names);
          }
        }

        // Fallback title: launcher_title_snapshot → prompt_title_snapshot → keyword check → generic
        let title = entry.launcherTitle || entry.promptTitle || "";
        if (!title) {
          title = "Анализ документа";
        }
        // If title exists but is generic, check for balance keywords
        const lowerTitle = title.toLowerCase();
        if (!entry.launcherTitle && !entry.promptTitle) {
          // No snapshots — check if scenario metadata hints at balance
          title = "Анализ документа";
        } else if (lowerTitle.includes("баланс")) {
          // Keep as-is, it already mentions balance
        }

        result.push({
          conversation_id: convId,
          title,
          file_names: [...new Set(fileNames)],
          created_at: firstMsg.created_at,
          updated_at: lastMsg.created_at,
          preview: lastAssistant
            ? lastAssistant.content.slice(0, 150).replace(/\n/g, " ")
            : "",
          scenario_type: entry.scenarioType,
        });
      }

      // Sort by updated_at desc
      result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setSessions(result);
    } catch (err) {
      console.error("Error fetching analysis history:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return { sessions, loading, refetch: fetchSessions };
}
