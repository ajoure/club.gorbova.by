import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Video, FolderOpen, Plus, Loader2, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import { generateSlug } from "./ModuleFormFields";

interface ModuleSelectorProps {
  sectionKey: string;
  selectedModuleId: string | null;
  onSelect: (moduleId: string | null) => void;
}

interface ModuleOption {
  id: string;
  title: string;
  slug: string;
  lesson_count?: number;
}

// Check if slug exists
const checkSlugExists = async (slug: string): Promise<boolean> => {
  const { data } = await supabase
    .from("training_modules")
    .select("id")
    .eq("slug", slug)
    .limit(1);
  return !!(data && data.length > 0);
};

// Generate unique slug
const ensureUniqueSlug = async (baseSlug: string): Promise<string> => {
  let slug = baseSlug;
  let suffix = 2;
  
  while (await checkSlugExists(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  
  return slug;
};

export function ModuleSelector({
  sectionKey,
  selectedModuleId,
  onSelect,
}: ModuleSelectorProps) {
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickModuleTitle, setQuickModuleTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Fetch existing modules for this section (only real modules, not containers)
  const { data: modules, isLoading, refetch } = useQuery({
    queryKey: ["section-modules", sectionKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select(`
          id,
          title,
          slug,
          training_lessons(count)
        `)
        .eq("menu_section_key", sectionKey)
        .eq("is_container", false)
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw error;

      return (data || []).map((m) => ({
        id: m.id,
        title: m.title,
        slug: m.slug,
        lesson_count: (m.training_lessons as any)?.[0]?.count || 0,
      })) as ModuleOption[];
    },
    enabled: !!sectionKey,
  });

  // Quick create module handler
  const handleQuickCreateModule = async () => {
    if (!quickModuleTitle.trim()) {
      toast.error("Введите название модуля");
      return;
    }

    setIsCreating(true);
    try {
      const baseSlug = generateSlug(quickModuleTitle);
      const slug = await ensureUniqueSlug(baseSlug);

      const { data, error } = await supabase
        .from("training_modules")
        .insert({
          title: quickModuleTitle.trim(),
          slug,
          menu_section_key: sectionKey,
          is_container: false,
          is_active: true,
        })
        .select("id")
        .single();

      if (error) throw error;

      toast.success("Модуль создан");
      onSelect(data.id);
      setQuickModuleTitle("");
      setShowQuickCreate(false);
      refetch();
    } catch (error: any) {
      console.error("Error creating module:", error);
      toast.error(`Ошибка создания модуля: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">Выберите, где разместить урок</Label>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {/* Standalone option */}
          <GlassCard
            hover
            onClick={() => onSelect(null)}
            className={cn(
              "p-4 cursor-pointer transition-all",
              selectedModuleId === null && "ring-2 ring-primary border-primary/50"
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "p-2 rounded-lg",
                selectedModuleId === null 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-muted text-muted-foreground"
              )}>
                <Video className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Отдельный урок</h4>
                  {selectedModuleId === null && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Урок будет отображаться напрямую в разделе
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Existing modules */}
          {modules && modules.length > 0 && (
            <>
              <div className="text-sm text-muted-foreground py-2">
                Или выберите существующий модуль:
              </div>
              {modules.map((mod) => (
                <GlassCard
                  key={mod.id}
                  hover
                  onClick={() => onSelect(mod.id)}
                  className={cn(
                    "p-4 cursor-pointer transition-all",
                    selectedModuleId === mod.id && "ring-2 ring-primary border-primary/50"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      selectedModuleId === mod.id 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-muted text-muted-foreground"
                    )}>
                      <FolderOpen className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium truncate">{mod.title}</h4>
                        {selectedModuleId === mod.id && (
                          <Check className="h-4 w-4 text-primary shrink-0 ml-2" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Урок будет частью модуля
                        {mod.lesson_count ? ` • ${mod.lesson_count} уроков` : ""}
                      </p>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </>
          )}

          {/* Quick create module */}
          {!showQuickCreate ? (
            <Button
              variant="outline"
              onClick={() => setShowQuickCreate(true)}
              className="w-full gap-2 mt-2"
            >
              <Plus className="h-4 w-4" />
              Создать новый модуль...
            </Button>
          ) : (
            <GlassCard className="p-4 space-y-3">
              <Label>Название нового модуля</Label>
              <div className="flex gap-2">
                <Input
                  value={quickModuleTitle}
                  onChange={(e) => setQuickModuleTitle(e.target.value)}
                  placeholder="Например: Основы бухгалтерии"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleQuickCreateModule();
                    }
                  }}
                  disabled={isCreating}
                />
                <Button
                  onClick={handleQuickCreateModule}
                  disabled={!quickModuleTitle.trim() || isCreating}
                >
                  {isCreating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowQuickCreate(false);
                    setQuickModuleTitle("");
                  }}
                  disabled={isCreating}
                >
                  Отмена
                </Button>
              </div>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
