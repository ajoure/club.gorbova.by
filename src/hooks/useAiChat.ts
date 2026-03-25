import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
}

export interface ChatScenario {
  id: string;
  launcher_title: string;
  launcher_description: string | null;
  type: string;
  input_hint: string | null;
  icon: string | null;
  launcher_order: number;
}

const INITIAL_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Привет! 👋 Я gorbova AI — твой персональный помощник в бизнесе и налогах. Чем могу помочь сегодня?",
  timestamp: new Date(),
};

export function useAiChat() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ChatScenario[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(false);

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
        },
      });

      if (error) {
        // Check for specific status codes from edge function
        const errMsg = typeof error === "object" && "message" in error ? error.message : String(error);
        
        if (errMsg.includes("429") || errMsg.includes("Слишком много")) {
          toast({ title: "Слишком много запросов", description: "Попробуйте позже", variant: "destructive" });
        } else if (errMsg.includes("402") || errMsg.includes("Исчерпан")) {
          toast({ title: "Лимит AI исчерпан", description: "Обратитесь к администратору", variant: "destructive" });
        } else {
          toast({ title: "Ошибка AI", description: "Попробуйте ещё раз через несколько секунд", variant: "destructive" });
        }
        throw error;
      }

      if (data?.conversation_id) {
        setConversationId(data.conversation_id);
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.content || "Нет ответа",
        timestamp: new Date(),
        metadata: data?.metadata,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error("Chat error:", err);
      // Add error message to chat
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Произошла ошибка при обработке запроса. Попробуйте ещё раз.",
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, conversationId, toast]);

  const clearChat = useCallback(() => {
    setMessages([INITIAL_MESSAGE]);
    setConversationId(null);
  }, []);

  return {
    messages,
    isLoading,
    scenarios,
    scenariosLoading,
    sendMessage,
    clearChat,
    fetchScenarios,
  };
}
