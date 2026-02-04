import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatInTimeZone } from "date-fns-tz";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
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

import { Loader2, Wand2, BookOpen, FileText, CheckCircle2, ArrowLeft, ArrowRight, SkipForward, ExternalLink, Plus, AlertTriangle, Video } from "lucide-react";
import { toast } from "sonner";

import { WizardStepIndicator } from "./WizardStepIndicator";
import { ContentSectionSelector } from "./ContentSectionSelector";
import { ContentTypeSelector, ContentType } from "./ContentTypeSelector";
import { ModuleFormFields, ModuleFormData, generateSlug } from "./ModuleFormFields";
import { LessonFormFieldsSimple, LessonFormDataSimple, generateLessonSlug } from "./LessonFormFieldsSimple";
import { KbLessonFormFields, KbLessonFormData, generateKbLessonSlug } from "./KbLessonFormFields";
import { UniversalLessonFormFields } from "./UniversalLessonFormFields";
import { ModuleSelector } from "./ModuleSelector";
import { CompactAccessSelector } from "./CompactAccessSelector";
import { LessonNotificationConfig, NotificationConfig, defaultNotificationConfig } from "./LessonNotificationConfig";
import { LessonSaleConfig, SaleConfig, defaultSaleConfig } from "./LessonSaleConfig";
import { parseTimecode } from "@/hooks/useKbQuestions";

interface ContentCreationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (result: { moduleId: string; lessonId?: string }) => void;
  initialSectionKey?: string;
}

interface WizardData {
  contentType: ContentType;
  menuSectionKey: string;
  module: ModuleFormData;
  lesson: LessonFormDataSimple;
  kbLesson: KbLessonFormData;
  tariffIds: string[];
  notification: NotificationConfig;
  saleConfig: SaleConfig;
  targetModuleId: string | null; // null = standalone (container), UUID = existing module
}

// Steps for MODULE flow
const MODULE_STEPS = [
  { label: "Раздел", shortLabel: "1" },
  { label: "Тип", shortLabel: "2" },
  { label: "Модуль", shortLabel: "3" },
  { label: "Урок", shortLabel: "4" },
  { label: "Доступ", shortLabel: "5" },
  { label: "Готово", shortLabel: "✓" },
];

// Steps for LESSON flow (standalone lesson) - Module selection added!
const LESSON_STEPS = [
  { label: "Раздел", shortLabel: "1" },
  { label: "Тип", shortLabel: "2" },
  { label: "Модуль", shortLabel: "3" },    // NEW: Module selection
  { label: "Доступ", shortLabel: "4" },    // Access
  { label: "Урок", shortLabel: "5" },      // Lesson data
  { label: "Готово", shortLabel: "✓" },    // Creation happens here
];

const MODULE_HINTS = [
  "Выберите, где будет отображаться ваш контент в меню пользователя",
  "Выберите тип создаваемого контента",
  "Создайте папку для группировки уроков — это карточка модуля",
  "Добавьте первый урок. Контент урока редактируется после создания в редакторе блоков",
  "Настройте, кто увидит контент. Пустой выбор = доступно всем",
  "Отлично! Контент создан и готов к редактированию",
];

const LESSON_HINTS = [
  "Выберите, где будет отображаться ваш урок в меню пользователя",
  "Выберите тип создаваемого контента",
  "Выберите, в какой модуль добавить урок или создайте новый",
  "Настройте, кто увидит контент. Пустой выбор = доступно всем",
  "Создайте урок (видеоответ, выпуск). Контент редактируется после создания",
  "Отлично! Урок создан и готов к редактированию",
];

const KB_LESSON_HINTS = [
  "Выберите, где будет отображаться ваш урок в меню пользователя",
  "Выберите тип создаваемого контента",
  "Выберите, в какой модуль добавить выпуск или создайте новый",
  "Настройте, кто увидит контент. Пустой выбор = доступно всем",
  "Заполните данные выпуска и добавьте вопросы",
  "Отлично! Выпуск создан и готов к редактированию",
];

// Check if slug exists in database (for modules)
const checkSlugExists = async (slug: string): Promise<boolean> => {
  const { data } = await supabase
    .from("training_modules")
    .select("id")
    .eq("slug", slug)
    .limit(1);
  return !!(data && data.length > 0);
};

// Generate unique slug with suffix if needed (for modules)
const ensureUniqueSlug = async (baseSlug: string): Promise<string> => {
  let slug = baseSlug;
  let suffix = 2;
  
  while (await checkSlugExists(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  
  return slug;
};

// Check if lesson slug exists in a module
const checkLessonSlugExists = async (moduleId: string, slug: string): Promise<boolean> => {
  const { data } = await supabase
    .from("training_lessons")
    .select("id")
    .eq("module_id", moduleId)
    .eq("slug", slug)
    .limit(1);
  return !!(data && data.length > 0);
};

// Generate unique lesson slug with suffix if needed
const ensureUniqueLessonSlug = async (moduleId: string, baseSlug: string): Promise<string> => {
  let slug = baseSlug;
  let suffix = 2;
  
  while (await checkLessonSlugExists(moduleId, slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  
  return slug;
};

// Get or create container module for standalone lessons
const getOrCreateContainerModule = async (sectionKey: string): Promise<string> => {
  // 1. Find existing container
  const { data: existing, error: findError } = await supabase
    .from("training_modules")
    .select("id")
    .eq("menu_section_key", sectionKey)
    .eq("is_container", true)
    .maybeSingle();
  
  if (findError) throw findError;
  if (existing) return existing.id;
  
  // 2. Create new container
  const containerSlug = await ensureUniqueSlug(`container-${sectionKey}`);
  
  const { data: newModule, error: createError } = await supabase
    .from("training_modules")
    .insert({
      title: `Уроки: ${sectionKey}`,
      slug: containerSlug,
      menu_section_key: sectionKey,
      is_container: true,
      is_active: true,
      display_layout: "standalone-lessons",
    })
    .select("id")
    .single();
  
  if (createError) throw createError;
  return newModule.id;
};

const createInitialState = (initialSectionKey?: string): WizardData => ({
  contentType: "module",
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
    thumbnail_url: "",
    answer_date: undefined,
    answer_time: "00:00",
    answer_timezone: "Europe/Minsk",
    kinescope_url: "",
    questions: [],
  },
  kbLesson: {
    episode_number: 0,
    answer_date: undefined,
    answer_time: "00:00",
    answer_timezone: "Europe/Minsk",
    kinescope_url: "",
    thumbnail_url: "",
    questions: [],
  },
  tariffIds: [],
  notification: { ...defaultNotificationConfig },
  saleConfig: { ...defaultSaleConfig },
  targetModuleId: null, // null = standalone lesson (container)
});

// Check if section is KB (videos or questions)
const isKbSection = (sectionKey: string): boolean => {
  return sectionKey === "knowledge-videos" || sectionKey === "knowledge-questions";
};

export function ContentCreationWizard({
  open,
  onOpenChange,
  onComplete,
  initialSectionKey,
}: ContentCreationWizardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [createdModuleId, setCreatedModuleId] = useState<string | null>(null);
  const [createdLessonId, setCreatedLessonId] = useState<string | null>(null);
  const [slugWarning, setSlugWarning] = useState<string | null>(null);

  const [wizardData, setWizardData] = useState<WizardData>(() => 
    createInitialState(initialSectionKey)
  );

  // Determine which flow we're in
  const isLessonFlow = wizardData.contentType === "lesson";
  const isKbFlow = isLessonFlow && isKbSection(wizardData.menuSectionKey);
  const steps = isLessonFlow ? LESSON_STEPS : MODULE_STEPS;
  const hints = isKbFlow ? KB_LESSON_HINTS : (isLessonFlow ? LESSON_HINTS : MODULE_HINTS);
  const maxStep = steps.length - 1;

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
        setWizardData(createInitialState(initialSectionKey));
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, initialSectionKey]
  );

  // Validation based on current step and flow
  const canProceed = useMemo(() => {
    if (isLessonFlow) {
      // Lesson flow: Section -> Type -> Module -> Access -> Lesson -> Done
      switch (step) {
        case 0: return !!wizardData.menuSectionKey;
        case 1: return true; // Type selection always valid
        case 2: return true; // Module selection is optional (null = standalone)
        case 3: return true; // Access is optional
        case 4: 
          if (isKbFlow) {
            return wizardData.kbLesson.episode_number > 0;
          }
          return !!wizardData.lesson.title && !!wizardData.lesson.slug;
        case 5: return true; // Done
        default: return false;
      }
    } else {
      // Module flow: Section -> Type -> Module -> Lesson -> Access -> Done
      switch (step) {
        case 0: return !!wizardData.menuSectionKey;
        case 1: return true; // Type selection always valid
        case 2: return !!wizardData.module.title && !!wizardData.module.slug;
        case 3: return true; // Lesson is optional
        case 4: return true; // Access is optional
        case 5: return true; // Done
        default: return false;
      }
    }
  }, [step, wizardData, isLessonFlow, isKbFlow]);

  // Update section in module data
  const handleSectionChange = (key: string) => {
    setWizardData((prev) => ({
      ...prev,
      menuSectionKey: key,
      module: { ...prev.module, menu_section_key: key },
    }));
  };

  // Handle content type change
  const handleContentTypeChange = (type: ContentType) => {
    setWizardData((prev) => ({ ...prev, contentType: type }));
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

  // Handle KB lesson form changes
  const handleKbLessonChange = (data: KbLessonFormData) => {
    setWizardData((prev) => ({ ...prev, kbLesson: data }));
  };

  // Create module (module flow step 2 -> 3)
  const handleCreateModule = async () => {
    setIsCreating(true);
    setSlugWarning(null);
    
    try {
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
          is_container: false,
        })
        .select()
        .single();

      if (error) throw error;

      setWizardData(prev => ({
        ...prev,
        module: { ...prev.module, slug: uniqueSlug }
      }));
      
      setCreatedModuleId(newModule.id);
      
      queryClient.invalidateQueries({ queryKey: ["sidebar-modules"] });
      queryClient.invalidateQueries({ queryKey: ["page-sections-tabs"] });
      queryClient.invalidateQueries({ queryKey: ["training-modules"] });
      
      toast.success("Модуль создан");
      setStep(3);
    } catch (error: any) {
      console.error("Error creating module:", error);
      toast.error(`Ошибка создания модуля: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Create lesson in existing module (module flow step 3 -> 4) or skip
  const handleCreateLessonInModule = async (skip = false) => {
    if (skip || !wizardData.lesson.title) {
      setStep(4);
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
          thumbnail_url: wizardData.lesson.thumbnail_url || null,
          content_type: "mixed",
          is_active: true,
          sort_order: 0,
        })
        .select()
        .single();

      if (error) throw error;

      setCreatedLessonId(newLesson.id);
      toast.success("Урок создан");
      setStep(4);
    } catch (error: any) {
      console.error("Error creating lesson:", error);
      toast.error(`Ошибка создания урока: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Create standalone lesson (lesson flow step 4 -> 5) - NOW creates BOTH lesson and access atomically
  const handleCreateStandaloneLessonWithAccess = async () => {
    setIsCreating(true);
    
    try {
      // If a specific module was selected, use it. Otherwise get/create container
      const containerId = wizardData.targetModuleId 
        ? wizardData.targetModuleId 
        : await getOrCreateContainerModule(wizardData.menuSectionKey);
      setCreatedModuleId(containerId);

      // Determine lesson data based on flow type
      const lessonTitle = isKbFlow 
        ? `Выпуск №${wizardData.kbLesson.episode_number}`
        : wizardData.lesson.title;
      
      const baseSlug = isKbFlow
        ? generateKbLessonSlug(wizardData.kbLesson.episode_number)
        : (wizardData.lesson.slug || generateLessonSlug(wizardData.lesson.title));
      
      // Ensure unique slug to prevent duplicate key error
      const lessonSlug = await ensureUniqueLessonSlug(containerId, baseSlug);
      
      const thumbnailUrl = isKbFlow
        ? wizardData.kbLesson.thumbnail_url
        : wizardData.lesson.thumbnail_url;

      const sortOrder = isKbFlow ? wizardData.kbLesson.episode_number : 0;

      // Build published_at with time and timezone - FOR ALL SECTIONS
      let publishedAt: string | null = null;
      const answerDate = isKbFlow 
        ? wizardData.kbLesson.answer_date 
        : wizardData.lesson.answer_date;
      const answerTime = isKbFlow 
        ? (wizardData.kbLesson.answer_time || "00:00")
        : (wizardData.lesson.answer_time || "00:00");
      const answerTz = isKbFlow 
        ? (wizardData.kbLesson.answer_timezone || "Europe/Minsk")
        : (wizardData.lesson.answer_timezone || "Europe/Minsk");
      
      if (answerDate) {
        // Combine date + time
        const [hours, minutes] = answerTime.split(":").map(Number);
        const combinedDate = new Date(answerDate);
        combinedDate.setHours(hours, minutes, 0, 0);
        
        // Format to ISO with timezone
        publishedAt = formatInTimeZone(combinedDate, answerTz, "yyyy-MM-dd'T'HH:mm:ssXXX");
      }

      // Create lesson in container
      const { data: newLesson, error } = await supabase
        .from("training_lessons")
        .insert({
          module_id: containerId,
          title: lessonTitle,
          slug: lessonSlug,
          description: isKbFlow ? null : (wizardData.lesson.description || null),
          thumbnail_url: thumbnailUrl || null,
          content_type: (isKbFlow || wizardData.lesson.kinescope_url) ? "video" : "mixed",
          is_active: true,
          sort_order: sortOrder,
          published_at: publishedAt,
        })
        .select()
        .single();

      if (error) throw error;

      setCreatedLessonId(newLesson.id);

      // Create video block and questions - FOR ALL SECTIONS
      const kinescopeUrl = isKbFlow 
        ? wizardData.kbLesson.kinescope_url 
        : wizardData.lesson.kinescope_url;
      
      if (kinescopeUrl) {
        await supabase.from("lesson_blocks").insert({
          lesson_id: newLesson.id,
          block_type: "video",
          content: {
            url: kinescopeUrl,
            provider: "kinescope",
          },
          sort_order: 0,
        });
      }

      // Create questions - FOR ALL SECTIONS
      const questions = isKbFlow 
        ? wizardData.kbLesson.questions 
        : (wizardData.lesson.questions || []);
      
      if (questions.length > 0) {
        const questionsToInsert = questions
          .filter(q => q.title.trim()) // Only insert questions with titles
          .map((q, idx) => ({
            lesson_id: newLesson.id,
            episode_number: isKbFlow ? wizardData.kbLesson.episode_number : 0,
            question_number: idx + 1,
            title: q.title.trim(),
            full_question: q.full_question?.trim() || null,
            timecode_seconds: q.timecode ? parseTimecode(q.timecode) : null,
            kinescope_url: kinescopeUrl || null,
            answer_date: answerDate 
              ? new Date(answerDate).toISOString().split("T")[0]
              : new Date().toISOString().split("T")[0],
          }));

        if (questionsToInsert.length > 0) {
          const { error: qError } = await supabase
            .from("kb_questions")
            .insert(questionsToInsert);
          
          if (qError) {
            console.error("Error inserting questions:", qError);
            toast.error("Урок создан, но не удалось добавить вопросы");
          }
        }
      }

      // Invalidate KB questions cache
      queryClient.invalidateQueries({ queryKey: ["kb-questions"] });

      // Get container slug for URL
      const { data: containerData } = await supabase
        .from("training_modules")
        .select("slug")
        .eq("id", containerId)
        .single();
      const containerSlug = containerData?.slug || "container";

      // SAVE ACCESS (previously was separate step)
      // Clear existing access first
      await supabase.from("module_access").delete().eq("module_id", containerId);

      if (wizardData.tariffIds.length > 0) {
        const accessRecords = wizardData.tariffIds.map((tariffId) => ({
          module_id: containerId,
          tariff_id: tariffId,
        }));

        const { error: accessError } = await supabase.from("module_access").insert(accessRecords);
        if (accessError) {
          console.error("Error saving access:", accessError);
          toast.error("Урок создан, но не удалось сохранить настройки доступа");
        }
      }

      // CREATE PRODUCT FOR LESSON MONETIZATION (if enabled)
      if (wizardData.saleConfig.enabled && wizardData.saleConfig.basePrice > 0) {
        try {
          const productCode = `lesson-${lessonSlug}`;
          const productName = isKbFlow 
            ? `Выпуск №${wizardData.kbLesson.episode_number}`
            : wizardData.lesson.title;
          
          // 1. Create product
          const { data: newProduct, error: productError } = await supabase
            .from("products_v2")
            .insert({
              code: productCode,
              name: `Урок: ${productName}`,
              slug: lessonSlug,
              category: 'lesson',
              status: 'active',
              is_active: true,
              currency: 'BYN',
            })
            .select()
            .single();
          
          if (productError) {
            console.error("Error creating product:", productError);
            toast.error("Урок создан, но не удалось создать продукт для продажи");
          } else {
            // 2. Create tariff
            const accessDays = 
              wizardData.saleConfig.accessDuration === 'forever' ? 36500 :
              wizardData.saleConfig.accessDuration === 'days' ? (wizardData.saleConfig.accessDays || 30) :
              30; // 'period' handled in grant-access
            
            const { data: newTariff, error: tariffError } = await supabase
              .from("tariffs")
              .insert({
                product_id: newProduct.id,
                code: `${productCode}-base`,
                name: 'Доступ к уроку',
                access_days: accessDays,
                is_active: true,
              })
              .select()
              .single();
            
            if (tariffError) {
              console.error("Error creating tariff:", tariffError);
            } else {
              // 3. Create offer (payment button)
              await supabase.from("tariff_offers").insert({
                tariff_id: newTariff.id,
                offer_type: 'pay_now',
                button_label: 'Купить',
                amount: wizardData.saleConfig.basePrice,
                is_active: true,
                is_primary: true,
                sort_order: 0,
              });
              
              // 4. Save price rules
              if (wizardData.saleConfig.priceRules.length > 0) {
                const priceRules = wizardData.saleConfig.priceRules
                  .filter(r => r.tariffId && r.price > 0)
                  .map((r, idx) => ({
                    lesson_id: newLesson.id,
                    tariff_id: r.tariffId,
                    price: r.price,
                    sort_order: idx,
                  }));
                
                if (priceRules.length > 0) {
                  await supabase.from("lesson_price_rules").insert(priceRules);
                }
              }
              
              // 5. Update lesson with product_id
              await supabase
                .from("training_lessons")
                .update({ product_id: newProduct.id })
                .eq("id", newLesson.id);
              
              toast.success("Продукт для продажи урока создан");
            }
          }
        } catch (e) {
          console.error("Error creating lesson product:", e);
          toast.info("Урок создан, но продукт для продажи не удалось создать");
        }
      }

      // SEND TELEGRAM NOTIFICATION (if configured and not scheduled for future)
      if (wizardData.notification.enabled && wizardData.notification.botId && wizardData.notification.messageText) {
        const isScheduledForFuture = isKbFlow && wizardData.kbLesson.answer_date && wizardData.kbLesson.answer_date > new Date();
        const shouldSendNow = !wizardData.notification.sendOnPublish || !isScheduledForFuture;
        
        // Get final lesson URL - use production domain
        const finalLessonUrl = `https://club.gorbova.by/library/${containerSlug}/${lessonSlug}`;
        
        // Update button URL if it was placeholder
        const buttonUrl = wizardData.notification.buttonUrl?.includes("...") 
          ? finalLessonUrl 
          : (wizardData.notification.buttonUrl || finalLessonUrl);

        if (shouldSendNow) {
          try {
            // Call edge function to send notification
            const { data: session } = await supabase.auth.getSession();
            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-broadcast`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${session?.session?.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  botId: wizardData.notification.botId,
                  messageText: wizardData.notification.messageText,
                  buttonText: wizardData.notification.buttonText || "Смотреть",
                  buttonUrl: buttonUrl,
                  targetTariffIds: wizardData.tariffIds.length > 0 ? wizardData.tariffIds : null,
                  notificationType: "lesson_release",
                  lessonId: newLesson.id,
                }),
              }
            );

            if (response.ok) {
              toast.success("Уведомление отправляется...");
            } else {
              console.error("Notification response:", await response.text());
              toast.info("Урок создан, уведомление будет отправлено позже");
            }
          } catch (e) {
            console.error("Notification error:", e);
            toast.info("Урок создан. Уведомление можно отправить вручную");
          }
        } else if (wizardData.notification.sendOnPublish && isScheduledForFuture) {
          // For now, just inform user - future: add meta column or separate table
          toast.info(`Уведомление будет отправлено при публикации урока (${format(wizardData.kbLesson.answer_date!, "d MMM в HH:mm", { locale: ru })})`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["container-lessons"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-modules"] });
      queryClient.invalidateQueries({ queryKey: ["module-access"] });
      
      toast.success(isKbFlow ? "Выпуск создан" : "Урок создан");
      setStep(4);
    } catch (error: any) {
      console.error("Error creating standalone lesson:", error);
      toast.error(`Ошибка создания урока: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Save access (access step for both flows)
  const handleSaveAccess = async () => {
    if (!createdModuleId) {
      // For lesson flow, move to done even without module access
      setStep(isLessonFlow ? 5 : 5);
      return;
    }

    setIsCreating(true);
    try {
      await supabase.from("module_access").delete().eq("module_id", createdModuleId);

      if (wizardData.tariffIds.length > 0) {
        const accessRecords = wizardData.tariffIds.map((tariffId) => ({
          module_id: createdModuleId,
          tariff_id: tariffId,
        }));

        const { error } = await supabase.from("module_access").insert(accessRecords);
        if (error) throw error;
      }

      toast.success("Настройки доступа сохранены");
      setStep(isLessonFlow ? 4 : 5);
    } catch (error: any) {
      console.error("Error saving access:", error);
      toast.error(`Ошибка сохранения: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle next button based on flow and step
  const handleNext = async () => {
    if (isLessonFlow) {
      // Lesson flow: Section -> Type -> Module -> Access -> Lesson -> Done
      switch (step) {
        case 0: setStep(1); break;
        case 1: setStep(2); break;
        case 2: setStep(3); break;  // Module selection -> Access
        case 3: setStep(4); break;  // Access -> Lesson (no creation yet)
        case 4: await handleCreateStandaloneLessonWithAccess(); break;  // Create lesson AND access
        case 5:
          handleOpenChange(false);
          onComplete?.({ moduleId: createdModuleId!, lessonId: createdLessonId || undefined });
          break;
      }
    } else {
      // Module flow: Section -> Type -> Module -> Lesson -> Access -> Done
      switch (step) {
        case 0: setStep(1); break;
        case 1: setStep(2); break;
        case 2: await handleCreateModule(); break;
        case 3: await handleCreateLessonInModule(); break;
        case 4: await handleSaveAccess(); break;
        case 5:
          handleOpenChange(false);
          onComplete?.({ moduleId: createdModuleId!, lessonId: createdLessonId || undefined });
          break;
      }
    }
  };

  // Navigation actions for final step
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

  // Determine what step content to show
  const renderStepContent = () => {
    // Step 0: Section selection (both flows)
    if (step === 0) {
      return (
        <ContentSectionSelector
          value={wizardData.menuSectionKey}
          onChange={handleSectionChange}
        />
      );
    }

    // Step 1: Content type selection (both flows)
    if (step === 1) {
      return (
        <ContentTypeSelector
          value={wizardData.contentType}
          onChange={handleContentTypeChange}
        />
      );
    }

    if (isLessonFlow) {
      // Lesson flow steps: Section -> Type -> Module -> Access -> Lesson -> Done
      if (step === 2) {
        // MODULE SELECTION step (NEW!)
        return (
          <ModuleSelector
            sectionKey={wizardData.menuSectionKey}
            selectedModuleId={wizardData.targetModuleId}
            onSelect={(id) => setWizardData((prev) => ({ ...prev, targetModuleId: id }))}
          />
        );
      }
      if (step === 3) {
        // ACCESS step
        const lessonTitle = isKbFlow 
          ? `Выпуск №${wizardData.kbLesson.episode_number || "..."}`
          : (wizardData.lesson.title || "Новый урок");
        
        const lessonUrl = `https://club.gorbova.by/library/${wizardData.menuSectionKey}/...`;
        
        return (
          <div className="space-y-6">
            <CompactAccessSelector
              selectedTariffIds={wizardData.tariffIds}
              onChange={(ids) => setWizardData((prev) => ({ ...prev, tariffIds: ids }))}
              products={productsWithTariffs || []}
            />
            
            {/* Lesson monetization */}
            <LessonSaleConfig
              config={wizardData.saleConfig}
              onChange={(cfg) => setWizardData((prev) => ({ ...prev, saleConfig: cfg }))}
            />
          </div>
        );
      }
      if (step === 4) {
        // LESSON step - UNIFIED form for all sections
        const lessonTitle = isKbFlow 
          ? `Выпуск №${wizardData.kbLesson.episode_number || "..."}`
          : (wizardData.lesson.title || "Новый урок");
        
        const containerSlug = `container-${wizardData.menuSectionKey}`;
        const lessonSlug = isKbFlow
          ? generateKbLessonSlug(wizardData.kbLesson.episode_number || 0)
          : (wizardData.lesson.slug || generateLessonSlug(wizardData.lesson.title));
        const lessonUrl = `https://club.gorbova.by/library/${containerSlug}/${lessonSlug}`;
        
        return (
          <div className="space-y-6">
            <UniversalLessonFormFields
              isKbSection={isKbFlow}
              lessonData={wizardData.lesson}
              kbData={wizardData.kbLesson}
              onLessonChange={handleLessonChange}
              onKbChange={handleKbLessonChange}
            />
            
            {/* Telegram notifications */}
            <LessonNotificationConfig
              config={wizardData.notification}
              onChange={(cfg) => setWizardData((prev) => ({ ...prev, notification: cfg }))}
              lessonTitle={lessonTitle}
              lessonUrl={lessonUrl}
              selectedTariffIds={wizardData.tariffIds}
              episodeNumber={isKbFlow ? wizardData.kbLesson.episode_number : undefined}
              questions={isKbFlow ? wizardData.kbLesson.questions : wizardData.lesson.questions}
            />
          </div>
        );
      }
      if (step === 5) {
        // DONE step
        const lessonTitle = isKbFlow 
          ? `Выпуск №${wizardData.kbLesson.episode_number}`
          : wizardData.lesson.title;
        
        return (
          <div className="space-y-4">
            <Alert className="border-primary/30 bg-primary/5">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertDescription className="ml-2">
                <strong>{lessonTitle}</strong> успешно создан
                {isKbFlow && wizardData.kbLesson.questions.length > 0 && (
                  <>
                    <br />
                    <span className="text-muted-foreground">
                      Добавлено вопросов: {wizardData.kbLesson.questions.filter(q => q.title.trim()).length}
                    </span>
                  </>
                )}
              </AlertDescription>
            </Alert>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="default" onClick={handleEditLesson} className="gap-2">
                <FileText className="h-4 w-4" />
                Редактировать урок
              </Button>
            </div>
          </div>
        );
      }
    } else {
      // Module flow steps
      if (step === 2) {
        return (
          <ModuleFormFields
            formData={wizardData.module}
            onChange={handleModuleChange}
            showSectionSelector={false}
            showActiveSwitch={false}
            compact
          />
        );
      }
      if (step === 3) {
        return (
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
        );
      }
      if (step === 4) {
        return (
          <CompactAccessSelector
            selectedTariffIds={wizardData.tariffIds}
            onChange={(ids) => setWizardData((prev) => ({ ...prev, tariffIds: ids }))}
            products={productsWithTariffs || []}
          />
        );
      }
      if (step === 5) {
        return (
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
        );
      }
    }

    return null;
  };

  // Determine if we're on an optional lesson step (module flow step 3)
  const isOptionalLessonStep = !isLessonFlow && step === 3;
  const isFinalStep = step === maxStep;
  // In lesson flow, step 4 is the lesson step where we create everything (show "Завершить")
  // In module flow, step 4 is access step where we finalize
  const isCreationStep = isLessonFlow ? step === 4 : step === 4;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Мастер добавления контента
          </DialogTitle>
          <DialogDescription>{hints[step]}</DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="px-6 pb-2 shrink-0 overflow-x-auto">
          <WizardStepIndicator steps={steps} currentStep={step} />
        </div>

        {/* Step content with native scroll */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6">
          <div className="py-4 max-h-[calc(70vh-180px)]">
            {/* Slug warning */}
            {slugWarning && (
              <Alert className="mb-4 border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="ml-2 text-yellow-700 dark:text-yellow-400">
                  {slugWarning}
                </AlertDescription>
              </Alert>
            )}

            {renderStepContent()}
          </div>
        </div>

        {/* Footer navigation */}
        <DialogFooter className="px-6 py-4 border-t shrink-0 flex-col sm:flex-row gap-2 sm:gap-0">
          <div className="flex gap-2 w-full sm:w-auto">
            {step > 0 && !isFinalStep && (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={isCreating}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Назад
              </Button>
            )}
          </div>

          <div className="flex-1" />

          <div className="flex gap-2 w-full sm:w-auto">
            {isOptionalLessonStep && (
              <Button
                variant="ghost"
                onClick={() => handleCreateLessonInModule(true)}
                disabled={isCreating}
              >
                <SkipForward className="h-4 w-4 mr-1" />
                Пропустить
              </Button>
            )}

            {!isFinalStep && (
              <Button onClick={handleNext} disabled={!canProceed || isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Сохранение...
                  </>
                ) : isCreationStep ? (
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

            {isFinalStep && (
              <Button onClick={() => handleOpenChange(false)}>Закрыть</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
