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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["all-page-sections"] });
      queryClient.invalidateQueries({ queryKey: ["page-sections-tabs"] });
      queryClient.invalidateQueries({ queryKey: ["user-menu-sections"] });

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

        <PopoverContent className="w-[420px] p-0" align="start">
          <div className="flex border-b">
            {/* Left column: Parents */}
            <ScrollArea className="w-1/2 h-[300px] border-r">
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
            </ScrollArea>

            {/* Right column: Children */}
            <ScrollArea className="w-1/2 h-[300px]">
              <div className="p-1">
                {selectedParent ? (
                  <>
                    {children.map((child: PageSection) => {
                      const Icon = getIcon(child.icon);
                      const isSelected = value === child.key;

                      return (
                        <div
                          key={child.key}
                          onClick={() => {
                            onChange(child.key);
                            setOpen(false);
                          }}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2.5 rounded-md cursor-pointer transition-colors",
                            isSelected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate text-sm">
                            {child.label}
                          </span>
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0" />
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
            </ScrollArea>
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
    </div>
  );
}
