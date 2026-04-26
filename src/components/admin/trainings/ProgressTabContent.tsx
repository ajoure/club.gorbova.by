import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Users, ChevronRight, ChevronDown, BookOpen, Eye, ArrowDownAZ, ArrowDown01, FolderOpen, Folder, FileText } from "lucide-react";
import { LessonViewersModal } from "./LessonViewersModal";
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

const STORAGE_KEY = "admin_training_progress.expanded";

/* ── Gradient color map (same as ModulesTreeContent for unified style) ── */
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

interface ProgressTabContentProps {
  modules: TrainingModule[];
}

interface LessonWithProgress {
  id: string;
  title: string;
  module_id: string;
  completion_mode: string | null;
  sort_order: number;
  created_at: string;
  studentCount: number;
  completedCount: number;
}

// Recursive component for rendering module tree — unified glass style
function ModuleNode({
  node,
  depth,
  onLessonClick,
  expandedIds,
  onToggle,
}: {
  node: ModuleTreeNodeWithData<LessonWithProgress>;
  depth: number;
  onLessonClick: (lesson: LessonWithProgress) => void;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasContent = node.children.length > 0 || node.items.length > 0;
  const isOpen = expandedIds.has(node.module.id);
  const colors = getGradientColors(node.module.color_gradient);

  const totalStudents = node.items.reduce((s, l) => s + l.studentCount, 0);
  const totalCompleted = node.items.reduce((s, l) => s + l.completedCount, 0);

  if (!hasContent) {
    return (
      <div className={cn("flex items-center gap-2 py-2 px-3 text-sm text-muted-foreground rounded-xl", depth > 0 && "ml-4")}>
        <Folder className="h-4 w-4 text-primary/50" />
        <span>{node.module.title}</span>
        <span className="text-xs">(пусто)</span>
      </div>
    );
  }

  return (
    <div className={cn(depth > 0 && "ml-4")}>
      <Collapsible open={isOpen} onOpenChange={() => onToggle(node.module.id)}>
        {/* Glass-style module card — unified with ModulesTreeContent */}
        <div
          className={cn(
            "group relative overflow-hidden rounded-xl transition-all duration-200",
            "backdrop-blur-xl bg-card/60 dark:bg-card/40",
            "border border-border/40 hover:border-border/70",
            "shadow-sm hover:shadow-md mb-1.5",
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

          <CollapsibleTrigger asChild>
            <button className="relative z-10 w-full flex items-center gap-2 px-3 py-2 text-left">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              {isOpen ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-primary/70" />
              )}
              <span className="font-medium text-sm flex-1 truncate">{node.module.title}</span>
              <div className="flex items-center gap-1 shrink-0">
                {totalStudents > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 font-normal">
                    <Users className="h-3 w-3" />
                    {totalStudents}
                  </Badge>
                )}
                {totalCompleted > 0 && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-0.5 font-normal">
                    ✓ {totalCompleted}
                  </Badge>
                )}
              </div>
            </button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="space-y-0.5 ml-2">
            {/* Submodules */}
            {node.children.map((child) => (
              <ModuleNode
                key={child.module.id}
                node={child}
                depth={depth + 1}
                onLessonClick={onLessonClick}
                expandedIds={expandedIds}
                onToggle={onToggle}
              />
            ))}
            {/* Lessons — compact rows, unified with ModulesTreeContent */}
            {node.items.map((lesson) => (
              <button
                key={lesson.id}
                onClick={() => onLessonClick(lesson)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 rounded-lg",
                  "hover:bg-muted/50 transition-colors text-left",
                  depth > 0 && "ml-4",
                )}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm truncate flex-1">{lesson.title}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 font-normal">
                    <Users className="h-3 w-3" />
                    {lesson.studentCount}
                  </Badge>
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-0.5 font-normal">
                    ✓ {lesson.completedCount}
                  </Badge>
                  <Badge
                    variant={lesson.completion_mode === "kvest" ? "default" : "secondary"}
                    className="text-[10px] px-1.5 py-0 shrink-0"
                  >
                    {lesson.completion_mode === "kvest" ? "Квест" : "Обычный"}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function ProgressTabContent({ modules }: ProgressTabContentProps) {
  const navigate = useNavigate();
  const [viewerModal, setViewerModal] = useState<{ lessonId: string; title: string } | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    return (localStorage.getItem("training_progress_sort_mode") as SortMode) || "order";
  });

  // Expanded state with localStorage persistence
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => loadExpandedIds(STORAGE_KEY));
  const didAutoOpenRef = useRef(false);

  const moduleIds = useMemo(() => modules.map((m) => m.id), [modules]);
  const moduleIdsKey = useMemo(() => moduleIds.slice().sort().join(","), [moduleIds]);

  // Filter stale IDs — stable dependency via moduleIdsKey
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

  const { data: allLessons, isLoading } = useQuery({
    queryKey: ["all-lessons-progress", moduleIdsKey],
    queryFn: async () => {
      if (moduleIds.length === 0) return [];

      const { data: lessons, error } = await supabase
        .from("training_lessons")
        .select("id, title, module_id, completion_mode, sort_order, created_at")
        .in("module_id", moduleIds)
        .order("sort_order");

      if (error) throw error;

      const lessonIds = lessons?.map((l) => l.id) || [];
      if (lessonIds.length === 0) return [];

      const kvestLessonIds = lessons?.filter((l) => l.completion_mode === "kvest").map((l) => l.id) || [];
      const normalLessonIds = lessons?.filter((l) => l.completion_mode !== "kvest").map((l) => l.id) || [];

      const kvestProgressMap = new Map<string, { total: number; completed: number }>();
      const normalProgressMap = new Map<string, { total: number; completed: number }>();

      if (kvestLessonIds.length > 0) {
        const { data: kvestData } = await supabase
          .from("lesson_progress_state")
          .select("lesson_id, completed_at")
          .in("lesson_id", kvestLessonIds);

        kvestData?.forEach((p) => {
          const current = kvestProgressMap.get(p.lesson_id) || { total: 0, completed: 0 };
          current.total++;
          if (p.completed_at) current.completed++;
          kvestProgressMap.set(p.lesson_id, current);
        });
      }

      if (normalLessonIds.length > 0) {
        const { data: normalData } = await supabase
          .from("lesson_progress")
          .select("lesson_id, completed_at")
          .in("lesson_id", normalLessonIds);

        normalData?.forEach((p) => {
          const current = normalProgressMap.get(p.lesson_id) || { total: 0, completed: 0 };
          current.total++;
          if (p.completed_at) current.completed++;
          normalProgressMap.set(p.lesson_id, current);
        });
      }

      return lessons?.map((lesson) => {
        const isKvest = lesson.completion_mode === "kvest";
        const progressMap = isKvest ? kvestProgressMap : normalProgressMap;
        return {
          id: lesson.id,
          title: lesson.title,
          module_id: lesson.module_id,
          completion_mode: lesson.completion_mode,
          sort_order: lesson.sort_order ?? 0,
          created_at: lesson.created_at,
          studentCount: progressMap.get(lesson.id)?.total || 0,
          completedCount: progressMap.get(lesson.id)?.completed || 0,
        } as LessonWithProgress;
      }) || [];
    },
    enabled: moduleIds.length > 0,
  });

  const tree = useMemo(() => {
    if (!allLessons) return [];
    return buildModuleTree<LessonWithProgress>(
      modules,
      allLessons,
      sortMode,
      sortItems as any,
    );
  }, [modules, allLessons, sortMode]);

  // Auto-open single root (once per component mount)
  useEffect(() => {
    if (!didAutoOpenRef.current && expandedIds.size === 0 && tree.length === 1) {
      didAutoOpenRef.current = true;
      const rootId = tree[0].module.id;
      setExpandedIds(new Set([rootId]));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([rootId]));
    }
  }, [tree]);

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => toggleExpandedId(prev, id, STORAGE_KEY));
  }, []);

  const handleSortToggle = () => {
    const next = sortMode === "order" ? "alpha" : "order";
    setSortMode(next);
    localStorage.setItem("training_progress_sort_mode", next);
  };

  const handleLessonClick = (lesson: LessonWithProgress) => {
    // Канонический экран прогресса урока — единый для всех completion_mode
    // (kvest и manual). AdminLessonProgress сам мерджит lesson_progress_state +
    // user_lesson_progress, показывает статусы, аналитику портфеля, связь,
    // CSV-экспорт и StudentProgressModal с полными ответами учеников.
    navigate(`/admin/training-lessons/${lesson.module_id}/progress/${lesson.id}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-2 mt-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!allLessons?.length && tree.length === 0) {
    return (
      <div className="mt-4 relative overflow-hidden rounded-2xl backdrop-blur-xl bg-card/60 dark:bg-card/40 border border-border/50 shadow-lg p-12 text-center">
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
        <div className="relative">
          <Users className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">Нет данных</h3>
          <p className="text-muted-foreground">Создайте уроки для отслеживания прогресса учеников</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Sort controls */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Прогресс учеников по модулям и урокам</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSortToggle}
          className="gap-1.5 text-xs"
        >
          {sortMode === "alpha" ? (
            <>
              <ArrowDownAZ className="h-3.5 w-3.5" />
              По алфавиту
            </>
          ) : (
            <>
              <ArrowDown01 className="h-3.5 w-3.5" />
              По порядку
            </>
          )}
        </Button>
      </div>

      {/* Module tree */}
      <div className="space-y-0.5">
        {tree.map((node) => (
          <ModuleNode
            key={node.module.id}
            node={node}
            depth={0}
            onLessonClick={handleLessonClick}
            expandedIds={expandedIds}
            onToggle={handleToggle}
          />
        ))}
      </div>

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
    </div>
  );
}
