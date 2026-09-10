import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Bot,
  Settings2,
  MessageSquare,
  Sliders,
  Package,
  Loader2,
  Save,
  HelpCircle,
  Upload,
  FileText,
  X,
  Sparkles,
} from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import mammoth from "mammoth";

// ============ ПЕРЕВОДЫ И ПОДСКАЗКИ ============

const PRESET_OPTIONS = [
  { value: "strict", label: "Строгий", description: "Коротко, по делу, без смайлов и шуток" },
  { value: "diplomatic", label: "Дипломатичный", description: "Вежливо, спокойно, без давления" },
  { value: "legal", label: "Юридический", description: "Формально, точные формулировки" },
  { value: "safe_flirt", label: "Галантный флирт", description: "Тёплый, галантный тон без пошлости" },
  { value: "friendly", label: "Дружелюбный", description: "Тепло, коротко, человечно" },
  { value: "sales", label: "Продажи", description: "Уверенно, с фокусом на конверсию" },
  { value: "support_calm", label: "Спокойная поддержка", description: "Деэскалация, эмпатия" },
  { value: "humor_irony", label: "Ирония", description: "Мягкий юмор и лёгкая ирония" },
  { value: "concierge_premium", label: "Премиум-консьерж", description: "Очень заботливо, VIP-сервис" },
  { value: "crisis_deescalation", label: "Антикризис", description: "Максимум спокойствия, минимум слов" },
];

const TOGGLE_LABELS: Record<string, { label: string; tooltip: string }> = {
  auto_reply_enabled: {
    label: "Автоответы",
    tooltip: "Олег автоматически отвечает на все входящие сообщения в личных чатах"
  },
  irony_enabled: {
    label: "Ирония и юмор",
    tooltip: "Разрешить боту использовать лёгкую иронию и шутки в ответах"
  },
  smalltalk_enabled: {
    label: "Светская беседа",
    tooltip: "Олег может поддерживать разговор на общие темы и помнит прошлые темы"
  },
  sales_enabled: {
    label: "Режим продаж",
    tooltip: "Олег может предлагать продукты, создавать ссылки на оплату и делать апсейл"
  },
  support_enabled: {
    label: "Режим поддержки",
    tooltip: "Олег отвечает на вопросы о подписках, доступе и продуктах"
  },
  faq_first_enabled: {
    label: "FAQ в приоритете",
    tooltip: "Сначала искать ответ в базе знаний, потом генерировать через AI"
  },
  quiet_hours_enabled: {
    label: "Тихие часы",
    tooltip: "Не отвечать в ночное время (22:00–08:00)"
  },
};

const SLIDER_LABELS: Record<string, { label: string; tooltip: string }> = {
  brevity_level: {
    label: "Краткость",
    tooltip: "0% — подробные развёрнутые ответы, 100% — максимально короткие и лаконичные"
  },
  warmth_level: {
    label: "Теплота",
    tooltip: "0% — сухой официальный тон, 100% — очень тёплый и дружелюбный"
  },
  formality_level: {
    label: "Формальность",
    tooltip: "0% — обращение на «ты», 100% — строго на «вы» с уважительным тоном"
  },
  sales_assertiveness: {
    label: "Напор продаж",
    tooltip: "0% — только информация по запросу, 100% — активное предложение купить"
  },
  humor_level: {
    label: "Уровень юмора",
    tooltip: "0% — без шуток, 100% — много иронии (если включена опция «Ирония и юмор»)"
  },
  risk_aversion: {
    label: "Осторожность",
    tooltip: "0% — Олег отвечает на всё сам, 100% — часто передаёт вопрос человеку"
  },
};

// ============ КАТЕГОРИИ ПАКЕТОВ ПРОМПТОВ ============

const CATEGORY_LABELS: Record<string, string> = {
  tone: "Стиль общения",
  support: "Поддержка",
  sales: "Продажи",
  policy: "Правила/политики",
  custom: "Пользовательский",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  tone: "Применяется ко всем ответам для формирования тона и стиля общения",
  support: "Используется при ответах на вопросы о подписках, доступе и помощи",
  sales: "Активируется в режиме продаж: предложения, апсейл, ссылки на оплату",
  policy: "Правила и ограничения, которые бот соблюдает всегда",
  custom: "Пользовательские правила для специфических ситуаций",
};

const TEMPLATE_LABELS: Record<string, { label: string; tooltip: string; placeholder: string }> = {
  greeting_template: {
    label: "Приветствие",
    tooltip: "Как Олег здоровается при первом сообщении пользователя",
    placeholder: "Привет! Я Олег. Чем могу помочь?"
  },
  followup_template: {
    label: "Возврат к теме",
    tooltip: "Как Олег спрашивает про прошлую тему разговора при повторном обращении",
    placeholder: "Как там ваша ситуация — получилось?"
  },
  escalation_template: {
    label: "Передача оператору",
    tooltip: "Что Олег пишет, когда передаёт вопрос живому человеку",
    placeholder: "Передаю ваш вопрос руководителю. Вернёмся с ответом."
  },
  fallback_template: {
    label: "Уточнение",
    tooltip: "Что Олег пишет, если не понял вопрос пользователя",
    placeholder: "Не совсем понял вопрос. Можете уточнить?"
  },
  sales_close_template: {
    label: "Закрытие продажи",
    tooltip: "Как Олег предлагает оплату после подбора подходящего продукта",
    placeholder: "Готово! Вот ссылка на оплату:"
  },
};

const DEFAULT_TOGGLES = {
  auto_reply_enabled: true,
  irony_enabled: false,
  smalltalk_enabled: true,
  sales_enabled: true,
  support_enabled: true,
  faq_first_enabled: false,
  quiet_hours_enabled: false,
};

const DEFAULT_SLIDERS = {
  brevity_level: 50,
  warmth_level: 70,
  formality_level: 50,
  sales_assertiveness: 30,
  humor_level: 20,
  risk_aversion: 60,
};

const DEFAULT_TEMPLATES = {
  greeting_template: "",
  followup_template: "",
  escalation_template: "",
  fallback_template: "",
  sales_close_template: "",
};

// ============ КОМПОНЕНТ ЛЕЙБЛА С ПОДСКАЗКОЙ ============

function LabelWithTooltip({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ============ ОСНОВНОЙ КОМПОНЕНТ ============

export function OlegSettingsSection() {
  const queryClient = useQueryClient();
  const [hasChanges, setHasChanges] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Local state for edits
  const [localPreset, setLocalPreset] = useState<string | null>(null);
  const [localToggles, setLocalToggles] = useState<Record<string, boolean>>({});
  const [localSliders, setLocalSliders] = useState<Record<string, number>>({});
  const [localTemplates, setLocalTemplates] = useState<Record<string, string>>({});
  const [localPackages, setLocalPackages] = useState<string[] | null>(null);
  
  // Bot identity state
  const [localBotEnabled, setLocalBotEnabled] = useState<boolean | null>(null);
  const [localBotName, setLocalBotName] = useState<string | null>(null);
  const [localBotPosition, setLocalBotPosition] = useState<string | null>(null);

  // File upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
const [analysisResult, setAnalysisResult] = useState<{
    suggestedName: string;
    suggestedCode: string;
    summary: string;
    exampleResponse: string;
    extractedRules: string[];
    processedContent: string;
    category: string;
  } | null>(null);
  const [newPackageName, setNewPackageName] = useState("");

  // Fetch first active bot
  const { data: bots = [], isLoading: loadingBots } = useQuery({
    queryKey: ["telegram-bots-for-ai"],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("list_operational_telegram_bots")
        .select("id, bot_name, bot_username, status")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activeBotId = bots[0]?.id;

  // Fetch settings
  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ["ai-bot-settings", activeBotId],
    queryFn: async () => {
      if (!activeBotId) return null;
      const { data, error } = await supabase
        .from("ai_bot_settings")
        .select("*")
        .eq("bot_id", activeBotId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!activeBotId,
  });

  // Fetch packages
  const { data: packages = [] } = useQuery({
    queryKey: ["ai-prompt-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_prompt_packages")
        .select("*")
        .order("category");
      if (error) throw error;
      return data || [];
    },
  });

  // Merge with defaults
  const dbToggles = (settings?.toggles || {}) as Record<string, boolean>;
  const dbSliders = (settings?.sliders || {}) as Record<string, number>;
  const dbTemplates = (settings?.templates || {}) as Record<string, string>;
  const dbPackages = settings?.active_prompt_packages || ["support_base", "tone_katerina"];
  
  const currentPreset = localPreset ?? settings?.style_preset ?? "friendly";
  const currentToggles = { ...DEFAULT_TOGGLES, ...dbToggles, ...localToggles };
  const currentSliders = { ...DEFAULT_SLIDERS, ...dbSliders, ...localSliders };
  const currentTemplates = { ...DEFAULT_TEMPLATES, ...dbTemplates, ...localTemplates };
  const currentPackages = localPackages ?? dbPackages;
  
  // Bot identity
  const currentBotEnabled = localBotEnabled ?? settings?.bot_enabled ?? false;
  const currentBotName = localBotName ?? settings?.bot_name ?? "Олег";
  const currentBotPosition = localBotPosition ?? settings?.bot_position ?? "AI-ассистент поддержки";

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBotId) throw new Error("Нет активного бота");
      const { error } = await supabase.from("ai_bot_settings").upsert({
        bot_id: activeBotId,
        bot_enabled: currentBotEnabled,
        bot_name: currentBotName,
        bot_position: currentBotPosition,
        style_preset: currentPreset,
        toggles: currentToggles,
        sliders: currentSliders,
        templates: currentTemplates,
        active_prompt_packages: currentPackages,
        updated_at: new Date().toISOString(),
      }, { onConflict: "bot_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-bot-settings"] });
      setHasChanges(false);
      setLocalPreset(null);
      setLocalToggles({});
      setLocalSliders({});
      setLocalTemplates({});
      setLocalPackages(null);
      setLocalBotEnabled(null);
      setLocalBotName(null);
      setLocalBotPosition(null);
      toast.success("Настройки сохранены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // File parsing function
  const parseFile = async (file: File): Promise<string> => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    switch (ext) {
      case 'txt':
      case 'md':
        return await file.text();
        
      case 'csv':
        const csvText = await file.text();
        const parsed = Papa.parse(csvText, { header: true });
        return (parsed.data as Record<string, unknown>[]).map(row => Object.values(row).join(' | ')).join('\n');
        
      case 'xlsx':
      case 'xls':
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        return XLSX.utils.sheet_to_csv(sheet);
        
      case 'docx':
        const docBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: docBuffer });
        return result.value;
        
      default:
        throw new Error(`Неподдерживаемый формат: ${ext}. Используйте TXT, CSV, XLSX, DOCX.`);
    }
  };

  // Analyze uploaded file
  const analyzeFile = async (file: File) => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    
    try {
      const content = await parseFile(file);
      
      if (!content.trim()) {
        throw new Error("Файл пустой или не содержит текста");
      }

      // Call edge function to analyze
      const { data, error } = await supabase.functions.invoke('telegram-ai-analyze-prompt', {
        body: {
          content,
          fileName: file.name,
          existingPackages: packages.map((p: any) => p.code),
        }
      });

      if (error) throw error;

      setAnalysisResult(data);
      setNewPackageName(data.suggestedName || "");
    } catch (err: any) {
      toast.error(`Ошибка анализа: ${err.message}`);
      setUploadedFile(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadedFile(file);
    await analyzeFile(file);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Handle drag and drop
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    
    setUploadedFile(file);
    await analyzeFile(file);
  };

  // Save new package
  const savePackageMutation = useMutation({
    mutationFn: async () => {
      if (!analysisResult || !newPackageName.trim()) {
        throw new Error("Заполните название пакета");
      }

      const code = analysisResult.suggestedCode || 
        newPackageName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

      const { error } = await supabase.from('ai_prompt_packages').insert({
        code,
        name: newPackageName.trim(),
        content: analysisResult.processedContent,
        category: analysisResult.category || 'custom',
        description: analysisResult.summary?.substring(0, 200),
        enabled: true,
      });
      
      if (error) throw error;
      return code;
    },
    onSuccess: (code) => {
      queryClient.invalidateQueries({ queryKey: ['ai-prompt-packages'] });
      
      // Add to active packages
      const newPkgs = [...currentPackages, code];
      setLocalPackages(newPkgs);
      setHasChanges(true);
      
      // Reset upload state
      setUploadedFile(null);
      setAnalysisResult(null);
      setNewPackageName("");
      
      toast.success('Пакет промптов сохранён и активирован');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cancel upload
  const cancelUpload = () => {
    setUploadedFile(null);
    setAnalysisResult(null);
    setNewPackageName("");
  };

  if (loadingBots) {
    return (
      <GlassCard className="p-6">
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      </GlassCard>
    );
  }

  if (!activeBotId) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">🤖 Олег — AI-бот</h2>
        </div>
        <p className="text-muted-foreground">Нет активных ботов. Создайте и активируйте Telegram-бота.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      {/* Header with master switch */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">🤖 {currentBotName} — {currentBotPosition}</h2>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={currentBotEnabled}
                    onCheckedChange={v => { setLocalBotEnabled(v); setHasChanges(true); }}
                  />
                  <Badge variant={currentBotEnabled ? "default" : "secondary"} className={cn(
                    "text-xs transition-colors",
                    currentBotEnabled ? "bg-primary/10 text-primary border-primary/20" : ""
                  )}>
                    {currentBotEnabled ? "В бою" : "Выключен"}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-sm">
                  {currentBotEnabled 
                    ? "Бот активен и автоматически отвечает на все входящие сообщения" 
                    : "Бот выключен и не отвечает на сообщения"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Сохранить
        </Button>
      </div>

      {loadingSettings ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <Accordion type="multiple" defaultValue={["identity", "toggles", "style"]} className="space-y-4">
          {/* Bot Identity */}
          <AccordionItem value="identity" className="border rounded-lg px-4">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4" />
                Имя и должность бота
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithTooltip 
                    label="Имя бота" 
                    tooltip="Имя, которым бот представляется пользователям. Используется в приветствии и подписи." 
                  />
                  <Input
                    value={currentBotName}
                    onChange={e => { setLocalBotName(e.target.value); setHasChanges(true); }}
                    placeholder="Олег"
                  />
                </div>
                <div className="space-y-2">
                  <LabelWithTooltip 
                    label="Должность" 
                    tooltip="Должность или роль бота. Отображается в заголовке и помогает пользователям понять, с кем они общаются." 
                  />
                  <Input
                    value={currentBotPosition}
                    onChange={e => { setLocalBotPosition(e.target.value); setHasChanges(true); }}
                    placeholder="AI-ассистент поддержки"
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Toggles */}
          <AccordionItem value="toggles" className="border rounded-lg px-4">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Глобальные настройки
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(TOGGLE_LABELS).map(([key, { label, tooltip }]) => (
                  <div key={key} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                    <LabelWithTooltip label={label} tooltip={tooltip} />
                    <Switch
                      checked={currentToggles[key]}
                      onCheckedChange={v => { setLocalToggles(p => ({ ...p, [key]: v })); setHasChanges(true); }}
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Style */}
          <AccordionItem value="style" className="border rounded-lg px-4">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4" />
                Стиль общения
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2 space-y-6">
              <div className="space-y-2">
                <LabelWithTooltip 
                  label="Пресет стиля" 
                  tooltip="Базовый стиль общения Олега. Влияет на тон, обращение и общую манеру ответов." 
                />
                <Select value={currentPreset} onValueChange={v => { setLocalPreset(v); setHasChanges(true); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        <div className="flex flex-col">
                          <span>{o.label}</span>
                          <span className="text-xs text-muted-foreground">{o.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid gap-6 sm:grid-cols-2">
                {Object.entries(SLIDER_LABELS).map(([key, { label, tooltip }]) => (
                  <div key={key} className="space-y-3">
                    <div className="flex justify-between items-center">
                      <LabelWithTooltip label={label} tooltip={tooltip} />
                      <span className="text-sm font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {currentSliders[key]}%
                      </span>
                    </div>
                    <Slider 
                      value={[currentSliders[key]]} 
                      onValueChange={([v]) => { setLocalSliders(p => ({ ...p, [key]: v })); setHasChanges(true); }} 
                      max={100} 
                      step={5}
                      className="cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Templates */}
          <AccordionItem value="templates" className="border rounded-lg px-4">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Шаблоны сообщений
                <Badge variant="outline" className="text-[10px] font-normal ml-1">опционально</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2 space-y-4">
              <p className="text-sm text-muted-foreground mb-4">
                Оставьте поля пустыми — Олег будет генерировать ответы через AI самостоятельно. 
                Заполните только если хотите использовать фиксированные фразы.
              </p>
              {Object.entries(TEMPLATE_LABELS).map(([key, { label, tooltip, placeholder }]) => (
                <div key={key} className="space-y-2">
                  <LabelWithTooltip label={label} tooltip={tooltip} />
                  <Textarea 
                    value={currentTemplates[key]} 
                    onChange={e => { setLocalTemplates(p => ({ ...p, [key]: e.target.value })); setHasChanges(true); }} 
                    rows={2}
                    placeholder={placeholder}
                    className="resize-none"
                  />
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>

          {/* Packages */}
          <AccordionItem value="packages" className="border rounded-lg px-4">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                Пакеты промптов
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2 space-y-4">
              {/* Existing packages */}
              <div className="space-y-2">
                {packages.map((pkg: any) => (
                  <div 
                    key={pkg.id} 
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-colors",
                      currentPackages.includes(pkg.code) 
                        ? "bg-primary/5 border-primary/20" 
                        : "bg-muted/30 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Switch 
                        checked={currentPackages.includes(pkg.code)} 
                        onCheckedChange={() => {
                          const newPkgs = currentPackages.includes(pkg.code) 
                            ? currentPackages.filter((c: string) => c !== pkg.code) 
                            : [...currentPackages, pkg.code];
                          setLocalPackages(newPkgs);
                          setHasChanges(true);
                        }} 
                      />
                      <div>
                        <p className="font-medium text-sm">{pkg.name}</p>
                        <p className="text-xs text-muted-foreground">{pkg.description}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">{pkg.category}</Badge>
                  </div>
                ))}
              </div>

              {/* File upload zone */}
              <div className="border-t pt-4 mt-4">
                <LabelWithTooltip 
                  label="Загрузить новый пакет промптов" 
                  tooltip="Загрузите файл с описанием стиля общения. AI проанализирует его и создаст новый пакет промптов." 
                />
                
                {!uploadedFile && !analysisResult && (
                  <div
                    className="mt-3 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                  >
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">Перетащите файл сюда или нажмите для выбора</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Поддерживаемые форматы: TXT, CSV, XLSX, DOCX
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.csv,.xlsx,.xls,.docx"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>
                )}

                {/* Analyzing state */}
                {isAnalyzing && (
                  <div className="mt-3 border rounded-lg p-6 text-center bg-muted/30">
                    <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary mb-2" />
                    <p className="text-sm font-medium">Анализирую содержимое файла...</p>
                    <p className="text-xs text-muted-foreground mt-1">AI извлекает правила и стиль общения</p>
                  </div>
                )}

                {/* Analysis result */}
                {analysisResult && !isAnalyzing && (
                  <div className="mt-3 border rounded-lg p-4 bg-muted/30 space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span className="font-medium">Анализ завершён</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={cancelUpload}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileText className="w-4 h-4" />
                      <span>{uploadedFile?.name}</span>
                    </div>

                    <div className="space-y-2">
                      <Label>Название пакета</Label>
                      <Input
                        value={newPackageName}
                        onChange={(e) => setNewPackageName(e.target.value)}
                        placeholder="Введите название пакета"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <Bot className="w-4 h-4" />
                        Что Олег понял из файла:
                      </Label>
                      <div className="bg-background rounded-lg p-3 text-sm border">
                        <p className="italic text-muted-foreground">{analysisResult.summary}</p>
                      </div>
                    </div>

                    {/* Извлечённые правила */}
                    {analysisResult.extractedRules && analysisResult.extractedRules.length > 0 && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5">
                          📋 Извлечённые правила:
                        </Label>
                        <ul className="bg-background rounded-lg p-3 text-sm border space-y-1">
                          {analysisResult.extractedRules.map((rule, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-primary mt-0.5">•</span>
                              <span>{rule}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Категория и когда применяется */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        🏷️ Категория:
                      </Label>
                      <div className="bg-background rounded-lg p-3 text-sm border">
                        <Badge variant="outline" className="mb-2">
                          {CATEGORY_LABELS[analysisResult.category] || analysisResult.category}
                        </Badge>
                        <p className="text-muted-foreground text-xs">
                          {CATEGORY_DESCRIPTIONS[analysisResult.category] || "Пользовательские правила"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Пример ответа в этом стиле:</Label>
                      <div className="bg-background rounded-lg p-3 text-sm border">
                        <p>"{analysisResult.exampleResponse}"</p>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button 
                        variant="outline" 
                        onClick={cancelUpload}
                        className="flex-1"
                      >
                        Отменить
                      </Button>
                      <Button 
                        onClick={() => savePackageMutation.mutate()}
                        disabled={!newPackageName.trim() || savePackageMutation.isPending}
                        className="flex-1"
                      >
                        {savePackageMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        Сохранить пакет
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </GlassCard>
  );
}
