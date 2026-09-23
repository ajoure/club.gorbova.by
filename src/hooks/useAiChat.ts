import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { UnsupportedFileInfo } from "@/types/files";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";
import { shouldRestoreScenarioContext } from "@/lib/aiScenarioRouting";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: AiChatMetadata;
}

export interface AiChatMetadata {
  /** Local transport errors are displayed but never sent as model history. */
  is_error?: boolean;
  /** Sensitive one-off tool output stays only in the current UI session. */
  exclude_from_ai_history?: boolean;
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
  scenario_code?: string;
  decision?: "recommended" | "clarification" | "not_found";
  legal_source_regnum?: string;
  legal_source_revision?: string;
  catalog_positions?: number;
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

function buildBankStatementErrorMessage(message: string, fileNames: string[] = []): string {
  const normalized = message.toLowerCase();
  const files = fileNames.length > 0
    ? `\n\n**Файл:** ${fileNames.join(", ")}`
    : "";

  if (normalized.includes("времени") || normalized.includes("timeout")) {
    return `### Выписку не удалось распознать${files}\n\nРаспознавание заняло слишком много времени.\n\n**Что сделать:**\n1. Выгрузите выписку из интернет-банка в XLSX или CSV — это самый надёжный вариант.\n2. Если используете PDF, выберите файл с выделяемым текстом, а не скан.\n3. Загружайте один счёт и период не более одного месяца. Большую выписку разделите по месяцам.\n4. Затем выберите файл ниже и запустите анализ ещё раз.`;
  }

  if (normalized.includes("распознат") || normalized.includes("банковск") || normalized.includes("поддерживаем")) {
    return `### Выписку не удалось распознать${files}\n\n${message}\n\n**Что проверить:**\n- файл не защищён паролем;\n- в нём читаются дата, сумма, назначение платежа, получатель и УНП;\n- предпочтительный формат — XLSX, CSV или PDF с выделяемым текстом;\n- один файл содержит один счёт и период не более одного месяца.\n\nИсправьте файл и запустите анализ ещё раз.`;
  }

  return `### Анализ выписки завершился с ошибкой${files}\n\n${message}\n\n**Что сделать:** попробуйте ещё раз. Если ошибка повторится, загрузите экспорт из интернет-банка в XLSX или CSV за один месяц.`;
}

function buildActReconciliationErrorMessage(message: string, fileNames: string[] = []): string {
  const normalized = message.toLowerCase();
  const files = fileNames.length > 0
    ? `\n\n**Файлы:** ${fileNames.map((name, index) => `${index + 1}. ${name}`).join("; ")}`
    : "";
  if (normalized.includes("времени") || normalized.includes("timeout")) {
    return `### Сверка актов не завершена${files}\n\nОбработка заняла слишком много времени.\n\n**Что сделать:**\n1. Сформируйте оба акта за одинаковый, более короткий период.\n2. Лучше загрузите XLSX/CSV или PDF с выделяемым текстом.\n3. Проверьте порядок: сначала ваш акт, затем акт контрагента.\n4. Запустите сверку ещё раз.`;
  }
  if (normalized.includes("распознат") || normalized.includes("ровно два") || normalized.includes("прочитать") || normalized.includes("поддержива")) {
    return `### Акты не удалось распознать${files}\n\n${message}\n\n**Что проверить:**\n- загружено ровно два акта: сначала ваш, затем акт контрагента;\n- период и стороны в документах совпадают;\n- читаются даты, номера документов, суммы, операции и сальдо;\n- файлы не защищены паролем;\n- предпочтительный формат — XLSX, CSV или PDF с выделяемым текстом.\n\nИсправьте файлы и запустите сверку ещё раз.`;
  }
  return `### Сверка актов завершилась с ошибкой${files}\n\n${message}\n\n**Что сделать:** повторите попытку. Если ошибка повторится, сформируйте оба акта за меньший период в XLSX, CSV или PDF с текстовым слоем.`;
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
  const requestEpoch = useRef(0);
  const requestPending = useRef(false);
  const currentUserId = useRef(user?.id);
  currentUserId.current = user?.id;

  useEffect(() => {
    initRef.current = false;
    setMessages([INITIAL_MESSAGE]);
    setConversationId(null);
    setActiveScenarioContext(null);
    setIsLoading(false);
    return () => {
      requestEpoch.current++;
      requestPending.current = false;
    };
  }, [user?.id]);

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

    const epoch = ++requestEpoch.current;
    requestPending.current = false;
    setIsLoading(false);
    try {
      const { data, error } = await supabase
        .from("ai_chat_messages")
        .select("id, role, content, created_at, metadata")
        .eq("conversation_id", convId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (epoch !== requestEpoch.current || currentUserId.current !== user.id) return { loaded: false, scenarioContext: null };
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
      const lastAssistant = [...loaded].reverse().find((message) =>
        message.role === "assistant" &&
        shouldRestoreScenarioContext(message.metadata?.scenario_type)
      );
      if (lastAssistant?.metadata) {
        freshContext = {
          prompt_id: lastAssistant.metadata.prompt_id,
          scenario_type: lastAssistant.metadata.scenario_type,
          launcher_title_snapshot: lastAssistant.metadata.launcher_title_snapshot,
        };
      }
      setActiveScenarioContext(freshContext);

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
    if ((!content.trim() && !options?.fileContents) || requestPending.current) return;
    const epoch = requestEpoch.current;
    const isCurrent = () => epoch === requestEpoch.current && currentUserId.current === user?.id;
    requestPending.current = true;

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
      const allMessages = [...messages.filter(m => m.id !== "welcome" && !m.metadata?.is_error && !m.metadata?.exclude_from_ai_history), userMsg].map(m => ({
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

      if (!isCurrent()) return;
      if (error) {
        const errMsg = await normalizeEdgeFunctionErrorAsync(error, data);
        if (!isCurrent()) return;
        
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
      if (shouldRestoreScenarioContext(data?.metadata?.scenario_type)) {
        setActiveScenarioContext({
          prompt_id: data.metadata.prompt_id,
          scenario_type: data.metadata.scenario_type,
          launcher_title_snapshot: data.metadata.launcher_title_snapshot,
        });
      } else {
        setActiveScenarioContext(null);
      }

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      if (!isCurrent()) return;
      console.error("Chat error:", err);
      const message = err instanceof Error ? err.message : "Произошла ошибка при обработке запроса. Попробуйте ещё раз.";
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: message,
        timestamp: new Date(),
        metadata: { is_error: true },
      }]);
    } finally {
      if (isCurrent()) {
        requestPending.current = false;
        setIsLoading(false);
      }
    }
  }, [messages, conversationId, toast, user?.id]);

  const runAssetClassifier = useCallback(async (content: string) => {
    const query = content.trim();
    if (!query || requestPending.current) return;
    const epoch = requestEpoch.current;
    const isCurrent = () => epoch === requestEpoch.current && currentUserId.current === user?.id;
    requestPending.current = true;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      timestamp: new Date(),
      metadata: {
        scenario_code: "asset_classifier",
        scenario_type: "asset_classifier_hybrid",
      },
    };

    setMessages((previous) => [...previous, userMsg]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("asset-classifier", {
        body: {
          query,
          conversation_id: conversationId,
        },
      });

      if (!isCurrent()) return;
      if (error) {
        const message = await normalizeEdgeFunctionErrorAsync(error, data);
        if (!isCurrent()) return;
        toast({
          title: "Не удалось определить шифр ОС",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      }

      if (data?.conversation_id) {
        setConversationId(data.conversation_id);
        if (user?.id) {
          localStorage.setItem(getStorageKey(user.id), data.conversation_id);
        }
      }

      const metadata = data?.metadata as AiChatMetadata | undefined;
      setMessages((previous) => [...previous, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.content || "Не удалось подобрать позицию.",
        timestamp: new Date(),
        metadata,
      }]);
      // «Определение шифра ОС» — разовый инструмент. Следующее сообщение
      // снова относится к обычному чату, пока пользователь явно не выберет
      // инструмент в меню возможностей помощника.
      setActiveScenarioContext(null);
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Asset classifier error:", error);
      const message = error instanceof Error
        ? error.message
        : "Произошла ошибка при подборе шифра. Попробуйте ещё раз.";
      setMessages((previous) => [...previous, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: message,
        timestamp: new Date(),
        metadata: { is_error: true },
      }]);
    } finally {
      if (isCurrent()) {
        requestPending.current = false;
        setIsLoading(false);
      }
    }
  }, [conversationId, toast, user?.id]);

  const runBankStatementAnalyzer = useCallback(async (payload: {
    fileContents?: string;
    fileNames?: string[];
    images?: Array<{ base64: string; filename: string; mimeType?: string }>;
    unsupportedFiles?: UnsupportedFileInfo[];
  }): Promise<boolean> => {
    if ((!payload.fileContents && !payload.images?.length) || requestPending.current) return false;
    const epoch = requestEpoch.current;
    const isCurrent = () => epoch === requestEpoch.current && currentUserId.current === user?.id;
    requestPending.current = true;
    setMessages((previous) => [...previous, {
      id: crypto.randomUUID(),
      role: "user",
      content: `Анализ выписки: ${(payload.fileNames || []).join(", ")}`,
      timestamp: new Date(),
      metadata: {
        file_names: payload.fileNames,
        scenario_code: "bank_statement_analysis",
        scenario_type: "file_analysis",
        exclude_from_ai_history: true,
      },
    }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("bank-statement-analyzer", {
        body: {
          file_contents: payload.fileContents,
          file_names: payload.fileNames,
          images: payload.images,
          unsupported_files: payload.unsupportedFiles,
        },
      });
      if (!isCurrent()) return false;
      if (error) {
        const message = await normalizeEdgeFunctionErrorAsync(error, data);
        throw new Error(message);
      }
      setMessages((previous) => [...previous, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.content || "Не удалось сформировать отчёт по выписке.",
        timestamp: new Date(),
        metadata: { ...(data?.metadata || {}), exclude_from_ai_history: true },
      }]);
      setActiveScenarioContext(null);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const message = error instanceof Error ? error.message : "Произошла ошибка при анализе выписки.";
      setMessages((previous) => [...previous, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: buildBankStatementErrorMessage(message, payload.fileNames),
        timestamp: new Date(),
        metadata: {
          is_error: true,
          exclude_from_ai_history: true,
          scenario_code: "bank_statement_analysis",
          scenario_type: "file_analysis",
          launcher_title_snapshot: "Анализ выписки",
          file_names: payload.fileNames,
        },
      }]);
      return false;
    } finally {
      if (isCurrent()) {
        requestPending.current = false;
        setIsLoading(false);
      }
    }
  }, [user?.id]);

  const runActReconciliation = useCallback(async (payload: {
    fileContents?: string;
    fileNames?: string[];
    images?: Array<{ base64: string; filename: string; mimeType?: string }>;
    unsupportedFiles?: UnsupportedFileInfo[];
  }): Promise<boolean> => {
    if (payload.fileNames?.length !== 2 || (!payload.fileContents && !payload.images?.length) || requestPending.current) return false;
    const epoch = requestEpoch.current;
    const isCurrent = () => epoch === requestEpoch.current && currentUserId.current === user?.id;
    requestPending.current = true;
    setMessages((previous) => [...previous, {
      id: crypto.randomUUID(),
      role: "user",
      content: `Сверка актов: ${(payload.fileNames || []).join(" ↔ ")}`,
      timestamp: new Date(),
      metadata: {
        file_names: payload.fileNames,
        scenario_code: "act_reconciliation",
        scenario_type: "file_analysis",
        exclude_from_ai_history: true,
      },
    }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("act-reconciliation-analyzer", {
        body: {
          file_contents: payload.fileContents,
          file_names: payload.fileNames,
          images: payload.images,
          unsupported_files: payload.unsupportedFiles,
        },
      });
      if (!isCurrent()) return false;
      if (error) throw new Error(await normalizeEdgeFunctionErrorAsync(error, data));
      setMessages((previous) => [...previous, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.content || "Не удалось сформировать отчёт по сверке актов.",
        timestamp: new Date(),
        metadata: { ...(data?.metadata || {}), exclude_from_ai_history: true },
      }]);
      setActiveScenarioContext(null);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const message = error instanceof Error ? error.message : "Произошла ошибка при сверке актов.";
      setMessages((previous) => [...previous, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: buildActReconciliationErrorMessage(message, payload.fileNames),
        timestamp: new Date(),
        metadata: {
          is_error: true,
          exclude_from_ai_history: true,
          scenario_code: "act_reconciliation",
          scenario_type: "file_analysis",
          launcher_title_snapshot: "Сверка актов",
          file_names: payload.fileNames,
        },
      }]);
      return false;
    } finally {
      if (isCurrent()) {
        requestPending.current = false;
        setIsLoading(false);
      }
    }
  }, [user?.id]);

  const clearChat = useCallback(() => {
    requestEpoch.current++;
    requestPending.current = false;
    setIsLoading(false);
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
    runAssetClassifier,
    runBankStatementAnalyzer,
    runActReconciliation,
    clearChat,
    fetchScenarios,
    loadConversation,
    resumeConversation,
  };
}
