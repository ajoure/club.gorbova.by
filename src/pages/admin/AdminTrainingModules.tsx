import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useTrainingModules, TrainingModule, TrainingModuleFormData } from "@/hooks/useTrainingModules";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthYearPicker } from "@/components/ui/month-year-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  Loader2,
  BookOpen,
  Eye,
  EyeOff,
  MoreVertical,
  Settings,
  Wand2,
  Users,
  CheckSquare,
  Power,
  PowerOff,
} from "lucide-react";
import TrainingModuleCard from "@/components/admin/trainings/TrainingModuleCard";
import { LessonViewersModal } from "@/components/admin/trainings/LessonViewersModal";
import { CopyMoveDialog } from "@/components/admin/trainings/CopyMoveDialog";
import TrainingSettingsPanel, { ViewDensity } from "@/components/admin/trainings/TrainingSettingsPanel";
import { ProductAccessInfoBlock } from "@/components/admin/trainings/ProductAccessInfoBlock";
import { TrainingUnlinkedBlock } from "@/components/admin/trainings/TrainingUnlinkedBlock";
import { ContentSectionSelector } from "@/components/admin/trainings/ContentSectionSelector";
import { DisplayLayoutSelector, DisplayLayout, normalizeLayout } from "@/components/admin/trainings/DisplayLayoutSelector";
import { ContentCreationWizard } from "@/components/admin/trainings/ContentCreationWizard";
import { ProgressTabContent } from "@/components/admin/trainings/ProgressTabContent";
import { ModulesTreeContent } from "@/components/admin/trainings/ModulesTreeContent";
import { BulkActivationModal } from "@/components/admin/trainings/BulkActivationModal";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { useBulkModuleActivation, type BulkAction, type SelectionMode } from "@/hooks/useModuleBulkActions";
import { toggleModuleSubtree, toggleLesson, type TreeIndexes } from "@/components/admin/trainings/moduleTreeIndexes";
import type { SortMode } from "@/components/admin/trainings/moduleTreeUtils";
import { cn } from "@/lib/utils";
import { Upload, Image as ImageIcon, ArrowDownAZ, ArrowDown01 } from "lucide-react";
import { toast } from "sonner";

const gradientOptions = [
  { value: "from-pink-500 to-fuchsia-600", label: "Розовый → Фуксия" },
  { value: "from-blue-500 to-cyan-500", label: "Синий → Голубой" },
  { value: "from-green-500 to-emerald-500", label: "Зелёный → Изумрудный" },
  { value: "from-orange-500 to-amber-500", label: "Оранжевый → Янтарный" },
  { value: "from-purple-500 to-violet-500", label: "Фиолетовый → Сиреневый" },
  { value: "from-red-500 to-rose-500", label: "Красный → Розовый" },
  { value: "from-indigo-500 to-purple-500", label: "Индиго → Фиолетовый" },
  { value: "from-teal-500 to-cyan-500", label: "Бирюзовый → Голубой" },
];

const generateSlug = (title: string) => {
  return title
    .toLowerCase()
    .replace(/[а-яё]/gi, (char) => {
      const ru = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
      const en = ["a","b","v","g","d","e","yo","zh","z","i","j","k","l","m","n","o","p","r","s","t","u","f","h","c","ch","sh","sch","","y","","e","yu","ya"];
      const idx = ru.indexOf(char.toLowerCase());
      return idx >= 0 ? en[idx] : char;
    })
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

// Form content component - MUST be outside main component to prevent focus loss
interface ModuleFormContentProps {
  formData: TrainingModuleFormData;
  setFormData: React.Dispatch<React.SetStateAction<TrainingModuleFormData>>;
  editingModule: TrainingModule | null;
}

function ModuleFormContent({ formData, setFormData, editingModule }: ModuleFormContentProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

  const handleGenerateCover = async () => {
    if (!formData.title) {
      toast.error("Введите название модуля для генерации обложки");
      return;
    }
    setGenerating(true);
    const toastId = toast.loading("Генерация обложки AI... (~15 сек)");
    try {
      const response = await supabase.functions.invoke("generate-cover", {
        body: { title: formData.title, description: formData.description, moduleId: editingModule?.id || "new" },
      });
      if (response.error) {
        toast.error(`Ошибка: ${response.error.message}`, { id: toastId });
        return;
      }
      if (response.data?.url) {
        setFormData((prev) => ({ ...prev, cover_image: response.data.url }));
        toast.success("Обложка сгенерирована!", { id: toastId });
      } else {
        toast.error("Не удалось получить URL обложки", { id: toastId });
      }
    } catch (error: any) {
      toast.error(`Ошибка: ${error.message}`, { id: toastId });
    } finally {
      setGenerating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите файл изображения");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Максимальный размер файла: 5MB");
      return;
    }

    try {
      setUploading(true);
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `training-covers/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("training-assets")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("training-assets")
        .getPublicUrl(filePath);

      setFormData((prev) => ({ ...prev, cover_image: urlData.publicUrl }));
      toast.success("Обложка загружена");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Ошибка загрузки файла");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title">Название *</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => {
              const newTitle = e.target.value;
              setFormData(prev => ({
                ...prev,
                title: newTitle,
                slug: editingModule ? prev.slug : generateSlug(newTitle),
              }));
            }}
            placeholder="База знаний"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Адрес страницы *</Label>
          <Input
            id="slug"
            value={formData.slug}
            onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
            placeholder="baza-znanij"
          />
          <p className="text-xs text-muted-foreground">
            URL: gorbova.club/training/<strong>{formData.slug || "..."}</strong>
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Описание</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Краткое описание модуля..."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>Обложка</Label>
        <div className="flex gap-2">
          <Input
            value={formData.cover_image || ""}
            onChange={(e) => setFormData(prev => ({ ...prev, cover_image: e.target.value }))}
            placeholder="https://... или загрузите файл"
            className="flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || generating}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleGenerateCover}
            disabled={uploading || generating || !formData.title}
            className="gap-2"
            title="Сгенерировать обложку с помощью AI"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">AI</span>
          </Button>
        </div>
        {formData.cover_image && (
          <div className="relative mt-2 h-20 w-32 rounded-lg overflow-hidden border">
            <img
              src={formData.cover_image}
              alt="Обложка"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="gradient">Цвет градиента</Label>
        <Select
          value={formData.color_gradient}
          onValueChange={(value) => setFormData(prev => ({ ...prev, color_gradient: value }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {gradientOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-4 rounded bg-gradient-to-r ${opt.value}`} />
                  {opt.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
        />
        <Label htmlFor="is_active">Активен</Label>
      </div>

      <div className="space-y-2 border-t pt-4">
        <Label>Месяц контента</Label>
        <MonthYearPicker
          value={formData.content_month ?? null}
          onChange={(value) => setFormData(prev => ({ ...prev, content_month: value }))}
          placeholder="Не задан"
        />
        <p className="text-[11px] text-muted-foreground">
          Используется правилом доступа «Совпадение месяца покупки».
        </p>
      </div>

      {/* Раздел меню */}
      <ContentSectionSelector
        value={formData.menu_section_key || "products-library"}
        onChange={(value) => setFormData(prev => ({ ...prev, menu_section_key: value }))}
      />

      {/* DisplayLayoutSelector removed from form — layout managed on page level via localStorage */}
    </div>
  );
}

// Product-Tariff access selector wrapper for form
interface ModuleAccessFormProps {
  formData: TrainingModuleFormData;
  setFormData: React.Dispatch<React.SetStateAction<TrainingModuleFormData>>;
  productsWithTariffs: Array<{
    id: string;
    name: string;
    tariffs: Array<{ id: string; name: string }>;
  }>;
}

function ModuleAccessForm({ formData, setFormData, productsWithTariffs, editingModule }: ModuleAccessFormProps & { editingModule?: TrainingModule | null }) {
  const effectiveProductId = editingModule?.product_id || formData.product_id;
  if (effectiveProductId) {
    return <ProductAccessInfoBlock productId={effectiveProductId} moduleId={editingModule?.id} />;
  }

  return <TrainingUnlinkedBlock moduleId={editingModule?.id} />;
}

export default function AdminTrainingModules() {
  const navigate = useNavigate();
  const { modules, loading, refetch, createModule, updateModule, deleteModule } = useTrainingModules();
  const [editingModule, setEditingModule] = useState<TrainingModule | null>(null);
  const [inheritContentMonth, setInheritContentMonth] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [copyMoveTarget, setCopyMoveTarget] = useState<{
    id: string;
    title: string;
    sectionKey: string;
  } | null>(null);
  // Lesson viewers modal state (opened from tree hover action)
  const [viewerModal, setViewerModal] = useState<{ lessonId: string; title: string } | null>(null);

  // PATCH K: Bulk selection state (dual: modules + lessons)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string>>(new Set());
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkAction>("activate");
  const [bulkSelectionMode, setBulkSelectionMode] = useState<SelectionMode>("cascade");
  const { execute: executeBulk, loading: bulkExecuting } = useBulkModuleActivation();
  // Keep a ref to tree indexes for select-all
  const [lastTreeIndexes, setLastTreeIndexes] = useState<TreeIndexes | null>(null);

  const handleToggleModuleSelection = useCallback((moduleId: string, indexes: TreeIndexes) => {
    setLastTreeIndexes(indexes);
    const { nextModuleIds, nextLessonIds } = toggleModuleSubtree(
      moduleId, indexes, selectedModuleIds, selectedLessonIds,
    );
    setSelectedModuleIds(nextModuleIds);
    setSelectedLessonIds(nextLessonIds);
  }, [selectedModuleIds, selectedLessonIds]);

  const handleToggleLessonSelection = useCallback((lessonId: string) => {
    setSelectedLessonIds((prev) => toggleLesson(lessonId, prev));
  }, []);

  const handleSelectAll = useCallback(() => {
    if (lastTreeIndexes) {
      setSelectedModuleIds(new Set(lastTreeIndexes.allModuleIds));
      setSelectedLessonIds(new Set(lastTreeIndexes.allLessonIds));
    } else {
      setSelectedModuleIds(new Set(modules.map((m) => m.id)));
    }
  }, [modules, lastTreeIndexes]);

  const handleClearSelection = useCallback(() => {
    setSelectedModuleIds(new Set());
    setSelectedLessonIds(new Set());
    setSelectionMode(false);
  }, []);

  const openBulkModal = useCallback((action: BulkAction, mode: SelectionMode) => {
    setBulkAction(action);
    setBulkSelectionMode(mode);
    setBulkModalOpen(true);
  }, []);

  const handleBulkConfirm = useCallback(async () => {
    const success = await executeBulk(
      Array.from(selectedModuleIds),
      Array.from(selectedLessonIds),
      bulkAction,
      bulkSelectionMode,
    );
    if (success) {
      setBulkModalOpen(false);
      handleClearSelection();
      refetch();
    }
  }, [executeBulk, selectedModuleIds, selectedLessonIds, bulkAction, bulkSelectionMode, handleClearSelection, refetch]);
  
  // E1/E2/E3: View settings with localStorage persistence
  const [density, setDensity] = useState<ViewDensity>(() => {
    return (localStorage.getItem('training_modules_density') as ViewDensity) || 'comfortable';
  });
  const [showAdvanced, setShowAdvanced] = useState(() => {
    return localStorage.getItem('training_modules_advanced') === 'true';
  });
  // Layout selector — localStorage only, NO DB writes
  const [displayLayout, setDisplayLayout] = useState<DisplayLayout>(() => {
    return normalizeLayout(localStorage.getItem('training_modules_layout'));
  });
  // Sort mode for list view
  const [modulesSortMode, setModulesSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem("admin_training_modules.sortMode");
    return (saved === "alpha" ? "alpha" : "order") as SortMode;
  });
  
  const handleDensityChange = (d: ViewDensity) => {
    setDensity(d);
    localStorage.setItem('training_modules_density', d);
  };
  
  const handleShowAdvancedChange = (show: boolean) => {
    setShowAdvanced(show);
    localStorage.setItem('training_modules_advanced', String(show));
  };

  const handleLayoutChange = (layout: DisplayLayout) => {
    setDisplayLayout(layout);
    localStorage.setItem('training_modules_layout', layout);
  };

  const handleModulesSortToggle = useCallback(() => {
    setModulesSortMode((prev) => {
      const next = prev === "order" ? "alpha" : "order";
      localStorage.setItem("admin_training_modules.sortMode", next);
      return next as SortMode;
    });
  }, []);
  
  const [formData, setFormData] = useState<TrainingModuleFormData>({
    title: "",
    slug: "",
    description: "",
    color_gradient: "from-pink-500 to-fuchsia-600",
    is_active: true,
    tariff_ids: [],
    menu_section_key: "products",
    display_layout: "grid",
    content_month: null,
  });

  // Fetch products with tariffs for access selector
  const { data: productsWithTariffs } = useQuery({
    queryKey: ["products-with-tariffs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, tariffs(id, name, is_active)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      // Filter only active tariffs and format for selector
      return data?.map(p => ({
        id: p.id,
        name: p.name,
        tariffs: (p.tariffs as any[])?.filter(t => t.is_active).map(t => ({
          id: t.id,
          name: t.name,
        })) || [],
      })) || [];
    },
  });

  // Fetch module access when editing
  const { data: moduleAccess } = useQuery({
    queryKey: ["module-access", editingModule?.id],
    queryFn: async () => {
      if (!editingModule?.id) return [];
      const { data, error } = await supabase
        .from("module_access")
        .select("tariff_id")
        .eq("module_id", editingModule.id);
      if (error) throw error;
      return data.map(a => a.tariff_id);
    },
    enabled: !!editingModule?.id,
  });

  const resetForm = useCallback(() => {
    setFormData({
      title: "",
      slug: "",
      description: "",
      color_gradient: "from-pink-500 to-fuchsia-600",
      is_active: true,
      tariff_ids: [],
      menu_section_key: "products",
      display_layout: "grid",
      content_month: null,
    });
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setIsCreateDialogOpen(true);
  }, [resetForm]);

  const openEditDialog = useCallback((module: TrainingModule) => {
    setEditingModule(module);
    setInheritContentMonth(true);
    setFormData({
      title: module.title,
      slug: module.slug,
      description: module.description || "",
      cover_image: module.cover_image || "",
      color_gradient: module.color_gradient || "from-pink-500 to-fuchsia-600",
      is_active: module.is_active,
      tariff_ids: [],
      menu_section_key: module.menu_section_key || "products",
      display_layout: module.display_layout || "grid",
      content_month: (module as any).content_month ?? null,
    });
  }, []);

  // Sync tariff_ids when moduleAccess loads for the editing module
  useEffect(() => {
    if (moduleAccess && editingModule) {
      setFormData(prev => ({ ...prev, tariff_ids: moduleAccess }));
    }
  }, [moduleAccess, editingModule?.id]);

  const handleCreate = async () => {
    if (!formData.title || !formData.slug) return;
    
    const success = await createModule(formData);
    if (success) {
      setIsCreateDialogOpen(false);
      resetForm();
    }
  };

  const handleUpdate = async () => {
    if (!editingModule || !formData.title || !formData.slug) return;
    
    const success = await updateModule(editingModule.id, formData);
    if (success) {
      if (inheritContentMonth) {
        const { error } = await supabase
          .from("training_lessons")
          .update({ content_month: formData.content_month ?? null })
          .eq("module_id", editingModule.id);

        if (error) {
          toast.error("Модуль сохранён, но месяц не применился к урокам");
          return;
        }
      }
      setEditingModule(null);
      resetForm();
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    
    const success = await deleteModule(deleteConfirmId);
    if (success) {
      setDeleteConfirmId(null);
    }
  };

  // Active tab state — scoped localStorage key
  const [activeTab, setActiveTab] = useState<"modules" | "progress" | "settings">(() => {
    const saved = localStorage.getItem("admin_training_modules.activeTab");
    if (saved === "modules" || saved === "progress" || saved === "settings") return saved as any;
    return "modules";
  });

  const handleTabChange = useCallback((tab: "modules" | "progress" | "settings") => {
    setActiveTab(tab);
    localStorage.setItem("admin_training_modules.activeTab", tab);
  }, []);

  return (
    <AdminLayout>
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        {/* Glassy Tabs Bar */}
        <div className="px-3 md:px-4 pt-2 pb-2 shrink-0 flex items-center justify-between gap-2">
          {/* Tabs - horizontal scroll, no wrap */}
          <div className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none whitespace-nowrap">
            <button
              onClick={() => handleTabChange("modules")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200",
                activeTab === "modules"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Модули</span>
            </button>
            <button
              onClick={() => handleTabChange("progress")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200",
                activeTab === "progress"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Прогресс</span>
            </button>
            <button
              onClick={() => handleTabChange("settings")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200",
                activeTab === "settings"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Настройки</span>
            </button>
          </div>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2">
            {activeTab === "modules" && (
              <>
                {displayLayout === "list" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleModulesSortToggle}
                    className="gap-1.5 text-xs h-8 rounded-full"
                  >
                    {modulesSortMode === "alpha" ? (
                      <><ArrowDownAZ className="h-3.5 w-3.5" /> А-Я</>
                    ) : (
                      <><ArrowDown01 className="h-3.5 w-3.5" /> №</>
                    )}
                  </Button>
                )}
                <div className="inline-flex p-0.5 rounded-full bg-muted/40 border border-border/20">
                  <DisplayLayoutSelector
                    value={displayLayout}
                    onChange={handleLayoutChange}
                  />
                </div>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-background/95 backdrop-blur-xl border-border/50">
                {activeTab === "modules" && displayLayout === "list" && (
                  <>
                    <DropdownMenuItem onClick={() => {
                      setSelectionMode((p) => !p);
                      if (selectionMode) { setSelectedModuleIds(new Set()); setSelectedLessonIds(new Set()); }
                    }}>
                      <CheckSquare className="h-4 w-4 mr-2" />
                      {selectionMode ? "Отключить выделение" : "Режим выделения"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => navigate("/admin/kb-import")}>
                  <Upload className="h-4 w-4 mr-2" />
                  Импорт КБ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => setIsWizardOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Мастер
            </button>
          </div>

          {/* Mobile actions */}
          <div className="md:hidden flex items-center gap-1">
            {activeTab === "modules" && (
              <div className="inline-flex p-0.5 rounded-full bg-muted/40 border border-border/20">
                <DisplayLayoutSelector
                  value={displayLayout}
                  onChange={handleLayoutChange}
                />
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-9 w-9">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-background/95 backdrop-blur-xl border-border/50">
                <DropdownMenuItem onClick={() => setIsWizardOpen(true)}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Мастер добавления
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/admin/kb-import")}>
                  <Upload className="h-4 w-4 mr-2" />
                  Импорт КБ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-3 md:px-4 pb-4">
          {activeTab === "settings" ? (
            <TrainingSettingsPanel
              density={density}
              onDensityChange={handleDensityChange}
              showAdvanced={showAdvanced}
              onShowAdvancedChange={handleShowAdvancedChange}
            />
          ) : activeTab === "progress" ? (
            <ProgressTabContent modules={modules} />
          ) : (
            <>
              {/* Modules List */}
              {loading ? (
                <div className={cn(
                  "grid gap-3",
                  displayLayout === 'list'
                    ? "grid-cols-1"
                    : density === 'compact' ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
                )}>
                  {[1, 2, 3].map(i => (
                    <div key={i} className="rounded-2xl backdrop-blur-xl bg-card/60 border border-border/50 p-5">
                      <Skeleton className="h-5 w-32 mb-3" />
                      <Skeleton className="h-4 w-48 mb-2" />
                      <Skeleton className="h-8 w-24" />
                    </div>
                  ))}
                </div>
              ) : modules.length === 0 ? (
                <div className="relative overflow-hidden rounded-2xl backdrop-blur-xl bg-card/60 dark:bg-card/40 border border-border/50 shadow-lg p-12 text-center">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                  <div className="relative">
                    <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-xl font-semibold mb-2">Модули не созданы</h3>
                    <p className="text-muted-foreground mb-4">
                      Создайте первый модуль базы знаний
                    </p>
                    <Button onClick={() => setIsWizardOpen(true)}>
                      <Wand2 className="mr-2 h-4 w-4" />
                      Создать модуль
                    </Button>
                  </div>
                </div>
              ) : displayLayout === "list" ? (
                <ModulesTreeContent
                  modules={modules}
                  onEdit={(m) => openEditDialog(m)}
                  onDelete={(id) => setDeleteConfirmId(id)}
                  onOpenLessons={(moduleId) => navigate(`/admin/training-modules/${moduleId}/lessons`)}
                  onCopyMove={(m) => setCopyMoveTarget({
                    id: m.id,
                    title: m.title,
                    sectionKey: m.menu_section_key || "products",
                  })}
                  onOpenLessonViewers={(lesson) => {
                    setViewerModal({ lessonId: lesson.id, title: lesson.title });
                  }}
                  sortMode={modulesSortMode}
                  selectionMode={selectionMode}
                  selectedModuleIds={selectedModuleIds}
                  selectedLessonIds={selectedLessonIds}
                  onToggleModuleSelection={handleToggleModuleSelection}
                  onToggleLessonSelection={handleToggleLessonSelection}
                />
              ) : (
                <div className={cn(
                  "grid gap-3",
                  density === 'compact' ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
                )}>
                  {modules.filter((m) => !m.parent_module_id).map((module) => (
                    <TrainingModuleCard
                      key={module.id}
                      module={module}
                      onEdit={() => openEditDialog(module)}
                      onDelete={() => setDeleteConfirmId(module.id)}
                      onOpenLessons={() => navigate(`/admin/training-modules/${module.id}/lessons`)}
                      onCopyMove={() => setCopyMoveTarget({
                        id: module.id,
                        title: module.title,
                        sectionKey: module.menu_section_key || "products",
                      })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Create Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle>Новый модуль</DialogTitle>
              <DialogDescription>
                Создайте новый раздел базы знаний
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4 py-2">
              <ModuleFormContent 
                formData={formData}
                setFormData={setFormData}
                editingModule={null}
              />
              <ModuleAccessForm
                formData={formData}
                setFormData={setFormData}
                productsWithTariffs={productsWithTariffs || []}
              />
            </div>
            <DialogFooter className="shrink-0 border-t pt-4 pb-[env(safe-area-inset-bottom)]">
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Отмена
              </Button>
              <Button onClick={handleCreate} disabled={!formData.title || !formData.slug}>
                Создать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editingModule} onOpenChange={(open) => !open && setEditingModule(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle>Редактирование модуля</DialogTitle>
              <DialogDescription>
                Измените параметры модуля
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4 py-2">
              <ModuleFormContent 
                formData={formData}
                setFormData={setFormData}
                editingModule={editingModule}
              />
              <div className="flex items-start gap-2 rounded-md border border-border p-3">
                <Switch
                  id="inherit-content-month"
                  checked={inheritContentMonth}
                  onCheckedChange={setInheritContentMonth}
                />
                <div className="space-y-1">
                  <Label htmlFor="inherit-content-month">Применить этот месяц ко всем урокам внутри модуля</Label>
                  <p className="text-[11px] text-muted-foreground">
                    При сохранении уроки получат тот же месяц; при очистке месяца он очистится и у уроков.
                  </p>
                </div>
              </div>
              <ModuleAccessForm
                formData={formData}
                setFormData={setFormData}
                productsWithTariffs={productsWithTariffs || []}
                editingModule={editingModule}
              />
            </div>
            <DialogFooter className="shrink-0 border-t pt-4 pb-[env(safe-area-inset-bottom)]">
              <Button variant="outline" onClick={() => setEditingModule(null)}>
                Отмена
              </Button>
              <Button onClick={handleUpdate} disabled={!formData.title || !formData.slug}>
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm Dialog */}
        <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить модуль?</AlertDialogTitle>
              <AlertDialogDescription>
                Модуль и все его уроки будут удалены безвозвратно.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Content Creation Wizard */}
        <ContentCreationWizard
          open={isWizardOpen}
          onOpenChange={setIsWizardOpen}
          onComplete={() => refetch()}
        />

        {/* Copy/Move Dialog */}
        {copyMoveTarget && (
          <CopyMoveDialog
            open={!!copyMoveTarget}
            onOpenChange={(open) => !open && setCopyMoveTarget(null)}
            sourceType="module"
            sourceId={copyMoveTarget.id}
            sourceTitle={copyMoveTarget.title}
            currentSectionKey={copyMoveTarget.sectionKey}
            onSuccess={() => refetch()}
          />
        )}
        {/* Lesson Viewers Modal (from tree hover) */}
        {viewerModal && (
          <LessonViewersModal
            lessonId={viewerModal.lessonId}
            lessonTitle={viewerModal.title}
            open={true}
            onOpenChange={(open) => {
              if (!open) setViewerModal(null);
            }}
          />
        )}

        {/* PATCH K: Bulk Actions Bar */}
        {selectionMode && (selectedModuleIds.size > 0 || selectedLessonIds.size > 0) && (
          <BulkActionsBar
            selectedCount={selectedModuleIds.size + selectedLessonIds.size}
            onClearSelection={handleClearSelection}
            onSelectAll={handleSelectAll}
            totalCount={modules.length}
            entityName={`${selectedModuleIds.size} мод. / ${selectedLessonIds.size} ур.`}
            onBulkEdit={() => openBulkModal("activate", "exact")}
            onBulkArchive={() => openBulkModal("deactivate", "exact")}
          />
        )}

        {/* PATCH K: Bulk activation floating actions */}
        {selectionMode && (selectedModuleIds.size > 0 || selectedLessonIds.size > 0) && !bulkModalOpen && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40">
            <div className="bg-background border rounded-xl shadow-lg px-3 py-2 flex items-center gap-2 flex-wrap justify-center">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => openBulkModal("activate", "exact")}>
                <Power className="h-3.5 w-3.5" />
                Активировать выбранное
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => openBulkModal("deactivate", "exact")}>
                <PowerOff className="h-3.5 w-3.5" />
                Деактивировать выбранное
              </Button>
              <div className="h-5 w-px bg-border" />
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => openBulkModal("activate", "cascade")}>
                <Power className="h-3.5 w-3.5" />
                Каскадная активация
              </Button>
              <Button size="sm" variant="destructive" className="gap-1.5 text-xs" onClick={() => openBulkModal("deactivate", "cascade")}>
                <PowerOff className="h-3.5 w-3.5" />
                Каскадная деактивация
              </Button>
            </div>
          </div>
        )}

        {/* PATCH K: Bulk Activation Modal */}
        <BulkActivationModal
          open={bulkModalOpen}
          onOpenChange={setBulkModalOpen}
          selectedModuleIds={Array.from(selectedModuleIds)}
          selectedLessonIds={Array.from(selectedLessonIds)}
          action={bulkAction}
          selectionMode={bulkSelectionMode}
          onConfirm={handleBulkConfirm}
          executing={bulkExecuting}
        />
      </div>
    </AdminLayout>
  );
}