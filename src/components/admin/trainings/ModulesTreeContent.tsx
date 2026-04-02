import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronRight,
  ChevronDown,
  BookOpen,
  Eye,
  EyeOff,
  FolderOpen,
  Folder,
  Pencil,
  Trash2,
  Copy,
  FileText,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrainingModule } from "@/hooks/useTrainingModules";
import {
  buildModuleTree,
  sortItems,
  loadExpandedIds,
  filterExpandedIds,
  toggleExpandedId,
  type ModuleTreeNodeWithData,
  type SortMode,
} from "./moduleTreeUtils";

const STORAGE_KEY = "admin_training_modules.expanded";

interface SimpleLessonRow {
  id: string;
  title: string;
  module_id: string;
  sort_order: number;
  created_at: string;
  completion_mode: string | null;
}

interface ModulesTreeContentProps {
  modules: TrainingModule[];
  onEdit: (module: TrainingModule) => void;
  onDelete: (id: string) => void;
  onOpenLessons: (moduleId: string) => void;
  onCopyMove: (module: TrainingModule) => void;
  onOpenLessonViewers?: (lesson: SimpleLessonRow) => void;
  sortMode?: SortMode;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
}

/* ── Gradient color map for soft card accents ── */
const GRADIENT_COLOR_MAP: Record<string, { from: string; to: string }> = {
  "from-pink-500 to-fuchsia-600": { from: "#ec489930", to: "#c026d330" },
  "from-blue-500 to-cyan-500": { from: "#3b82f630", to: "#06b6d430" },
  "from-green-500 to-emerald-500": { from: "#22c55e30", to: "#10b98130" },
  "from-orange-500 to-amber-500": { from: "#f9731630", to: "#f59e0b30" },
  "from-purple-500 to-violet-500": { from: "#a855f730", to: "#8b5cf630" },
  "from-red-500 to-rose-500": { from: "#ef444430", to: "#f43f5e30" },
  "from-indigo-500 to-purple-500": { from: "#6366f130", to: "#a855f730" },
  "from-teal-500 to-cyan-500": { from: "#14b8a630", to: "#06b6d430" },
};
const DEFAULT_GRADIENT = { from: "#a855f720", to: "#6366f120" };

function getGradientColors(gradient: string | null | undefined) {
  if (!gradient) return DEFAULT_GRADIENT;
  return GRADIENT_COLOR_MAP[gradient] || DEFAULT_GRADIENT;
}

/**
 * Compute indeterminate state for a parent checkbox:
 * - checked: all descendants selected
 * - indeterminate: some descendants selected
 * - unchecked: none selected
 */
function getCheckState(
  node: ModuleTreeNodeWithData<SimpleLessonRow>,
  selectedIds: Set<string>,
): "checked" | "indeterminate" | "unchecked" {
  const allIds: string[] = [];
  const collectIds = (n: ModuleTreeNodeWithData<SimpleLessonRow>) => {
    allIds.push(n.module.id);
    n.children.forEach(collectIds);
  };
  collectIds(node);

  const selectedCount = allIds.filter((id) => selectedIds.has(id)).length;
  if (selectedCount === 0) return "unchecked";
  if (selectedCount === allIds.length) return "checked";
  return "indeterminate";
}

/* ── Module node ── */
function ModuleTreeNode({
  node,
  depth,
  expandedIds,
  onToggle,
  onEdit,
  onDelete,
  onOpenLessons,
  onCopyMove,
  onOpenLessonViewers,
  selectionMode,
  selectedIds,
  onToggleSelection,
}: {
  node: ModuleTreeNodeWithData<SimpleLessonRow>;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (m: TrainingModule) => void;
  onDelete: (id: string) => void;
  onOpenLessons: (moduleId: string) => void;
  onCopyMove: (m: TrainingModule) => void;
  onOpenLessonViewers?: (lesson: SimpleLessonRow) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const isOpen = expandedIds.has(node.module.id);
  const hasContent = node.children.length > 0 || node.items.length > 0;
  const colors = getGradientColors(node.module.color_gradient);

  const checkState = selectionMode && selectedIds
    ? getCheckState(node, selectedIds)
    : "unchecked";

  return (
    <div className={cn(depth > 0 && "ml-4")}>
      <Collapsible open={isOpen} onOpenChange={() => onToggle(node.module.id)}>
        <div
          className={cn(
            "group relative overflow-hidden rounded-xl transition-all duration-200",
            "backdrop-blur-xl bg-card/60 dark:bg-card/40",
            "border border-border/40 hover:border-border/70",
            "shadow-sm hover:shadow-md mb-1.5",
            selectionMode && selectedIds?.has(node.module.id) && "ring-2 ring-primary/40",
          )}
        >
          {/* Soft gradient overlay */}
          <div
            className="absolute inset-0 pointer-events-none rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${colors.from}, ${colors.to})`,
              opacity: 0.35,
            }}
          />

          <div className="relative z-10 flex items-center gap-2 px-3 py-2">
            {/* Selection checkbox */}
            {selectionMode && onToggleSelection && (
              <Checkbox
                checked={checkState === "checked"}
                // @ts-ignore — radix supports indeterminate via "indeterminate" prop
                {...(checkState === "indeterminate" ? { "data-state": "indeterminate" } : {})}
                onCheckedChange={() => onToggleSelection(node.module.id)}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "shrink-0",
                  checkState === "indeterminate" && "data-[state=indeterminate]:bg-primary/50",
                )}
              />
            )}

            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {hasContent ? (
                  isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )
                ) : (
                  <div className="w-4" />
                )}
                {isOpen ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-primary/70" />
                )}
                <span className="font-medium text-sm truncate">{node.module.title}</span>
              </button>
            </CollapsibleTrigger>

            {/* Badges */}
            <div className="flex items-center gap-1 shrink-0">
              <Badge
                variant={node.module.is_active ? "default" : "secondary"}
                className={cn(
                  "text-[10px] px-1.5 py-0 gap-0.5",
                  node.module.is_active && "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
                )}
              >
                {node.module.is_active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </Badge>
              {(node.module.lesson_count ?? 0) > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 bg-background/50">
                  <BookOpen className="h-3 w-3" />
                  {node.module.lesson_count}
                </Badge>
              )}
            </div>

            {/* Actions */}
            {!selectionMode && (
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); onOpenLessons(node.module.id); }}
                  title="Уроки"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); onCopyMove(node.module); }}
                  title="Копировать / Переместить"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); onEdit(node.module); }}
                  title="Редактировать"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete(node.module.id); }}
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-0.5 ml-2">
            {/* Submodules */}
            {node.children.map((child) => (
              <ModuleTreeNode
                key={child.module.id}
                node={child}
                depth={depth + 1}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
                onOpenLessons={onOpenLessons}
                onCopyMove={onCopyMove}
                onOpenLessonViewers={onOpenLessonViewers}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelection={onToggleSelection}
              />
            ))}
            {/* Lessons */}
            {node.items.map((lesson) => (
              <div
                key={lesson.id}
                className={cn(
                  "group/lesson flex items-center gap-2 px-3 py-1.5 rounded-lg",
                  "hover:bg-muted/50 transition-colors cursor-pointer",
                  depth > 0 && "ml-4",
                )}
                onClick={() => navigate(`/admin/training-lessons/${lesson.module_id}/edit/${lesson.id}`)}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm truncate flex-1">{lesson.title}</span>
                <Badge
                  variant={lesson.completion_mode === "kvest" ? "default" : "secondary"}
                  className="text-[10px] px-1.5 py-0 shrink-0"
                >
                  {lesson.completion_mode === "kvest" ? "Квест" : "Обычный"}
                </Badge>
                {/* Hover action buttons */}
                {!selectionMode && (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/lesson:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/admin/training-lessons/${lesson.module_id}/edit/${lesson.id}`);
                      }}
                      title="Контент"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (lesson.completion_mode === "kvest") {
                          navigate(`/admin/training-lessons/${lesson.module_id}/progress/${lesson.id}`);
                        } else if (onOpenLessonViewers) {
                          onOpenLessonViewers(lesson);
                        } else {
                          onOpenLessons(lesson.module_id);
                        }
                      }}
                      title="Прогресс / просмотры"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenLessons(lesson.module_id);
                      }}
                      title="Уроки модуля"
                    >
                      <List className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/* ── Main component ── */
export function ModulesTreeContent({
  modules,
  onEdit,
  onDelete,
  onOpenLessons,
  onCopyMove,
  onOpenLessonViewers,
  sortMode = "order",
  selectionMode,
  selectedIds,
  onToggleSelection,
}: ModulesTreeContentProps) {
  const moduleIds = useMemo(() => modules.map((m) => m.id), [modules]);
  const moduleIdsKey = useMemo(() => moduleIds.slice().sort().join(","), [moduleIds]);

  // Expanded state with localStorage persistence
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => loadExpandedIds(STORAGE_KEY));
  const didAutoOpenRef = useRef(false);

  // Filter stale IDs when modules change
  useEffect(() => {
    const validIds = new Set(moduleIds);
    setExpandedIds((prev) => {
      const filtered = filterExpandedIds(prev, validIds);
      if (filtered.size !== prev.size) {
        const arr = Array.from(filtered).slice(0, 500);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      }
      return filtered;
    });
  }, [moduleIdsKey]);

  // Fetch lessons only when tree is rendered (list mode)
  const { data: lessons, isLoading } = useQuery({
    queryKey: ["modules-tree-lessons", moduleIdsKey],
    queryFn: async () => {
      if (moduleIds.length === 0) return [];
      const { data, error } = await supabase
        .from("training_lessons")
        .select("id, title, module_id, sort_order, created_at, completion_mode")
        .in("module_id", moduleIds)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as SimpleLessonRow[];
    },
    enabled: moduleIds.length > 0,
  });

  const tree = useMemo(() => {
    return buildModuleTree<SimpleLessonRow>(
      modules,
      lessons || [],
      sortMode,
      sortItems as any,
    );
  }, [modules, lessons, sortMode]);

  // Auto-open single root (once per component mount)
  useEffect(() => {
    if (!didAutoOpenRef.current && expandedIds.size === 0 && tree.length === 1) {
      didAutoOpenRef.current = true;
      setExpandedIds(new Set([tree[0].module.id]));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([tree[0].module.id]));
    }
  }, [tree]);

  const handleToggle = useCallback(
    (id: string) => {
      setExpandedIds((prev) => toggleExpandedId(prev, id, STORAGE_KEY));
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (tree.length === 0) {
    return null; // Parent handles empty state
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <ModuleTreeNode
          key={node.module.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          onToggle={handleToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onOpenLessons={onOpenLessons}
          onCopyMove={onCopyMove}
          onOpenLessonViewers={onOpenLessonViewers}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelection={onToggleSelection}
        />
      ))}
    </div>
  );
}
