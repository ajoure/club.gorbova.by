import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Wand2, BookOpen, FileText, Settings, CheckCircle2, ArrowLeft, ArrowRight, SkipForward, ExternalLink, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { WizardStepIndicator } from "./WizardStepIndicator";
import { ContentSectionSelector } from "./ContentSectionSelector";
import { ModuleFormFields, ModuleFormData, generateSlug } from "./ModuleFormFields";
import { LessonFormFieldsSimple, LessonFormDataSimple, generateLessonSlug } from "./LessonFormFieldsSimple";
import { CompactAccessSelector } from "./CompactAccessSelector";
import { cn } from "@/lib/utils";

interface ContentCreationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (result: { moduleId: string; lessonId?: string }) => void;
  initialSectionKey?: string;
}

interface WizardData {
  menuSectionKey: string;
  module: ModuleFormData;
  lesson: LessonFormDataSimple;
  tariffIds: string[];
}

const STEPS = [
  { label: "Раздел", shortLabel: "1" },
  { label: "Модуль", shortLabel: "2" },
  { label: "Урок", shortLabel: "3" },
  { label: "Доступ", shortLabel: "4" },
  { label: "Готово", shortLabel: "✓" },
];

const STEP_HINTS = [
  "Выберите, где будет отображаться ваш контент в меню пользователя",
  "Создайте папку для группировки уроков — это карточка модуля",
  "Добавьте первый урок. Контент урока редактируется после создания в редакторе блоков",
  "Настройте, кто увидит контент. Пустой выбор = доступно всем",
  "Отлично! Контент создан и готов к редактированию",
];

// Check if slug exists in database
const checkSlugExists = async (slug: string): Promise<boolean> => {
  const { data } = await supabase
    .from("training_modules")
    .select("id")
    .eq("slug", slug)
    .limit(1);
  return !!(data && data.length > 0);
};

// Generate unique slug with suffix if needed
const ensureUniqueSlug = async (baseSlug: string): Promise<string> => {
  let slug = baseSlug;
  let suffix = 2;
  
  while (await checkSlugExists(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  
  return slug;
};

export function ContentCreationWizard({
  open,
  onOpenChange,
  onComplete,
  initialSectionKey,
}: ContentCreationWizardProps) {
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [createdModuleId, setCreatedModuleId] = useState<string | null>(null);
  const [createdLessonId, setCreatedLessonId] = useState<string | null>(null);
  const [slugWarning, setSlugWarning] = useState<string | null>(null);

  const [wizardData, setWizardData] = useState<WizardData>({
    menuSectionKey: initialSectionKey || "products-library",
    module: {
      title: "",
      slug: "",
      description: "",
      color_gradient: "from-pink-500 to-fuchsia-600",
      is_active: true,
      menu_section_key: initialSectionKey || "products-library",
      display_layout: "grid",
    },
    lesson: {
      title: "",
      slug: "",
      description: "",
    },
    tariffIds: [],
  });

  // Fetch products with tariffs
  const { data: productsWithTariffs } = useQuery({
    queryKey: ["products-with-tariffs-wizard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, tariffs(id, name, is_active)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data?.map((p) => ({
        id: p.id,
        name: p.name,
        tariffs:
          (p.tariffs as any[])
            ?.filter((t) => t.is_active)
            .map((t) => ({ id: t.id, name: t.name })) || [],
      })) || [];
    },
    enabled: open,
  });

  // Reset wizard when closed
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setStep(0);
        setCreatedModuleId(null);
        setCreatedLessonId(null);
        setSlugWarning(null);
        setWizardData({
          menuSectionKey: initialSectionKey || "products-library",
          module: {
            title: "",
            slug: "",
            description: "",
            color_gradient: "from-pink-500 to-fuchsia-600",
            is_active: true,
            menu_section_key: initialSectionKey || "products-library",
            display_layout: "grid",
          },
          lesson: {
            title: "",
            slug: "",
            description: "",
          },
          tariffIds: [],
        });
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, initialSectionKey]
  );

  // Validation
  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return !!wizardData.menuSectionKey;
      case 1:
        return !!wizardData.module.title && !!wizardData.module.slug;
      case 2:
        return true; // Optional step
      case 3:
        return true; // No validation needed
      case 4:
        return true;
      default:
        return false;
    }
  }, [step, wizardData]);

  // Update section in module data
  const handleSectionChange = (key: string) => {
    setWizardData((prev) => ({
      ...prev,
      menuSectionKey: key,
      module: { ...prev.module, menu_section_key: key },
    }));
  };

  // Handle module form changes
  const handleModuleChange = (data: ModuleFormData) => {
    setSlugWarning(null);
    setWizardData((prev) => ({
      ...prev,
      module: { ...data, menu_section_key: prev.menuSectionKey },
    }));
  };

  // Handle lesson form changes
  const handleLessonChange = (data: LessonFormDataSimple) => {
    setWizardData((prev) => ({ ...prev, lesson: data }));
  };

  // Create module (step 1 -> 2)
  const handleCreateModule = async () => {
    setIsCreating(true);
    setSlugWarning(null);
    
    try {
      // Check and ensure unique slug
      const originalSlug = wizardData.module.slug;
      const uniqueSlug = await ensureUniqueSlug(originalSlug);
      
      if (uniqueSlug !== originalSlug) {
        setSlugWarning(`Slug "${originalSlug}" уже занят. Использован "${uniqueSlug}"`);
      }

      const { data: newModule, error } = await supabase
        .from("training_modules")
        .insert({
          title: wizardData.module.title,
          slug: uniqueSlug,
          description: wizardData.module.description || null,
          cover_image: wizardData.module.cover_image || null,
          color_gradient: wizardData.module.color_gradient || "from-pink-500 to-fuchsia-600",
          is_active: wizardData.module.is_active !== false,
          menu_section_key: wizardData.menuSectionKey,
          display_layout: wizardData.module.display_layout || "grid",
        })
        .select()
        .single();

      if (error) throw error;

      // Update local slug if changed
      setWizardData(prev => ({
        ...prev,
        module: { ...prev.module, slug: uniqueSlug }
      }));
      
      setCreatedModuleId(newModule.id);
      toast.success("Модуль создан");
      setStep(2);
    } catch (error: any) {
      console.error("Error creating module:", error);
      toast.error(`Ошибка создания модуля: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Create lesson (step 2 -> 3) or skip
  const handleCreateLesson = async (skip = false) => {
    if (skip || !wizardData.lesson.title) {
      setStep(3);
      return;
    }

    if (!createdModuleId) {
      toast.error("Модуль не создан");
      return;
    }

    setIsCreating(true);
    try {
      const { data: newLesson, error } = await supabase
        .from("training_lessons")
        .insert({
          module_id: createdModuleId,
          title: wizardData.lesson.title,
          slug: wizardData.lesson.slug || generateLessonSlug(wizardData.lesson.title),
          description: wizardData.lesson.description || null,
          content_type: "mixed", // Always mixed - content is in blocks
          is_active: true,
          sort_order: 0,
        })
        .select()
        .single();

      if (error) throw error;

      setCreatedLessonId(newLesson.id);
      toast.success("Урок создан");
      setStep(3);
    } catch (error: any) {
      console.error("Error creating lesson:", error);
      toast.error(`Ошибка создания урока: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Save access and complete (step 3 -> 4)
  const handleSaveAccess = async () => {
    if (!createdModuleId) return;

    setIsCreating(true);
    try {
      // Remove existing access
      await supabase.from("module_access").delete().eq("module_id", createdModuleId);

      // Add new access if any
      if (wizardData.tariffIds.length > 0) {
        const accessRecords = wizardData.tariffIds.map((tariffId) => ({
          module_id: createdModuleId,
          tariff_id: tariffId,
        }));

        const { error } = await supabase.from("module_access").insert(accessRecords);
        if (error) throw error;
      }

      toast.success("Настройки доступа сохранены");
      setStep(4);
    } catch (error: any) {
      console.error("Error saving access:", error);
      toast.error(`Ошибка сохранения: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle next button
  const handleNext = async () => {
    switch (step) {
      case 0:
        setStep(1);
        break;
      case 1:
        await handleCreateModule();
        break;
      case 2:
        await handleCreateLesson();
        break;
      case 3:
        await handleSaveAccess();
        break;
      case 4:
        handleOpenChange(false);
        onComplete?.({ moduleId: createdModuleId!, lessonId: createdLessonId || undefined });
        break;
    }
  };

  // Navigation actions for step 4
  const handleEditLesson = () => {
    if (createdModuleId && createdLessonId) {
      handleOpenChange(false);
      navigate(`/admin/training-lessons/${createdModuleId}/edit/${createdLessonId}`);
    }
  };

  const handleAddAnotherLesson = () => {
    if (createdModuleId) {
      handleOpenChange(false);
      navigate(`/admin/training-modules/${createdModuleId}/lessons`);
    }
  };

  const handleOpenModule = () => {
    if (wizardData.module.slug) {
      window.open(`/library/${wizardData.module.slug}`, "_blank");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Мастер добавления контента
          </DialogTitle>
          <DialogDescription>{STEP_HINTS[step]}</DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="px-6 pb-2 shrink-0">
          <WizardStepIndicator steps={STEPS} currentStep={step} />
        </div>

        {/* Step content with scroll */}
        <ScrollArea className="flex-1 px-6">
          <div className="py-4 min-h-[300px]">
            {/* Slug warning */}
            {slugWarning && (
              <Alert className="mb-4 border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="ml-2 text-yellow-700 dark:text-yellow-400">
                  {slugWarning}
                </AlertDescription>
              </Alert>
            )}

            {/* Step 0: Section selection */}
            {step === 0 && (
              <ContentSectionSelector
                value={wizardData.menuSectionKey}
                onChange={handleSectionChange}
              />
            )}

            {/* Step 1: Module creation */}
            {step === 1 && (
              <ModuleFormFields
                formData={wizardData.module}
                onChange={handleModuleChange}
                showSectionSelector={false}
                showActiveSwitch={false}
                compact
              />
            )}

            {/* Step 2: Lesson creation (simplified) */}
            {step === 2 && (
              <div className="space-y-4">
                <LessonFormFieldsSimple
                  formData={wizardData.lesson}
                  onChange={handleLessonChange}
                />
                <Alert className="border-primary/30 bg-primary/5">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <AlertDescription className="ml-2">
                    Видео, текст и другой контент добавляются в редакторе блоков после создания урока
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {/* Step 3: Access configuration */}
            {step === 3 && (
              <CompactAccessSelector
                selectedTariffIds={wizardData.tariffIds}
                onChange={(ids) => setWizardData((prev) => ({ ...prev, tariffIds: ids }))}
                products={productsWithTariffs || []}
              />
            )}

            {/* Step 4: Summary */}
            {step === 4 && (
              <div className="space-y-4">
                <Alert className="border-primary/30 bg-primary/5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <AlertDescription className="ml-2">
                    <strong>Модуль "{wizardData.module.title}"</strong> успешно создан
                    {createdLessonId && (
                      <>
                        <br />
                        <strong>Урок "{wizardData.lesson.title}"</strong> добавлен
                      </>
                    )}
                  </AlertDescription>
                </Alert>

                <div className="grid gap-2 sm:grid-cols-2">
                  {createdLessonId && (
                    <Button variant="default" onClick={handleEditLesson} className="gap-2">
                      <FileText className="h-4 w-4" />
                      Редактировать урок
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleAddAnotherLesson} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Добавить ещё урок
                  </Button>
                  <Button variant="outline" onClick={handleOpenModule} className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Открыть модуль
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer navigation */}
        <DialogFooter className="px-6 py-4 border-t shrink-0 flex-col sm:flex-row gap-2 sm:gap-0">
          <div className="flex gap-2 w-full sm:w-auto">
            {step > 0 && step < 4 && (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={isCreating}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Назад
              </Button>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex gap-2 w-full sm:w-auto">
            {step === 2 && (
              <Button
                variant="ghost"
                onClick={() => handleCreateLesson(true)}
                disabled={isCreating}
              >
                <SkipForward className="h-4 w-4 mr-1" />
                Пропустить
              </Button>
            )}

            {step < 4 && (
              <Button onClick={handleNext} disabled={!canProceed || isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Сохранение...
                  </>
                ) : step === 3 ? (
                  <>
                    Завершить
                    <CheckCircle2 className="h-4 w-4 ml-1" />
                  </>
                ) : (
                  <>
                    Далее
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            )}

            {step === 4 && (
              <Button onClick={() => handleOpenChange(false)}>Закрыть</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
