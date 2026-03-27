import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { extractAllFilesContent, getFileType } from "@/utils/fileExtractor";
import { FileDropZone, type UploadedFile } from "@/components/mns/FileDropZone";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import { EntityTableView } from "@/components/ai-requisites/EntityTableView";
import { EntityRecordSheet, type RecordSheetMode } from "@/components/ai-requisites/EntityRecordSheet";
import { PersonsTableView } from "@/components/ai-requisites/PersonsTableView";
import { PersonRecordSheet } from "@/components/ai-requisites/PersonRecordSheet";
import { AiDocumentsGenerateView } from "@/components/ai-documents/AiDocumentsGenerateView";
import { AiDocumentsHistoryView } from "@/components/ai-documents/AiDocumentsHistoryView";
import type { PersonRow } from "@/hooks/useAiPersons";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRbac } from "@/hooks/useRbac";
import { useAiChat, type ChatScenario } from "@/hooks/useAiChat";
import { useAiUserPrompts, type AiUserPrompt } from "@/hooks/useAiUserPrompts";
import { ChatMessageBubble } from "@/components/ai-chat/ChatMessage";
import { ChatScenarioLauncher } from "@/components/ai-chat/ChatScenarioLauncher";
import { PromptRunFlow } from "@/components/ai-chat/PromptRunFlow";
import { PromptCard } from "@/components/ai-chat/PromptCard";
import { PromptFormDialog } from "@/components/ai-chat/PromptFormDialog";
import { AnalysisHistoryView } from "@/components/ai-chat/AnalysisHistoryView";
import { 
  Bot, 
  PlayCircle, 
  Copy, 
  Send, 
  Clock,
  FileText,
  MessageSquare,
  Building2,
  Users,
  Plus,
  Loader2,
  Paperclip,
} from "lucide-react";

/* ─── Конфигурация секций и подменю ─── */

type Section = "ai" | "documents" | "requisites";
type SubTab = "chat" | "analysis-history" | "tutorials" | "prompts" | "generate" | "history" | "entities" | "persons";

const SECTIONS = [
  { id: "ai" as const, label: "Gorbova AI", icon: Bot },
  { id: "documents" as const, label: "Документы", icon: FileText },
  { id: "requisites" as const, label: "Реквизиты", icon: Building2 },
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

const DOC_SUB_TABS: SubMenuItem[] = [
  {
    id: "generate",
    label: "Создать документ",
    icon: FileText,
    gradient: "from-emerald-500/10 to-teal-500/8",
    activeGradient: "from-emerald-500/20 to-teal-500/15",
    borderColor: "border-emerald-400/20",
    iconColor: "text-emerald-500",
  },
  {
    id: "history",
    label: "История",
    icon: Clock,
    gradient: "from-slate-500/10 to-gray-500/8",
    activeGradient: "from-slate-500/20 to-gray-500/15",
    borderColor: "border-slate-400/20",
    iconColor: "text-slate-500",
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

const DEFAULT_SUB: Record<Section, SubTab> = {
  ai: "chat",
  documents: "generate",
  requisites: "entities",
};

const AI = () => {
  const rbac = useRbac();
  const isAdminUser = rbac.isAdmin || rbac.isSuperAdmin;
  
  const [inputValue, setInputValue] = useState("");
  const [activeSection, setActiveSection] = useState<Section>("ai");
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("chat");
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

  // Chat handlers
  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    userSentMessageRef.current = true;
    await aiChat.sendMessage(inputValue);
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
      // Chat type: just send a system-level hint and focus
      aiChat.sendMessage(`Используй сценарий: ${scenario.launcher_title}`, { promptId: scenario.id });
    }
  };

  const handleScenarioSubmit = async (files: File[]) => {
    if (!activeScenario) return;
    userSentMessageRef.current = true;

    // Build adapter for unified extraction pipeline
    const fileEntries = await Promise.all(
      files.map(async (file) => {
        const type = getFileType(file);
        let preview: string | undefined;
        if (type === "image") {
          preview = await fileToBase64(file);
        }
        return { file, type, preview };
      })
    );

    const { textContent, images } = await extractAllFilesContent(fileEntries);

    await aiChat.sendMessage(
      `Анализ файлов: ${files.map((f) => f.name).join(", ")}`,
      {
        promptId: activeScenario.id,
        fileContents: textContent || undefined,
        fileNames: files.map((f) => f.name),
        images: images.length > 0
          ? images.map((img) => ({
              ...img,
              mimeType: files.find((f) => f.name === img.filename)?.type || "image/jpeg",
            }))
          : undefined,
      }
    );
    setActiveScenario(null);
  };

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

  // Filter sub-tabs by role
  const allSubTabs = activeSection === "ai" ? AI_SUB_TABS : activeSection === "requisites" ? REQ_SUB_TABS : DOC_SUB_TABS;
  const subTabs = allSubTabs.filter(tab => !tab.adminOnly || isAdminUser);

  const sectionTabClass = (active: boolean) =>
    `relative flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

  /** Offset от верха viewport до контейнера чата (header + padding DashboardLayout) */
  const AI_CONTAINER_OFFSET = '4.5rem';

  return (
    <DashboardLayout>
      <div
        className="flex flex-col flex-1 min-h-0 gap-1 -mt-2 md:-mt-4 overflow-hidden bg-gradient-to-br from-blue-500/[0.02] via-transparent to-purple-500/[0.02]"
        style={{ height: `calc(100dvh - ${AI_CONTAINER_OFFSET})`, maxHeight: `calc(100dvh - ${AI_CONTAINER_OFFSET})` }}
      >

        {/* ── Главные табы ── */}
        <div className="px-1 py-0.5 shrink-0">
          <div
            role="tablist"
            aria-label="AI разделы"
            className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none"
          >
            {SECTIONS.map((sec) => {
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
                    flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                    transition-all duration-200 whitespace-nowrap
                    backdrop-blur-sm border
                    bg-gradient-to-r
                    ${isActive ? tab.activeGradient : tab.gradient}
                    ${isActive ? tab.borderColor : "border-white/15"}
                    ${isActive ? "shadow-sm shadow-white/10" : "hover:shadow-sm"}
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
          <GlassCard className="p-0 overflow-hidden flex flex-col flex-1 min-h-0">
            <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 p-4">
              <div className="space-y-4">
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

            <div className="border-t border-border/50 p-4 bg-background/50 shrink-0">
              <div className="flex gap-2">
                <ChatScenarioLauncher
                  scenarios={aiChat.scenarios}
                  loading={aiChat.scenariosLoading}
                  onFetch={aiChat.fetchScenarios}
                  onSelect={handleScenarioSelect}
                  disabled={aiChat.isLoading}
                />
                <Textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Напиши свой вопрос..."
                  className="min-h-[44px] max-h-[120px] resize-none"
                  disabled={aiChat.isLoading}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || aiChat.isLoading}
                  size="icon"
                  className="h-[44px] w-[44px] shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Нажми Enter для отправки, Shift+Enter для новой строки
              </p>
            </div>
          </GlassCard>
        )}

        {/* Tutorials */}
        {activeSubTab === "tutorials" && (
          <GlassCard className="p-6">
            <div className="text-center text-muted-foreground">
              <PlayCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <h3 className="font-semibold mb-1">Туториалы</h3>
              <p className="text-sm">Раздел в разработке</p>
            </div>
          </GlassCard>
        )}

        {/* Analysis History */}
        {activeSubTab === "analysis-history" && (
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
        )}

        {/* Prompts — admin only */}
        {activeSubTab === "prompts" && isAdminUser && (
          <>
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
          </>
        )}

        {/* Documents */}
        {activeSubTab === "generate" && <AiDocumentsGenerateView />}
        {activeSubTab === "history" && <AiDocumentsHistoryView />}

        {/* Entities */}
        {activeSubTab === "entities" && (
          <>
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
          </>
        )}

        {/* Persons */}
        {activeSubTab === "persons" && (
          <>
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
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AI;

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
