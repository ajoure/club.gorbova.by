import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from "react";
import { extractAllFilesContent, getFileType } from "@/utils/fileExtractor";
import { FileDropZone, type UploadedFile, processDroppedFile } from "@/components/mns/FileDropZone";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import { EntityTableView } from "@/components/ai-requisites/EntityTableView";
import { EntityRecordSheet, type RecordSheetMode } from "@/components/ai-requisites/EntityRecordSheet";
import { PersonsTableView } from "@/components/ai-requisites/PersonsTableView";
import { PersonRecordSheet } from "@/components/ai-requisites/PersonRecordSheet";
// Sprint 11 C1: legacy документный UI отключён из роутинга.
// AiDocumentsGenerateView / AiDocumentsHistoryView / CanonicalActGenerator /
// CanonicalTemplateVersionsPanel / AliasesTab оставлены как dead-code до cleanup-коммита.
import { PlaceholdersCatalogTab } from "@/components/ai-documents/PlaceholdersCatalogTab";
import { StrictDocumentTemplatesManager } from "@/components/ai-documents/StrictDocumentTemplatesManager";
import { PackagesWorkspace } from "@/components/ai-documents/packages/PackagesWorkspace";
// Sprint 3F Phase 2c: PackageAdminPanel больше не подключён здесь —
// его подкомпоненты (PackageRolesManager, TemplateBindingControl,
// PackageTemplateValidationPanel) встроены в PackagesWorkspace.
import type { PersonRow } from "@/hooks/useAiPersons";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRbac } from "@/hooks/useRbac";
import { useAiChat, type ChatScenario } from "@/hooks/useAiChat";
import { useAiAccess } from "@/hooks/useAiAccess";
import { toast } from "sonner";
import { useAiUserPrompts, type AiUserPrompt } from "@/hooks/useAiUserPrompts";
import { ChatMessageBubble } from "@/components/ai-chat/ChatMessage";
import { ChatScenarioLauncher } from "@/components/ai-chat/ChatScenarioLauncher";
import { PromptRunFlow } from "@/components/ai-chat/PromptRunFlow";
import { PromptCard } from "@/components/ai-chat/PromptCard";
import { PromptFormDialog } from "@/components/ai-chat/PromptFormDialog";
import { AnalysisHistoryView } from "@/components/ai-chat/AnalysisHistoryView";
import { HelpTooltip } from "@/components/help/HelpComponents";

/** Sprint 3R: краткие подсказки для подвкладок раздела «Документы»/«Генерация документов». */
const SUBTAB_HINTS: Partial<Record<string, string>> = {
  chat: "Свободный диалог с ассистентом по любым вопросам.",
  "analysis-history": "Архив прошлых анализов файлов и переписки.",
  tutorials: "Готовые сценарии работы с ассистентом для админа.",
  prompts: "Каталог промптов для повторного запуска.",
  placeholders: "Справочник полей, которые можно вставить в шаблон Word.",
  templates: "Загрузка и настройка шаблонов отдельных документов (договор, акт, счёт).",
  "pkg-ideology": "Пакеты документов: анкеты, шаблоны пакета и формирование.",
  history: "История сформированных документов.",
  executors: "Карточки ваших организаций — данные исполнителя для подстановки в документы.",
  entities: "Реквизиты ваших юрлиц и ИП — заполняются один раз и подставляются в документы.",
  persons: "Реквизиты физлиц (паспорт, адрес) — для договоров и актов.",
};
import { 
  Bot, 
  PlayCircle, 
  Copy, 
  Send, 
  Clock,
  FileText,
  FileStack,
  MessageSquare,
  Building2,
  Users,
  Plus,
  Loader2,
  Paperclip,
  Tag,
} from "lucide-react";

/* ─── Lazy-loaded content components ─── */
// Sprint 11 C1: legacy AdminDocumentTemplates отключён, новый strict flow — ниже.
const LazyExecutorsContent = lazy(() =>
  import("@/pages/admin/AdminExecutors").then(m => ({ default: m.ExecutorsContent }))
);

/* ─── Конфигурация секций и подменю ─── */

type Section = "ai" | "documents" | "doc-packages" | "requisites";
// Sprint 11 C1: legacy ids ("generate", "canonical-acts", "aliases") оставлены в типе,
// чтобы старые ссылки не падали; рендер их игнорирует — guard сбросит на DEFAULT_SUB.
type SubTab = "chat" | "analysis-history" | "tutorials" | "prompts" | "generate" | "history" | "templates" | "executors" | "entities" | "persons" | "canonical-acts" | "aliases" | "placeholders" | "pkg-ideology" | "pkg-admin";

const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[] = [
  { id: "ai", label: "Gorbova AI", icon: Bot },
  { id: "documents", label: "Документы", icon: FileText, adminOnly: true },
  { id: "doc-packages", label: "Документы", icon: FileStack },
  { id: "requisites", label: "Реквизиты", icon: Building2 },
];


interface SubMenuItem {
  id: SubTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  activeGradient: string;
  borderColor: string;
  iconColor: string;
  adminOnly?: boolean;
}

const AI_SUB_TABS: SubMenuItem[] = [
  {
    id: "chat",
    label: "Чат",
    icon: MessageSquare,
    gradient: "from-blue-500/10 to-indigo-500/8",
    activeGradient: "from-blue-500/20 to-indigo-500/15",
    borderColor: "border-blue-400/20",
    iconColor: "text-blue-500",
  },
  {
    id: "analysis-history",
    label: "История анализа",
    icon: Clock,
    gradient: "from-teal-500/10 to-cyan-500/8",
    activeGradient: "from-teal-500/20 to-cyan-500/15",
    borderColor: "border-teal-400/20",
    iconColor: "text-teal-500",
  },
  {
    id: "tutorials",
    label: "Туториалы",
    icon: PlayCircle,
    gradient: "from-purple-500/10 to-violet-500/8",
    activeGradient: "from-purple-500/20 to-violet-500/15",
    borderColor: "border-purple-400/20",
    iconColor: "text-purple-500",
    adminOnly: true,
  },
  {
    id: "prompts",
    label: "Промпты",
    icon: Copy,
    gradient: "from-amber-500/10 to-orange-500/8",
    activeGradient: "from-amber-500/20 to-orange-500/15",
    borderColor: "border-amber-400/20",
    iconColor: "text-amber-600",
    adminOnly: true,
  },
];

// Sprint 11 C1: оставлены только strict-вкладки. Legacy (canonical-acts, aliases,
// generate=AiDocumentsGenerateView, history=AiDocumentsHistoryView) убраны из меню.
// Sprint 12 (nav cleanup): пакеты документов теперь подвкладка внутри «Документы».
const DOC_SUB_TABS: SubMenuItem[] = [
  {
    id: "placeholders",
    label: "Плейсхолдеры",
    icon: Tag as any,
    gradient: "from-indigo-500/10 to-violet-500/8",
    activeGradient: "from-indigo-500/20 to-violet-500/15",
    borderColor: "border-indigo-400/20",
    iconColor: "text-indigo-500",
    adminOnly: true,
  },
  {
    id: "templates",
    label: "Шаблоны документов",
    icon: FileStack,
    gradient: "from-orange-500/10 to-amber-500/8",
    activeGradient: "from-orange-500/20 to-amber-500/15",
    borderColor: "border-orange-400/20",
    iconColor: "text-orange-500",
  },
  {
    id: "pkg-ideology",
    label: "Пакеты документов",
    icon: FileText,
    gradient: "from-emerald-500/10 to-teal-500/8",
    activeGradient: "from-emerald-500/20 to-teal-500/15",
    borderColor: "border-emerald-400/20",
    iconColor: "text-emerald-500",
  },
  // Sprint 3F Phase 2c: вкладка «Админ. пакеты» удалена. Управление ролями,
  // привязкой шаблонов и валидацией переехало внутрь «Пакеты документов»
  // (PackagesWorkspace), в конкретный пакет (Идеология и т.д.).
  {
    id: "history",
    label: "История",
    icon: Clock,
    gradient: "from-slate-500/10 to-gray-500/8",
    activeGradient: "from-slate-500/20 to-gray-500/15",
    borderColor: "border-slate-400/20",
    iconColor: "text-slate-500",
  },
  {
    id: "executors",
    label: "Исполнители",
    icon: Building2,
    gradient: "from-violet-500/10 to-purple-500/8",
    activeGradient: "from-violet-500/20 to-purple-500/15",
    borderColor: "border-violet-400/20",
    iconColor: "text-violet-500",
  },
];


const REQ_SUB_TABS: SubMenuItem[] = [
  {
    id: "entities",
    label: "Юрлица / ИП",
    icon: Building2,
    gradient: "from-indigo-500/10 to-violet-500/8",
    activeGradient: "from-indigo-500/20 to-violet-500/15",
    borderColor: "border-indigo-400/20",
    iconColor: "text-indigo-500",
  },
  {
    id: "persons",
    label: "Физлица",
    icon: Users,
    gradient: "from-teal-500/10 to-emerald-500/8",
    activeGradient: "from-teal-500/20 to-emerald-500/15",
    borderColor: "border-teal-400/20",
    iconColor: "text-teal-500",
  },
];

const PACKAGE_SUB_TABS: SubMenuItem[] = [
  {
    id: "pkg-ideology",
    label: "Идеология",
    icon: FileText,
    gradient: "from-orange-500/10 to-amber-500/8",
    activeGradient: "from-orange-500/20 to-amber-500/15",
    borderColor: "border-orange-400/20",
    iconColor: "text-orange-500",
  },
];

const DEFAULT_SUB: Record<Section, SubTab> = {
  ai: "chat",
  documents: "placeholders",
  "doc-packages": "pkg-ideology",
  requisites: "entities",
};


interface AiPageContentProps {
  mode: "user" | "admin";
  initialSection?: Section;
  hiddenSections?: Section[];
}

export function AiPageContent({ mode, initialSection, hiddenSections }: AiPageContentProps) {
  const rbac = useRbac();
  const isAdminUser = rbac.isAdmin || rbac.isSuperAdmin;
  
  const [inputValue, setInputValue] = useState("");
  const [activeSection, setActiveSection] = useState<Section>(initialSection ?? "ai");
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(DEFAULT_SUB[initialSection ?? "ai"]);

  const [activeScenario, setActiveScenario] = useState<ChatScenario | null>(null);
  const [chatFiles, setChatFiles] = useState<UploadedFile[]>([]);
  const [showUploader, setShowUploader] = useState(false);
  const [isDragOverChat, setIsDragOverChat] = useState(false);

  // Auto-scroll refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const userSentMessageRef = useRef(false);
  const prevMessageCountRef = useRef(0);

  // Chat
  const aiChat = useAiChat();
  const { data: aiAccess } = useAiAccess();
  const chatAllowed = aiAccess ? aiAccess.allowed_modes.chat : true;
  const chatQuota = aiAccess?.quota_by_mode.chat.daily;

  // Scroll listener — track if user is near bottom
  useEffect(() => {
    if (activeSubTab !== "chat") return;
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;
    const handleScroll = () => {
      isNearBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
    };
    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [activeSubTab]);

  // Auto-scroll on new messages (only for chat tab)
  useEffect(() => {
    if (activeSubTab !== "chat") return;
    const count = aiChat.messages.length;
    if (count === prevMessageCountRef.current) return;
    prevMessageCountRef.current = count;

    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;

    if (isInitialLoadRef.current) {
      requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
      isInitialLoadRef.current = false;
      return;
    }

    if (isNearBottomRef.current || userSentMessageRef.current) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
      userSentMessageRef.current = false;
    }
  }, [aiChat.messages.length, activeSubTab]);

  // Scroll to bottom when returning to "chat" tab
  useEffect(() => {
    if (activeSubTab !== "chat") return;
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;
    requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
  }, [activeSubTab]);

  // Admin prompts
  const adminPrompts = useAiUserPrompts();
  const [editingPrompt, setEditingPrompt] = useState<AiUserPrompt | null>(null);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);

  // Entity management state — unified shell
  const [recordSheetOpen, setRecordSheetOpen] = useState(false);
  const [recordSheetMode, setRecordSheetMode] = useState<RecordSheetMode>("view");
  const [recordSheetEntityId, setRecordSheetEntityId] = useState<string | null>(null);
  const aiEntities = useAiEntities();
  const aiPersons = useAiPersons();

  const recordSheetEntity = useMemo(
    () => aiEntities.allEntities.find(e => e.id === recordSheetEntityId) ?? null,
    [aiEntities.allEntities, recordSheetEntityId]
  );

  const [personSheetOpen, setPersonSheetOpen] = useState(false);
  const [personSheetMode, setPersonSheetMode] = useState<RecordSheetMode>("view");
  const [personSheetPersonId, setPersonSheetPersonId] = useState<string | null>(null);

  const personSheetPerson = useMemo(
    () => aiPersons.allPersons.find(p => p.id === personSheetPersonId) ?? null,
    [aiPersons.allPersons, personSheetPersonId]
  );

  const handleEntityCreate = useCallback(async (data: Partial<ClientLegalDetails>) => {
    await aiEntities.createEntity(data);
  }, [aiEntities]);

  const handleEntityUpdate = useCallback(async (data: Partial<ClientLegalDetails>) => {
    if (!recordSheetEntity) return;
    await aiEntities.updateEntity({ id: recordSheetEntity.id, ...data });
  }, [aiEntities, recordSheetEntity]);

  const handleOpenCreateSheet = useCallback(() => {
    setRecordSheetEntityId(null);
    setRecordSheetMode("create");
    setRecordSheetOpen(true);
  }, []);

  const handleOpenViewSheet = useCallback((entity: ClientLegalDetails) => {
    setRecordSheetEntityId(entity.id);
    setRecordSheetMode("view");
    setRecordSheetOpen(true);
  }, []);

  const handleOpenExistingEntity = useCallback((id: string) => {
    setRecordSheetEntityId(id);
    setRecordSheetMode("view");
    setRecordSheetOpen(true);
  }, []);

  const handleOpenCreatePersonSheet = useCallback(() => {
    setPersonSheetPersonId(null);
    setPersonSheetMode("create");
    setPersonSheetOpen(true);
  }, []);

  const handleOpenViewPersonSheet = useCallback((person: PersonRow) => {
    setPersonSheetPersonId(person.id);
    setPersonSheetMode("view");
    setPersonSheetOpen(true);
  }, []);

  const handleOpenExistingPerson = useCallback((id: string) => {
    setPersonSheetPersonId(id);
    setPersonSheetMode("view");
    setPersonSheetOpen(true);
  }, []);

  const handlePersonCreate = useCallback(async (data: Record<string, any>) => {
    await aiPersons.createPerson(data as any);
  }, [aiPersons]);

  const handlePersonUpdate = useCallback(async (data: Record<string, any>) => {
    if (!personSheetPerson) return;
    await aiPersons.updatePerson({ id: personSheetPerson.id, ...data } as any);
  }, [aiPersons, personSheetPerson]);

  // Shared extraction pipeline for both free chat and scenario mode
  const prepareFilesPayload = async (uploadedFiles: UploadedFile[]) => {
    const fileEntries = await Promise.all(
      uploadedFiles.map(async (uf) => {
        let preview: string | undefined;
        if (uf.type === "image") {
          preview = uf.preview || await fileToBase64(uf.file);
        }
        return { file: uf.file, type: uf.type, preview };
      })
    );
    const { textContent, images, unsupportedFiles } = await extractAllFilesContent(fileEntries);
    const allFiles = uploadedFiles.map((uf) => uf.file);
    return {
      fileContents: textContent || undefined,
      fileNames: allFiles.map((f) => f.name),
      images: images.length > 0
        ? images.map((img) => ({
            ...img,
            mimeType: allFiles.find((f) => f.name === img.filename)?.type || "image/jpeg",
          }))
        : undefined,
      unsupportedFiles,
    };
  };

  // Chat handlers — PATCH v2.2: свободный чат без файлов, только текст.
  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    userSentMessageRef.current = true;
    const promptId = aiChat.activeScenarioContext?.prompt_id;
    await aiChat.sendMessage(inputValue, { promptId });
    setInputValue("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleScenarioSelect = (scenario: ChatScenario) => {
    if (scenario.type === "file_analysis" || scenario.type === "document_review") {
      setActiveScenario(scenario);
    } else {
      aiChat.sendMessage(`Используй сценарий: ${scenario.launcher_title}`, { promptId: scenario.id });
    }
  };

  const handleScenarioSubmit = async (files: File[]) => {
    if (!activeScenario) return;
    userSentMessageRef.current = true;

    // Adapt File[] to UploadedFile[] for shared pipeline
    const uploadedFiles: UploadedFile[] = await Promise.all(
      files.map(async (file) => {
        const type = getFileType(file) as UploadedFile["type"];
        let preview: string | undefined;
        if (type === "image") {
          preview = await fileToBase64(file);
        }
        return { id: crypto.randomUUID(), file, type, preview };
      })
    );

    const payload = await prepareFilesPayload(uploadedFiles);

    await aiChat.sendMessage(
      `Анализ файлов: ${files.map((f) => f.name).join(", ")}`,
      { promptId: activeScenario.id, ...payload }
    );
    setActiveScenario(null);
  };

  // Drag & drop handlers for chat area
  const handleChatDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverChat(true);
  }, []);

  const handleChatDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverChat(false);
  }, []);

  const handleChatDrop = useCallback(async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverChat(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;
    setShowUploader(true);
    const remaining = 5 - chatFiles.length;
    if (remaining <= 0) return;
    const processed = await Promise.all(
      droppedFiles.slice(0, remaining).map(f => processDroppedFile(f, 20))
    );
    const valid = processed.filter((f): f is UploadedFile => f !== null);
    if (valid.length > 0) setChatFiles(prev => [...prev, ...valid]);
  }, [chatFiles.length]);

  // Admin prompt handlers
  const handleEditPrompt = (prompt: AiUserPrompt) => {
    setEditingPrompt(prompt);
    setPromptDialogOpen(true);
  };

  const handleCreatePrompt = () => {
    setEditingPrompt(null);
    setPromptDialogOpen(true);
  };

  const handleSavePrompt = async (data: Partial<AiUserPrompt>) => {
    if (editingPrompt) {
      await adminPrompts.updatePrompt(editingPrompt.id, data);
    } else {
      await adminPrompts.createPrompt(data);
    }
  };

  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    setActiveSubTab(DEFAULT_SUB[section]);
  };

  // Filter sections and sub-tabs strictly by mode (not isAdminUser)
  const visibleSections = useMemo(
    () => SECTIONS.filter(sec =>
      (!sec.adminOnly || mode === "admin") &&
      !(hiddenSections ?? []).includes(sec.id)
    ),
    [mode, hiddenSections]
  );


  const subTabsForSection = (s: Section): SubMenuItem[] => {
    switch (s) {
      case "ai": return AI_SUB_TABS;
      case "requisites": return REQ_SUB_TABS;
      case "doc-packages": return PACKAGE_SUB_TABS;
      default: return DOC_SUB_TABS;
    }
  };
  const allSubTabs = subTabsForSection(activeSection);
  const subTabs = useMemo(
    () => allSubTabs.filter(tab => !tab.adminOnly || mode === "admin"),
    [allSubTabs, mode]
  );

  // Guard: reset activeSection if it became invisible
  useEffect(() => {
    if (!visibleSections.some(s => s.id === activeSection)) {
      const fallback = visibleSections[0]?.id ?? "ai";
      // Find a visible subtab for the fallback section
      const fallbackAllSubs = subTabsForSection(fallback);

      const fallbackVisibleSubs = fallbackAllSubs.filter(t => !t.adminOnly || mode === "admin");
      const defaultSub = DEFAULT_SUB[fallback];
      const safeSub = fallbackVisibleSubs.some(t => t.id === defaultSub)
        ? defaultSub
        : fallbackVisibleSubs[0]?.id ?? defaultSub;
      setActiveSection(fallback);
      setActiveSubTab(safeSub);
    }
  }, [activeSection, visibleSections, mode]);

  // Guard: reset activeSubTab if it became invisible
  useEffect(() => {
    if (subTabs.length === 0) return;
    if (!subTabs.some(t => t.id === activeSubTab)) {
      const defaultSub = DEFAULT_SUB[activeSection];
      const fallback = subTabs.some(t => t.id === defaultSub)
        ? defaultSub
        : subTabs[0]?.id ?? defaultSub;
      setActiveSubTab(fallback);
    }
  }, [activeSubTab, subTabs, activeSection]);

  const sectionTabClass = (active: boolean) =>
    `relative flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      active
        ? "bg-background text-foreground shadow-inner"
        : "text-muted-foreground hover:text-foreground"
    }`;

  /** Offset от верха viewport до контейнера чата (header + padding) */
  const AI_CONTAINER_OFFSET = mode === "admin" ? '3rem' : '4.5rem';

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 gap-1 overflow-hidden bg-gradient-to-br from-blue-500/[0.02] via-transparent to-purple-500/[0.02] ${mode === "user" ? "-mt-2 md:-mt-4" : ""}`}
      style={{ height: `calc(100dvh - ${AI_CONTAINER_OFFSET})`, maxHeight: `calc(100dvh - ${AI_CONTAINER_OFFSET})` }}
    >

      {/* ── Главные табы ── */}
      <div className="px-1 py-0.5 shrink-0">
        <div
          role="tablist"
          aria-label="AI разделы"
          className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none"
        >
          {visibleSections.map((sec) => {
            const isActive = activeSection === sec.id;
            const Icon = sec.icon;
            return (
              <button
                type="button"
                key={sec.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleSectionChange(sec.id)}
                className={sectionTabClass(isActive)}
              >
                <Icon className="h-4 w-4 mr-0.5" />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Подменю ── */}
      <div className="px-1 shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {subTabs.map((tab) => {
            const isActive = activeSubTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                  transition-all duration-200 whitespace-nowrap
                  backdrop-blur-sm border
                  bg-gradient-to-r
                  ${isActive ? tab.activeGradient : tab.gradient}
                  ${isActive ? tab.borderColor : "border-white/15"}
                  ${isActive ? "shadow-inner ring-1 ring-inset ring-border/20" : "shadow-sm hover:shadow-md"}
                  ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
                  active:scale-[0.97]
                `}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? tab.iconColor : ""}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Контент ── */}

      {/* Chat */}
      {activeSubTab === "chat" && (
        <GlassCard
          className={cn(
            "p-0 overflow-hidden flex flex-col flex-1 min-h-0 transition-all",
            isDragOverChat && "ring-2 ring-primary/30"
          )}
          onDragOver={handleChatDragOver}
          onDragLeave={handleChatDragLeave}
          onDrop={handleChatDrop}
        >
          {/* Chat header with "New chat" button */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 shrink-0">
            <span className="text-xs text-muted-foreground">Чат</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => {
                aiChat.clearChat();
                prevMessageCountRef.current = 0;
                isInitialLoadRef.current = true;
                setActiveScenario(null);
                setChatFiles([]);
                setShowUploader(false);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Новый чат
            </Button>
          </div>
          <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 min-w-0 p-2 sm:p-4">
            <div className="space-y-4 min-w-0">
              {aiChat.messages.map((message) => (
                <ChatMessageBubble key={message.id} message={message} />
              ))}
              {aiChat.isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-full bg-primary/10">
                        <Bot className="h-4 w-4 text-primary animate-pulse" />
                      </div>
                      <span className="text-sm text-muted-foreground">Думаю...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Scenario run flow */}
          {activeScenario && (
            <PromptRunFlow
              scenario={activeScenario}
              onSubmit={handleScenarioSubmit}
              onCancel={() => setActiveScenario(null)}
              isLoading={aiChat.isLoading}
            />
          )}

          <div className="border-t border-border/50 p-2 sm:p-4 bg-background/50 shrink-0 min-w-0">
            {/* Access banner (приоритет — chat запрещён) */}
            {aiAccess && !chatAllowed && (
              <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs flex items-center justify-between gap-2">
                <span className="text-amber-800 dark:text-amber-200">
                  {aiAccess.denial_reasons.chat_not_in_tier}
                </span>
                <a
                  href={aiAccess.cta_target.business_url}
                  className="shrink-0 underline font-medium text-amber-900 dark:text-amber-100"
                >
                  Открыть Business
                </a>
              </div>
            )}

            {/* PATCH v2.2 — upload убран из свободного чата. Загрузка файлов
                разрешена только внутри сценариев balance_analysis и 107NK
                (handleScenarioSelect → activeScenario → handleScenarioSubmit). */}

            <div className="flex gap-1.5 sm:gap-2 min-w-0 items-end">
              <div className="flex flex-col gap-1 shrink-0">
                <ChatScenarioLauncher
                  scenarios={aiChat.scenarios}
                  loading={aiChat.scenariosLoading}
                  onFetch={aiChat.fetchScenarios}
                  onSelect={handleScenarioSelect}
                  disabled={aiChat.isLoading}
                  access={aiAccess}
                  onLockedClick={(_s, msg) => toast.error(msg)}
                />
              </div>
              <Textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={chatAllowed ? "Напиши свой вопрос..." : "Свободный чат недоступен на вашем тарифе. Используйте доступные сценарии."}
                className="flex-1 min-w-0 min-h-[44px] max-h-[120px] resize-none text-base sm:text-sm"
                disabled={aiChat.isLoading || !chatAllowed}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || aiChat.isLoading || !chatAllowed}
                size="icon"
                className="h-11 w-11 shrink-0 self-end"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="hidden sm:flex text-xs text-muted-foreground mt-2 items-center justify-center gap-3">
              <span>Нажми Enter для отправки, Shift+Enter для новой строки</span>
              {chatAllowed && chatQuota && (
                <span className="text-muted-foreground/80">
                  · Остаток чата сегодня: <b className="text-foreground">{chatQuota.remaining}</b> / {chatQuota.limit}
                </span>
              )}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Tutorials */}
      {activeSubTab === "tutorials" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <GlassCard className="p-6">
            <div className="text-center text-muted-foreground">
              <PlayCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <h3 className="font-semibold mb-1">Туториалы</h3>
              <p className="text-sm">Раздел в разработке</p>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Analysis History */}
      {activeSubTab === "analysis-history" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <AnalysisHistoryView
            onOpen={async (convId) => {
              isInitialLoadRef.current = true;
              prevMessageCountRef.current = 0;
              await aiChat.loadConversation(convId);
              setActiveSubTab("chat");
            }}
            onResume={async (convId) => {
              isInitialLoadRef.current = true;
              prevMessageCountRef.current = 0;
              const ctx = await aiChat.resumeConversation(convId);
              if (ctx?.scenario_type) {
                const matchingScenario = aiChat.scenarios.find(
                  s => s.type === ctx.scenario_type
                );
                if (matchingScenario) {
                  // Don't auto-open upload, just restore context
                }
              }
              setActiveSubTab("chat");
            }}
          />
        </div>
      )}

      {/* Prompts — admin only (visibility controlled by mode, write access by existing RBAC) */}
      {activeSubTab === "prompts" && (mode === "admin" || isAdminUser) && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="flex items-center gap-2">
              <Button
                variant={adminPrompts.filter === "active" ? "default" : "outline"}
                size="sm"
                onClick={() => adminPrompts.setFilter("active")}
              >
                Активные
              </Button>
              <Button
                variant={adminPrompts.filter === "archived" ? "default" : "outline"}
                size="sm"
                onClick={() => adminPrompts.setFilter("archived")}
              >
                Архив
              </Button>
              <Button
                variant={adminPrompts.filter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => adminPrompts.setFilter("all")}
              >
                Все
              </Button>
            </div>
            <Button size="sm" onClick={handleCreatePrompt}>
              <Plus className="h-4 w-4 mr-1" />
              Создать
            </Button>
          </div>

          {adminPrompts.loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : adminPrompts.prompts.length === 0 ? (
            <GlassCard className="text-center py-12">
              <Copy className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Нет промптов</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleCreatePrompt}>
                Создать первый промпт
              </Button>
            </GlassCard>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {adminPrompts.prompts.map(prompt => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  onEdit={handleEditPrompt}
                  onArchive={adminPrompts.archivePrompt}
                  onToggleVisible={(id, cur) => adminPrompts.toggleVisible(id, cur)}
                />
              ))}
            </div>
          )}

          <PromptFormDialog
            open={promptDialogOpen}
            onOpenChange={setPromptDialogOpen}
            prompt={editingPrompt}
            onSave={handleSavePrompt}
            saving={adminPrompts.saving}
          />
        </div>
      )}

      {/* Documents — Sprint 11 C1: только strict-вкладки */}
      {activeSubTab === "placeholders" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <PlaceholdersCatalogTab />
        </div>
      )}
      {activeSubTab === "templates" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <StrictDocumentTemplatesManager embedded />
        </div>
      )}
      {activeSubTab === "history" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <div className="text-center py-12 text-sm text-muted-foreground">
            История генераций (canonical) появится после реализации генерации из сделки в C3.
          </div>
        </div>
      )}
      {activeSubTab === "executors" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner">
          <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
            <LazyExecutorsContent embedded />
          </Suspense>
        </div>
      )}

      {/* Sprint 3F Phase 2c: Workspace пакетов (Состав / Шаблоны / Анкета / Роли / Проверка). */}
      {activeSubTab === "pkg-ideology" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <PackagesWorkspace mode={mode} />
        </div>
      )}

      {/* Sprint 3F Phase 2c: pkg-admin удалён. Если по старой ссылке прилетели
          ?tab=pkg-admin — guard сбросит на pkg-ideology (PackagesWorkspace). */}


      {/* Entities */}
      {activeSubTab === "entities" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <EntityTableView
            allEntities={aiEntities.allEntities}
            isLoading={aiEntities.isLoading}
            isArchiving={aiEntities.isArchiving}
            onCreateNew={handleOpenCreateSheet}
            onView={handleOpenViewSheet}
            onArchive={(id) => aiEntities.archiveEntity(id)}
          />
          <EntityRecordSheet
            open={recordSheetOpen}
            onOpenChange={setRecordSheetOpen}
            mode={recordSheetMode}
            onModeChange={setRecordSheetMode}
            entity={recordSheetEntity}
            profileId={aiEntities.profileId}
            isSubmitting={recordSheetMode === "create" ? aiEntities.isCreating : aiEntities.isUpdating}
            isArchiving={aiEntities.isArchiving}
            isDeleting={aiEntities.isDeleting}
            onSubmit={recordSheetMode === "create" ? handleEntityCreate : handleEntityUpdate}
            onArchive={(id) => aiEntities.archiveEntity(id)}
            onDelete={(id) => aiEntities.deleteEntity(id)}
            onOpenExisting={handleOpenExistingEntity}
          />
        </div>
      )}

      {/* Persons */}
      {activeSubTab === "persons" && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
          <PersonsTableView
            allPersons={aiPersons.allPersons}
            isLoading={aiPersons.isLoading}
            onCreateNew={handleOpenCreatePersonSheet}
            onView={handleOpenViewPersonSheet}
          />
          <PersonRecordSheet
            open={personSheetOpen}
            onOpenChange={setPersonSheetOpen}
            mode={personSheetMode}
            onModeChange={setPersonSheetMode}
            person={personSheetPerson}
            profileId={aiPersons.profileId}
            isSubmitting={personSheetMode === "create" ? aiPersons.isCreating : aiPersons.isUpdating}
            isDeactivating={aiPersons.isDeactivating}
            isDeleting={aiPersons.isDeleting}
            onSubmit={personSheetMode === "create" ? handlePersonCreate : handlePersonUpdate}
            onDeactivate={(id) => aiPersons.deactivatePerson(id)}
            onDelete={(id) => aiPersons.deletePerson(id)}
            onOpenExisting={handleOpenExistingPerson}
          />
        </div>
      )}
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
