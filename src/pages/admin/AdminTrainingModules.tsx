import { useState, useCallback } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Pencil,
  Trash2,
  BookOpen,
  Eye,
  EyeOff,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { GetCourseContentImportDialog } from "@/components/admin/GetCourseContentImportDialog";
import { ExcelTrainingImportDialog } from "@/components/admin/ExcelTrainingImportDialog";
import TrainingModuleCard from "@/components/admin/trainings/TrainingModuleCard";
import TrainingSettingsPanel, { ViewDensity } from "@/components/admin/trainings/TrainingSettingsPanel";
import { cn } from "@/lib/utils";

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
  tariffs: any[] | undefined;
  handleTariffToggle: (tariffId: string) => void;
}

function ModuleFormContent({ formData, setFormData, editingModule, tariffs, handleTariffToggle }: ModuleFormContentProps) {
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
          <Label htmlFor="slug">URL-slug *</Label>
          <Input
            id="slug"
            value={formData.slug}
            onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
            placeholder="baza-znanij"
          />
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
        <Label htmlFor="cover_image">URL обложки</Label>
        <Input
          id="cover_image"
          value={formData.cover_image || ""}
          onChange={(e) => setFormData(prev => ({ ...prev, cover_image: e.target.value }))}
          placeholder="https://..."
        />
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

      <div className="space-y-2">
        <Label>Доступ по тарифам</Label>
        <p className="text-sm text-muted-foreground mb-2">
          Если не выбран ни один тариф, модуль будет доступен всем
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {tariffs?.map(tariff => (
            <div key={tariff.id} className="flex items-center space-x-2">
              <Checkbox
                id={`tariff-${tariff.id}`}
                checked={formData.tariff_ids?.includes(tariff.id)}
                onCheckedChange={() => handleTariffToggle(tariff.id)}
              />
              <label
                htmlFor={`tariff-${tariff.id}`}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {tariff.name}
                <span className="text-muted-foreground ml-1">
                  ({(tariff.products_v2 as any)?.name})
                </span>
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
        />
        <Label htmlFor="is_active">Активен</Label>
      </div>
    </div>
  );
}

export default function AdminTrainingModules() {
  const navigate = useNavigate();
  const { modules, loading, refetch, createModule, updateModule, deleteModule } = useTrainingModules();
  const [editingModule, setEditingModule] = useState<TrainingModule | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
  // E1/E2/E3: View settings with localStorage persistence
  const [density, setDensity] = useState<ViewDensity>(() => {
    return (localStorage.getItem('training_modules_density') as ViewDensity) || 'comfortable';
  });
  const [showAdvanced, setShowAdvanced] = useState(() => {
    return localStorage.getItem('training_modules_advanced') === 'true';
  });
  
  const handleDensityChange = (d: ViewDensity) => {
    setDensity(d);
    localStorage.setItem('training_modules_density', d);
  };
  
  const handleShowAdvancedChange = (show: boolean) => {
    setShowAdvanced(show);
    localStorage.setItem('training_modules_advanced', String(show));
  };
  
  const [formData, setFormData] = useState<TrainingModuleFormData>({
    title: "",
    slug: "",
    description: "",
    color_gradient: "from-pink-500 to-fuchsia-600",
    is_active: true,
    tariff_ids: [],
  });

  // Fetch tariffs for access control
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tariffs")
        .select("id, name, product_id, products_v2(name)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
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
    });
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setIsCreateDialogOpen(true);
  }, [resetForm]);

  const openEditDialog = useCallback((module: TrainingModule) => {
    setEditingModule(module);
    setFormData({
      title: module.title,
      slug: module.slug,
      description: module.description || "",
      cover_image: module.cover_image || "",
      color_gradient: module.color_gradient || "from-pink-500 to-fuchsia-600",
      is_active: module.is_active,
      tariff_ids: [],
    });
  }, []);

  // Update tariff_ids when moduleAccess loads
  if (moduleAccess && editingModule && formData.tariff_ids?.length === 0 && moduleAccess.length > 0) {
    setFormData(prev => ({ ...prev, tariff_ids: moduleAccess }));
  }

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

  const handleTariffToggle = useCallback((tariffId: string) => {
    setFormData(prev => ({
      ...prev,
      tariff_ids: prev.tariff_ids?.includes(tariffId)
        ? prev.tariff_ids.filter(id => id !== tariffId)
        : [...(prev.tariff_ids || []), tariffId],
    }));
  }, []);

  return (
    <AdminLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">База знаний</h1>
            <p className="text-muted-foreground">Управление модулями и уроками</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsExcelImportOpen(true)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Импорт из Excel
            </Button>
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
              <Download className="mr-2 h-4 w-4" />
              Импорт из GetCourse
            </Button>
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить модуль
            </Button>
          </div>
        </div>
        
        {/* Settings Panel - E1/E2/E3 */}
        <TrainingSettingsPanel
          density={density}
          onDensityChange={handleDensityChange}
          showAdvanced={showAdvanced}
          onShowAdvancedChange={handleShowAdvancedChange}
        />

        {/* Modules List - iOS Glass Style */}
        {loading ? (
          <div className={cn(
            "grid gap-4 mt-6",
            density === 'compact' ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
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
          <div className="mt-6 relative overflow-hidden rounded-2xl backdrop-blur-xl bg-card/60 dark:bg-card/40 border border-border/50 shadow-lg p-12 text-center">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="relative">
              <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Модули не созданы</h3>
              <p className="text-muted-foreground mb-4">
                Создайте первый модуль базы знаний
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Создать модуль
              </Button>
            </div>
          </div>
        ) : (
          <div className={cn(
            "grid gap-4 mt-6",
            density === 'compact' ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
          )}>
            {modules.map((module) => (
              <TrainingModuleCard
                key={module.id}
                module={module}
                onEdit={() => openEditDialog(module)}
                onDelete={() => setDeleteConfirmId(module.id)}
                onOpenLessons={() => navigate(`/admin/training-modules/${module.id}/lessons`)}
              />
            ))}
          </div>
        )}

        {/* Create Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Новый модуль</DialogTitle>
              <DialogDescription>
                Создайте новый раздел базы знаний
              </DialogDescription>
            </DialogHeader>
            <ModuleFormContent 
              formData={formData}
              setFormData={setFormData}
              editingModule={null}
              tariffs={tariffs}
              handleTariffToggle={handleTariffToggle}
            />
            <DialogFooter>
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
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Редактирование модуля</DialogTitle>
              <DialogDescription>
                Измените параметры модуля
              </DialogDescription>
            </DialogHeader>
            <ModuleFormContent 
              formData={formData}
              setFormData={setFormData}
              editingModule={editingModule}
              tariffs={tariffs}
              handleTariffToggle={handleTariffToggle}
            />
            <DialogFooter>
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

        {/* Import Dialogs */}
        <GetCourseContentImportDialog
          open={isImportDialogOpen}
          onOpenChange={setIsImportDialogOpen}
          onImportComplete={refetch}
        />
        <ExcelTrainingImportDialog
          open={isExcelImportOpen}
          onOpenChange={setIsExcelImportOpen}
        />
      </div>
    </AdminLayout>
  );
}