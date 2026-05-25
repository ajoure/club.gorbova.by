import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { UnsupportedFileInfo } from "@/types/files";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: AiChatMetadata;
}

export interface AiChatMetadata {
  prompt_id?: string;
  prompt_title_snapshot?: string;
  launcher_title_snapshot?: string;
  scenario_type?: string;
  file_names?: string[];
  parse_errors?: string[];
  processing_time_ms?: number;
  extract_quality?: "ok" | "low" | "empty";
  extracted_text_length?: number;
  original_text_length?: number;
  cleaned_text_length?: number;
  parse_failed?: boolean;
  blocked?: boolean;
  analysis_blocked_reason?: string;
  images_present?: boolean;
}

export interface ChatScenario {
  id: string;
  launcher_title: string;
  launcher_description: string | null;
  type: string;
  input_hint: string | null;
  icon: string | null;
  launcher_order: number;
  code?: string | null;
}

export interface ScenarioContext {
  prompt_id?: string;
  scenario_type?: string;
  launcher_title_snapshot?: string;
}

const INITIAL_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Привет! 👋 Я gorbova AI — твой персональный помощник в бизнесе и налогах. Чем могу помочь сегодня?",
  timestamp: new Date(),
};

function getStorageKey(userId: string) {
  return `gorbova_ai_last_conversation_${userId}`;
}

export function useAiChat() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ChatScenario[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(false);
  const [activeScenarioContext, setActiveScenarioContext] = useState<ScenarioContext | null>(null);
  const initRef = useRef(false);

  // On mount: restore last conversation from localStorage
  useEffect(() => {
    if (!user?.id || initRef.current) return;
    initRef.current = true;

    const key = getStorageKey(user.id);
    const savedId = localStorage.getItem(key);
    if (!savedId) return;

    loadConversation(savedId).then((result) => {
      if (!result.loaded) {
        // Invalid/empty conversation — clean up
        localStorage.removeItem(key);
      }
    });
  }, [user?.id]);

  const loadConversation = useCallback(async (convId: string): Promise<{ loaded: boolean; scenarioContext: ScenarioContext | null }> => {
    if (!user?.id) return { loaded: false, scenarioContext: null };

    try {
      const { data, error } = await supabase
        .from("ai_chat_messages")
        .select("id, role, content, created_at, metadata")
        .eq("conversation_id", convId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (error || !data || data.length === 0) return { loaded: false, scenarioContext: null };

      const loaded: ChatMessage[] = data.map((row: any) => ({
        id: row.id,
        role: row.role as "user" | "assistant",
        content: row.content,
        timestamp: new Date(row.created_at),
        metadata: row.metadata as AiChatMetadata | undefined,
      }));

      setMessages(loaded);
      setConversationId(convId);

      // Extract scenario context from last assistant message
      let freshContext: ScenarioContext | null = null;
      const lastAssistant = [...loaded].reverse().find(m => m.role === "assistant" && m.metadata?.scenario_type);
      if (lastAssistant?.metadata) {
        freshContext = {
          prompt_id: lastAssistant.metadata.prompt_id,
          scenario_type: lastAssistant.metadata.scenario_type,
          launcher_title_snapshot: lastAssistant.metadata.launcher_title_snapshot,
        };
        setActiveScenarioContext(freshContext);
      }

      return { loaded: true, scenarioContext: freshContext };
    } catch {
      return { loaded: false, scenarioContext: null };
    }
  }, [user?.id]);

  const resumeConversation = useCallback(async (convId: string): Promise<ScenarioContext | null> => {
    const result = await loadConversation(convId);
    if (!result.loaded) return null;

    // Save to localStorage — this is the key difference from loadConversation
    if (user?.id) {
      localStorage.setItem(getStorageKey(user.id), convId);
    }

    return result.scenarioContext;
  }, [loadConversation, user?.id]);

  const fetchScenarios = useCallback(async () => {
    setScenariosLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_chat_scenarios");
      if (error) throw error;
      setScenarios((data as unknown as ChatScenario[]) || []);
    } catch (err) {
      console.error("Error fetching scenarios:", err);
    } finally {
      setScenariosLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (
    content: string,
    options?: {
      promptId?: string;
      fileContents?: string;
      fileNames?: string[];
      images?: Array<{ base64: string; filename: string; mimeType?: string }>;
      unsupportedFiles?: UnsupportedFileInfo[];
    }
  ) => {
    if (!content.trim() && !options?.fileContents) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
      metadata: options?.fileNames ? { file_names: options.fileNames } : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const allMessages = [...messages.filter(m => m.id !== "welcome"), userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error } = await supabase.functions.invoke("gorbova-ai-chat", {
        body: {
          mode: options?.promptId ? "prompt" : "chat",
          messages: allMessages,
          prompt_id: options?.promptId,
          fileContents: options?.fileContents,
          fileNames: options?.fileNames,
          images: options?.images,
          conversation_id: conversationId,
          unsupported_files: options?.unsupportedFiles,
        },
      });

      if (error) {
        const errMsg = await normalizeEdgeFunctionErrorAsync(error, data);
        
        if (errMsg.includes("Слишком много")) {
          toast({ title: "Слишком много запросов", description: "Попробуйте позже", variant: "destructive" });
        } else if (errMsg.includes("Лимит AI") || errMsg.includes("Исчерпан")) {
          toast({ title: "Лимит AI исчерпан", description: "Обратитесь к администратору", variant: "destructive" });
        } else {
          toast({ title: "Ошибка AI", description: errMsg, variant: "destructive" });
        }
        throw new Error(errMsg);
      }

      if (data?.conversation_id) {
        setConversationId(data.conversation_id);
        // Persist to localStorage
        if (user?.id) {
          localStorage.setItem(getStorageKey(user.id), data.conversation_id);
        }
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.content || "Нет ответа",
        timestamp: new Date(),
        metadata: data?.metadata,
      };

      // Update scenario context if present
      if (data?.metadata?.scenario_type) {
        setActiveScenarioContext({
          prompt_id: data.metadata.prompt_id,
          scenario_type: data.metadata.scenario_type,
          launcher_title_snapshot: data.metadata.launcher_title_snapshot,
        });
      }

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error("Chat error:", err);
      const message = err instanceof Error ? err.message : "Произошла ошибка при обработке запроса. Попробуйте ещё раз.";
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: message,
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, conversationId, toast, user?.id]);

  const clearChat = useCallback(() => {
    setMessages([INITIAL_MESSAGE]);
    setConversationId(null);
    setActiveScenarioContext(null);
    if (user?.id) {
      localStorage.removeItem(getStorageKey(user.id));
    }
  }, [user?.id]);

  return {
    messages,
    isLoading,
    conversationId,
    scenarios,
    scenariosLoading,
    activeScenarioContext,
    sendMessage,
    clearChat,
    fetchScenarios,
    loadConversation,
    resumeConversation,
  };
}
