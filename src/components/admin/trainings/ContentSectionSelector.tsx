import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { Input } from "@/components/ui/input";

import { useAllPageSections, PageSection } from "@/hooks/usePageSections";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  BookOpen,
  Wallet,
  Sparkles,
  Cpu,
  GraduationCap,
  Briefcase,
  Calculator,
  ClipboardCheck,
  Folder,
  HelpCircle,
  Video,
  Scale,
  Library,
  Package,
  ChevronRight,
  Check,
  Plus,
  Trash2,
  LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icon mapping
const ICONS: Record<string, LucideIcon> = {
  Activity,
  BookOpen,
  Wallet,
  Sparkles,
  Cpu,
  GraduationCap,
  Briefcase,
  Calculator,
  ClipboardCheck,
  Folder,
  HelpCircle,
  Video,
  Scale,
  Library,
  Package,
};

interface ContentSectionSelectorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ContentSectionSelector({
  value,
  onChange,
  className,
}: ContentSectionSelectorProps) {
  const { data: sections, isLoading } = useAllPageSections();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; label: string } | null>(null);
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get parent sections (roots / pages)
  const parents = useMemo(() => {
    return sections || [];
  }, [sections]);

  // Get children of selected parent
  const children = useMemo(() => {
    if (!selectedParent) return [];
    const parent = parents.find((p) => p.key === selectedParent);
    return parent?.children || [];
  }, [selectedParent, parents]);

  // Find selected option and build path
  const selectedPath = useMemo(() => {
    if (!sections || !value) return null;

    for (const parent of sections) {
      if (parent.key === value) {
        return { parent, child: null };
      }
      const child = parent.children?.find((c: PageSection) => c.key === value);
      if (child) {
        return { parent, child };
      }
    }
    return null;
  }, [sections, value]);

  const getIcon = (iconName: string) => {
    return ICONS[iconName] || Folder;
  };

  // Generate slug from label
  const generateSlug = (label: string, parentKey: string): string => {
    const base = label
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s-]/gi, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    return `${parentKey}-${base || "section"}`;
  };

  // Create new section
  const handleCreateSection = async () => {
    if (!newSectionLabel.trim() || !selectedParent) return;

    const parent = parents.find((p) => p.key === selectedParent);
    if (!parent) return;

    setIsCreating(true);

    try {
      const baseKey = generateSlug(newSectionLabel, parent.key);
      let key = baseKey;
      let suffix = 2;

      // Check for uniqueness and add suffix if needed
      const { data: existing } = await supabase
        .from("user_menu_sections")
        .select("key")
        .like("key", `${baseKey}%`);

      if (existing && existing.length > 0) {
        const existingKeys = new Set(existing.map((e) => e.key));
        while (existingKeys.has(key)) {
          key = `${baseKey}-${suffix}`;
          suffix++;
        }
      }

      // Get max sort_order for children
      const maxOrder = Math.max(0, ...(parent.children?.map((c: PageSection) => c.sort_order) || [0]));

      const { error } = await supabase.from("user_menu_sections").insert({
        key,
        label: newSectionLabel.trim(),
        icon: "Folder",
        url: `/${parent.url?.replace(/^\//, "") || parent.key}`,
        sort_order: maxOrder + 1,
        parent_key: parent.key,
        page_key: parent.key,
        kind: "tab",
        is_active: true,
      });

      if (error) throw error;

      // Auto-create child module for Knowledge Base container tabs
      if (parent.key === "knowledge" && key !== "knowledge-laws") {
        try {
          // Find the Knowledge Base container module
          const { data: containerModule } = await supabase
            .from("training_modules")
            .select("id")
            .eq("slug", "container-knowledge-videos")
            .eq("is_container", true)
            .maybeSingle();

          if (containerModule) {
            // Guard: check if module already exists for this tab
            const { data: existingModule } = await supabase
              .from("training_modules")
              .select("id")
              .eq("parent_module_id", containerModule.id)
              .eq("menu_section_key", key)
              .maybeSingle();

            if (!existingModule) {
              // Safe slug: check for collisions
              let moduleSlug = key;
              const { data: slugExists } = await supabase
                .from("training_modules")
                .select("id")
                .eq("slug", moduleSlug)
                .maybeSingle();
              if (slugExists) {
                moduleSlug = `${key}-${Date.now()}`;
              }

              // Get max sort_order among siblings
              const { data: siblings } = await supabase
                .from("training_modules")
                .select("sort_order")
                .eq("parent_module_id", containerModule.id);

              const maxOrder = Math.max(0, ...(siblings?.map(s => s.sort_order ?? 0) || [0]));

              // Create child module
              const { data: newModule } = await supabase
                .from("training_modules")
                .insert({
                  title: newSectionLabel.trim(),
                  slug: moduleSlug,
                  parent_module_id: containerModule.id,
                  menu_section_key: key,
                  icon: "Video",
                  color_gradient: "from-purple-500 to-violet-500",
                  sort_order: maxOrder + 1,
                  is_active: true,
                  is_container: false,
                })
                .select("id")
                .single();

              // Copy access from container
              // PATCH v23.1.6: Skip module_access copy if container has product_id
              if (newModule && !containerModule.product_id) {
                const { data: containerAccess } = await supabase
                  .from("module_access")
                  .select("tariff_id")
                  .eq("module_id", containerModule.id);

                if (containerAccess?.length) {
                  await supabase.from("module_access").insert(
                    containerAccess.map(a => ({
                      module_id: newModule.id,
                      tariff_id: a.tariff_id,
                    }))
                  );
                }
              }
            }
          }
        } catch (autoErr) {
          console.error("Auto-create module for knowledge tab failed:", autoErr);
          // Non-blocking: tab was created, module creation is secondary
        }
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["all-page-sections"] });
      queryClient.invalidateQueries({ queryKey: ["page-sections-tabs"] });
      queryClient.invalidateQueries({ queryKey: ["user-menu-sections"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-modules"] });
      queryClient.invalidateQueries({ queryKey: ["container-lessons"] });

      toast.success(`Секция "${newSectionLabel}" создана`);

      // Select the new section
      onChange(key);
      setNewSectionLabel("");
      setShowCreateDialog(false);
      setOpen(false);
    } catch (error: any) {
      console.error("Error creating section:", error);
      toast.error(`Ошибка создания секции: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Check if section can be deleted (only tabs, not pages)
  const canDeleteSection = (section: PageSection): boolean => {
    return section.kind === "tab";
  };

  // Delete section
  const handleDeleteSection = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      // Check if there are modules linked to this section
      const { data: modules } = await supabase
        .from("training_modules")
        .select("id")
        .eq("menu_section_key", deleteTarget.key)
        .limit(1);

      if (modules && modules.length > 0) {
        toast.error("Нельзя удалить: есть привязанные модули. Сначала переместите их в другую секцию.");
        return;
      }

      // Delete the section
      const { error } = await supabase
        .from("user_menu_sections")
        .delete()
        .eq("key", deleteTarget.key);

      if (error) throw error;

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["all-page-sections"] });
      queryClient.invalidateQueries({ queryKey: ["page-sections-tabs"] });
      queryClient.invalidateQueries({ queryKey: ["user-menu-sections"] });

      toast.success(`Секция "${deleteTarget.label}" удалена`);

      // If deleted section was selected, clear selection
      if (value === deleteTarget.key) {
        onChange("");
      }

      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch (error: any) {
      console.error("Error deleting section:", error);
      toast.error(`Ошибка удаления: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteDialog = (section: PageSection) => {
    setDeleteTarget({ key: section.key, label: section.label });
    setShowDeleteDialog(true);
  };

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label>Раздел меню</Label>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Label>Раздел меню</Label>
      <p className="text-xs text-muted-foreground mb-1">
        Где модуль будет отображаться в навигации пользователя
      </p>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selectedPath ? (
              <div className="flex items-center gap-2 truncate">
                {(() => {
                  const Icon = getIcon(
                    selectedPath.child?.icon || selectedPath.parent.icon
                  );
                  return <Icon className="h-4 w-4 shrink-0" />;
                })()}
                <span className="truncate">
                  {selectedPath.child
                    ? `${selectedPath.parent.label} / ${selectedPath.child.label}`
                    : selectedPath.parent.label}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">Выберите раздел...</span>
            )}
            <ChevronRight className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[420px] p-0 z-[100]"
          align="start"
          side="bottom"
          sideOffset={8}
          avoidCollisions={true}
          collisionPadding={16}
        >
          <div className="flex border-b">
            {/* Left column: Parents */}
            <div
              className="w-1/2 h-[300px] border-r overflow-y-auto overscroll-contain min-h-0"
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <div className="p-1">
                {parents.map((parent) => {
                  const Icon = getIcon(parent.icon);
                  const isSelected = selectedParent === parent.key;
                  const hasChildren = parent.children && parent.children.length > 0;

                  return (
                    <div
                      key={parent.key}
                      onClick={() => {
                        setSelectedParent(parent.key);
                        // If no children, select parent directly
                        if (!hasChildren) {
                          onChange(parent.key);
                          setOpen(false);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate text-sm">
                        {parent.label}
                      </span>
                      {hasChildren && (
                        <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right column: Children */}
            <div
              className="w-1/2 h-[300px] overflow-y-auto overscroll-contain min-h-0"
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <div className="p-1">
                {selectedParent ? (
                  <>
                    {children.map((child: PageSection) => {
                      const Icon = getIcon(child.icon);
                      const isSelected = value === child.key;
                      const canDelete = canDeleteSection(child);

                      return (
                        <div
                          key={child.key}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2.5 rounded-md transition-colors group",
                            isSelected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          )}
                        >
                          <div
                            className="flex items-center gap-2 flex-1 cursor-pointer"
                            onClick={() => {
                              onChange(child.key);
                              setOpen(false);
                            }}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1 truncate text-sm">
                              {child.label}
                            </span>
                            {isSelected && (
                              <Check className="h-4 w-4 shrink-0" />
                            )}
                          </div>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDeleteDialog(child);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      );
                    })}

                    {/* Create new section button */}
                    <div
                      onClick={() => setShowCreateDialog(true)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer transition-colors text-primary hover:bg-primary/10 border-t mt-1 pt-2"
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-medium">
                        Создать вкладку
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4">
                    Выберите родительский раздел слева
                  </div>
                )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Create Section Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Создать новую вкладку</DialogTitle>
            <DialogDescription>
              Новая вкладка будет создана в разделе "
              {parents.find((p) => p.key === selectedParent)?.label}"
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="section-label">Название вкладки</Label>
              <Input
                id="section-label"
                value={newSectionLabel}
                onChange={(e) => setNewSectionLabel(e.target.value)}
                placeholder="Например: База знаний 2"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={isCreating}
            >
              Отмена
            </Button>
            <Button
              onClick={handleCreateSection}
              disabled={!newSectionLabel.trim() || isCreating}
            >
              {isCreating ? "Создание..." : "Создать и выбрать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить вкладку?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить вкладку "{deleteTarget?.label}"?
              <br />
              <br />
              Это действие нельзя отменить. Если к вкладке привязаны модули, удаление будет невозможно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSection}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
