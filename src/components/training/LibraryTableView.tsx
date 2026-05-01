import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronRight, ChevronDown, Play, BookOpen, Check, Search,
  FileText, Video, Headphones, Clock, Filter,
  AlertCircle, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrainingModule } from "@/hooks/useTrainingModules";
import { useLibraryTree, resolveAccessLabel, shouldFlattenSingleRoot } from "@/hooks/useLibraryTree";
import { useLibraryLessons, type LibraryLesson } from "@/hooks/useLibraryLessons";
import { formatLockedMonth } from "@/hooks/useMonthGate";
import { getStatusBadgeClass } from "@/utils/badgeUtils";
import type { LibraryGroup, LibraryRootModule } from "@/hooks/useLibraryTree";

/* ── localStorage keys ───────────────────────────────── */
const STORAGE_KEY_GROUPS = "library_expanded_groups";
const STORAGE_KEY_MODULES = "library_expanded_modules";

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}
function saveSet(key: string, s: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...s].slice(0, 200)));
}

/* ── Content type icon ───────────────────────────────── */
function LessonTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "video": return <Video className="h-3.5 w-3.5 text-muted-foreground" />;
    case "audio": return <Headphones className="h-3.5 w-3.5 text-muted-foreground" />;
    default: return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

/* ── Props ────────────────────────────────────────────── */
interface LibraryTableViewProps {
  libraryModules: TrainingModule[];
  allModules: TrainingModule[];
}

export function LibraryTableView({ libraryModules, allModules }: LibraryTableViewProps) {
  const navigate = useNavigate();
  const groups = useLibraryTree(libraryModules, allModules);
  const { fetchLessonsForModules, getLessons, isLoading: isLessonLoading, hasError: hasLessonError } = useLibraryLessons();

  /* ── Expand state ─────────────────────────────────── */
  const [userExpandedGroups, setUserExpandedGroups] = useState<Set<string>>(() => loadSet(STORAGE_KEY_GROUPS));
  const [userExpandedModules, setUserExpandedModules] = useState<Set<string>>(() => loadSet(STORAGE_KEY_MODULES));
  const [searchExpandedGroups, setSearchExpandedGroups] = useState<Set<string>>(new Set());
  const [searchExpandedModules, setSearchExpandedModules] = useState<Set<string>>(new Set());

  /* ── Search / filter ──────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyIncomplete, setShowOnlyIncomplete] = useState(false);

  const isSearchActive = searchQuery.trim().length > 0;
  const query = searchQuery.trim().toLowerCase();

  // Effective expanded = user ∪ search (when search active)
  const effectiveExpandedGroups = useMemo(() => {
    if (!isSearchActive) return userExpandedGroups;
    return new Set([...userExpandedGroups, ...searchExpandedGroups]);
  }, [userExpandedGroups, searchExpandedGroups, isSearchActive]);

  const effectiveExpandedModules = useMemo(() => {
    if (!isSearchActive) return userExpandedModules;
    return new Set([...userExpandedModules, ...searchExpandedModules]);
  }, [userExpandedModules, searchExpandedModules, isSearchActive]);

  /* ── Search: auto-expand matching groups/modules ─── */
  useEffect(() => {
    if (!isSearchActive) {
      setSearchExpandedGroups(new Set());
      setSearchExpandedModules(new Set());
      return;
    }
    const sg = new Set<string>();
    const sm = new Set<string>();
    let expandCount = 0;
    const MAX_AUTO_EXPAND = 20;
    for (const g of groups) {
      let groupMatch = false;
      for (const rm of g.rootModules) {
        const titleMatch = rm.module.title.toLowerCase().includes(query);
        if (titleMatch) groupMatch = true;
        for (const child of rm.children) {
          if (child.title.toLowerCase().includes(query)) {
            groupMatch = true;
            if (expandCount < MAX_AUTO_EXPAND) {
              sm.add(rm.module.id);
              expandCount++;
            }
          }
        }
        if (titleMatch && expandCount < MAX_AUTO_EXPAND) {
          sm.add(rm.module.id);
          expandCount++;
        }
      }
      if (groupMatch && expandCount < MAX_AUTO_EXPAND) {
        sg.add(g.productId);
        expandCount++;
      }
    }
    setSearchExpandedGroups(sg);
    setSearchExpandedModules(sm);
  }, [query, isSearchActive, groups]);

  /* ── Toggle helpers ────────────────────────────────── */
  const toggleGroup = useCallback((pid: string) => {
    setUserExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      saveSet(STORAGE_KEY_GROUPS, next);
      return next;
    });
  }, []);

  const toggleModule = useCallback((moduleId: string) => {
    setUserExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId);
      saveSet(STORAGE_KEY_MODULES, next);
      return next;
    });
  }, []);

  /* ── Fetch lessons when modules are expanded ──────── */
  useEffect(() => {
    const ids = new Set([...effectiveExpandedModules]);
    // For flattened groups without children, lessons load when group is expanded
    for (const g of groups) {
      if (g.isFlattenable && g.flattenedRoot && !g.flattenedRoot.hasChildren && effectiveExpandedGroups.has(g.productId)) {
        ids.add(g.flattenedRoot.module.id);
      }
    }
    const arr = [...ids];
    if (arr.length > 0) {
      fetchLessonsForModules(arr);
    }
  }, [effectiveExpandedModules, effectiveExpandedGroups, groups, fetchLessonsForModules]);

  /* ── Filter groups by search + incomplete filter ─── */
  const filteredGroups = useMemo(() => {
    return groups.map((g) => {
      const filteredRoots = g.rootModules.filter((rm) => {
        const lessonCount = rm.module.lesson_count || 0;
        const completedCount = rm.module.completed_count || 0;
        if (showOnlyIncomplete && lessonCount > 0 && completedCount >= lessonCount) return false;
        if (!isSearchActive) return true;
        // Match root title or any child title
        if (rm.module.title.toLowerCase().includes(query)) return true;
        if (rm.children.some((c) => c.title.toLowerCase().includes(query))) return true;
        return false;
      });
      // For flattened groups, also check if the hidden root's children/lessons match
      if (g.isFlattenable && g.flattenedRoot && filteredRoots.length === 0 && isSearchActive) {
        // Check if root title matches (root is hidden but should still be searchable)
        if (g.flattenedRoot.module.title.toLowerCase().includes(query)) {
          return { ...g, rootModules: g.rootModules };
        }
      }
      // Re-check flattenability with filtered roots
      const newFlatten = g.isFlattenable && filteredRoots.length === 1 && g.flattenedRoot?.module.id === filteredRoots[0].module.id;
      return { ...g, rootModules: filteredRoots, isFlattenable: newFlatten, flattenedRoot: newFlatten ? g.flattenedRoot : undefined };
    }).filter((g) => g.rootModules.length > 0);
  }, [groups, query, isSearchActive, showOnlyIncomplete]);

  /* ── Render helpers ────────────────────────────────── */
  const renderProgress = (lessonCount: number, completedCount: number, compact = false) => {
    const safeL = lessonCount || 0;
    const safeC = completedCount || 0;
    const pct = safeL > 0 ? Math.round((safeC / safeL) * 100) : 0;
    return (
      <div className={cn("flex items-center gap-2", compact ? "min-w-0" : "min-w-[120px]")}>
        <Progress value={pct} className="h-1.5 flex-1" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {safeC}/{safeL}
        </span>
      </div>
    );
  };

  const renderActionLabel = (
    lessonCount: number,
    completedCount: number,
    moduleSlug?: string,
    moduleId?: string,
  ) => {
    const safeL = lessonCount || 0;
    const safeC = completedCount || 0;
    if (safeL === 0) return null;

    const resolveTarget = (): string => {
      if (!moduleSlug) return "#";
      const basePath = `/library/${moduleSlug}`;
      if (!moduleId) return basePath;
      const lessons = getLessons(moduleId);
      if (!lessons || lessons.length === 0) return basePath;

      if (safeC > 0 && safeC < safeL) {
        // Continue: first incomplete, non-scheduled lesson
        const next = lessons.find((l) => !l.is_completed && !l.isScheduled)
          || lessons.find((l) => !l.is_completed)
          || lessons[0];
        return `${basePath}/${next.slug}`;
      }
      if (safeC === 0) {
        // Start: first available lesson
        const first = lessons.find((l) => !l.isScheduled) || lessons[0];
        return `${basePath}/${first.slug}`;
      }
      // Completed: go to module
      return basePath;
    };

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(resolveTarget());
    };

    if (safeC >= safeL) {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-primary font-medium cursor-pointer hover:underline"
          onClick={handleClick}
        >
          <Check className="h-3 w-3" />
          <span className="hidden sm:inline">Завершено</span>
        </span>
      );
    }
    if (safeC > 0) {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-primary font-medium cursor-pointer hover:underline"
          onClick={handleClick}
        >
          <Play className="h-3 w-3" />
          <span className="hidden sm:inline">Продолжить</span>
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-primary font-medium cursor-pointer hover:underline"
        onClick={handleClick}
      >
        <Play className="h-3 w-3" />
        <span className="hidden sm:inline">Начать</span>
      </span>
    );
  };

  /* ── Lesson row ──────────────────────────────────── */
  const renderLessonRow = (lesson: LibraryLesson, moduleSlug: string, depth: number) => {
    const indent = depth * 24 + 16;
    return (
      <TableRow
        key={lesson.id}
        className="cursor-pointer hover:bg-muted/30 group/lesson"
        onClick={() => navigate(`/library/${moduleSlug}/${lesson.slug}`)}
      >
        <TableCell className="py-2">
          <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
            <LessonTypeIcon type={lesson.content_type} />
            <span className={cn(
              "text-sm",
              lesson.is_completed && "text-muted-foreground line-through",
              lesson.isScheduled && "text-muted-foreground italic"
            )}>
              {lesson.title}
            </span>
            {lesson.isScheduled && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                Скоро
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="py-2 hidden sm:table-cell">
          {lesson.duration_minutes ? (
            <span className="text-xs text-muted-foreground">{lesson.duration_minutes} мин</span>
          ) : null}
        </TableCell>
        <TableCell className="py-2 hidden sm:table-cell" />
        <TableCell className="py-2">
          {lesson.is_completed ? (
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <Check className="h-3 w-3" />
            </span>
          ) : lesson.isScheduled ? null : (
            <span className="text-xs text-primary opacity-0 group-hover/lesson:opacity-100 transition-opacity">
              Открыть
            </span>
          )}
        </TableCell>
      </TableRow>
    );
  };

  /* ── Module lessons block ─────────────────────────── */
  const renderModuleLessons = (moduleId: string, moduleSlug: string, depth: number) => {
    if (isLessonLoading(moduleId)) {
      return (
        <TableRow key={`loading-${moduleId}`}>
          <TableCell colSpan={4} className="py-2">
            <div className="flex items-center gap-2" style={{ paddingLeft: depth * 24 + 16 }}>
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-3 w-32 rounded" />
            </div>
          </TableCell>
        </TableRow>
      );
    }
    if (hasLessonError(moduleId)) {
      return (
        <TableRow key={`error-${moduleId}`}>
          <TableCell colSpan={4} className="py-2">
            <div className="flex items-center gap-2 text-destructive text-xs" style={{ paddingLeft: depth * 24 + 16 }}>
              <AlertCircle className="h-3.5 w-3.5" />
              Ошибка загрузки уроков
            </div>
          </TableCell>
        </TableRow>
      );
    }
    const lessons = getLessons(moduleId);
    if (lessons.length === 0) {
      return (
        <TableRow key={`empty-${moduleId}`}>
          <TableCell colSpan={4} className="py-2">
            <span className="text-xs text-muted-foreground" style={{ paddingLeft: depth * 24 + 16, display: "inline-block" }}>
              Уроков пока нет
            </span>
          </TableCell>
        </TableRow>
      );
    }
    return lessons.map((l) => renderLessonRow(l, moduleSlug, depth));
  };

  /* ── Child module row ────────────────────────────── */
  const renderChildModule = (child: TrainingModule, parentSlug: string) => {
    const isExpanded = effectiveExpandedModules.has(child.id);
    const lessonCount = child.lesson_count || 0;
    const completedCount = child.completed_count || 0;
    return [
      <TableRow key={child.id} className="hover:bg-muted/30">
        <TableCell className="py-2">
          <div className="flex items-center gap-2" style={{ paddingLeft: 40 }}>
            <button
              onClick={(e) => { e.stopPropagation(); toggleModule(child.id); }}
              className="p-0.5 rounded hover:bg-muted transition-colors"
            >
              {isExpanded
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              }
            </button>
            <span
              className="text-sm font-medium cursor-pointer hover:text-primary transition-colors"
              onClick={() => navigate(`/library/${child.slug}`)}
            >
              {child.title}
            </span>
          </div>
        </TableCell>
        <TableCell className="py-2 hidden sm:table-cell">
          <span className="text-xs text-muted-foreground">{lessonCount}</span>
        </TableCell>
        <TableCell className="py-2 hidden sm:table-cell">
          {renderProgress(lessonCount, completedCount, true)}
        </TableCell>
        <TableCell className="py-2">
          {renderActionLabel(lessonCount, completedCount, child.slug, child.id)}
        </TableCell>
      </TableRow>,
      ...(isExpanded ? [renderModuleLessons(child.id, child.slug, 3)] : []),
    ].flat();
  };

  /* ── Root module row ──────────────────────────────── */
  const renderRootModule = (rm: LibraryRootModule, groupExpanded: boolean) => {
    if (!groupExpanded) return null;
    const isExpanded = effectiveExpandedModules.has(rm.module.id);
    const lessonCount = rm.module.lesson_count || 0;
    const completedCount = rm.module.completed_count || 0;
    const hasExpandable = rm.hasChildren || lessonCount > 0;

    return [
      <TableRow key={rm.module.id} className="hover:bg-muted/40">
        <TableCell className="py-2.5">
          <div className="flex items-center gap-2" style={{ paddingLeft: 16 }}>
            {hasExpandable ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleModule(rm.module.id); }}
                className="p-0.5 rounded hover:bg-muted transition-colors"
              >
                {isExpanded
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
              </button>
            ) : (
              <div className="w-5" />
            )}
            {rm.module.color_gradient && (
              <div className={cn("w-1 h-5 rounded-full bg-gradient-to-b", rm.module.color_gradient)} />
            )}
            <span
              className="text-sm font-semibold cursor-pointer hover:text-primary transition-colors"
              onClick={() => navigate(`/library/${rm.module.slug}`)}
            >
              {rm.module.title}
            </span>
          </div>
        </TableCell>
        <TableCell className="py-2.5 hidden sm:table-cell">
          <span className="text-xs text-muted-foreground">{lessonCount}</span>
        </TableCell>
        <TableCell className="py-2.5 hidden sm:table-cell">
          {renderProgress(lessonCount, completedCount)}
        </TableCell>
        <TableCell className="py-2.5">
          <div className="flex items-center gap-2">
            {renderActionLabel(lessonCount, completedCount, rm.module.slug, rm.module.id)}
          </div>
        </TableCell>
      </TableRow>,
      ...(isExpanded && rm.hasChildren
        ? rm.children.flatMap((c) => renderChildModule(c, rm.module.slug))
        : []),
      ...(isExpanded && !rm.hasChildren
        ? [renderModuleLessons(rm.module.id, rm.module.slug, 2)]
        : []),
    ].flat();
  };

  /* ── Group row ────────────────────────────────────── */
  const renderGroup = (group: LibraryGroup) => {
    const isExpanded = effectiveExpandedGroups.has(group.productId);
    const isFlat = group.isFlattenable && group.flattenedRoot;

    // For flattened groups, data comes from flattenedRoot
    const flatRoot = isFlat ? group.flattenedRoot! : undefined;
    const displayLessons = isFlat ? (flatRoot!.module.lesson_count || 0) : group.totalLessons;
    const displayCompleted = isFlat ? (flatRoot!.module.completed_count || 0) : group.totalCompleted;

    return [
      // Group header row — always shown
      <TableRow
        key={`group-${group.productId}`}
        className="bg-muted/20 hover:bg-muted/40"
      >
        <TableCell className="py-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); toggleGroup(group.productId); }}
              className="p-0.5 rounded hover:bg-muted transition-colors"
            >
              {isExpanded
                ? <ChevronDown className="h-4 w-4 text-foreground" />
                : <ChevronRight className="h-4 w-4 text-foreground" />
              }
            </button>
            {isFlat && flatRoot!.module.color_gradient && (
              <div className={cn("w-1 h-5 rounded-full bg-gradient-to-b", flatRoot!.module.color_gradient)} />
            )}
            <span
              className={cn(
                "text-sm font-semibold",
                isFlat && "cursor-pointer hover:text-primary transition-colors"
              )}
              onClick={isFlat ? (e: React.MouseEvent) => { e.stopPropagation(); navigate(`/library/${flatRoot!.module.slug}`); } : undefined}
            >
              {group.productName}
            </span>
            {isFlat && flatRoot && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                {flatRoot.accessLabel}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="py-2.5 hidden sm:table-cell">
          <span className="text-xs text-muted-foreground">{displayLessons}</span>
        </TableCell>
        <TableCell className="py-2.5 hidden sm:table-cell">
          {renderProgress(displayLessons, displayCompleted)}
        </TableCell>
        <TableCell className="py-2.5">
          {isFlat
            ? renderActionLabel(displayLessons, displayCompleted, flatRoot!.module.slug, flatRoot!.module.id)
            : renderActionLabel(displayLessons, displayCompleted)
          }
        </TableCell>
      </TableRow>,

      // Content rows
      ...(isFlat
        // Flattened: skip root module row, render children/lessons directly
        ? (isExpanded
          ? (flatRoot!.hasChildren
            ? flatRoot!.children.flatMap((c) => renderChildModule(c, flatRoot!.module.slug))
            : [renderModuleLessons(flatRoot!.module.id, flatRoot!.module.slug, 1)].flat()
          )
          : []
        )
        // Normal: render root modules
        : (isExpanded
          ? group.rootModules.flatMap((rm) => renderRootModule(rm, true) || [])
          : []
        )
      ),
    ];
  };

  /* ── Empty state ───────────────────────────────────── */
  if (filteredGroups.length === 0 && !isSearchActive && !showOnlyIncomplete) {
    return null; // Parent handles empty state
  }

  return (
    <div className="space-y-3">
      {/* Search & filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по модулям и урокам..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Button
          variant={showOnlyIncomplete ? "default" : "outline"}
          size="sm"
          className="h-9 text-xs gap-1.5"
          onClick={() => setShowOnlyIncomplete((v) => !v)}
        >
          <Filter className="h-3.5 w-3.5" />
          Незавершённые
        </Button>
      </div>

      {/* Filtered empty */}
      {filteredGroups.length === 0 && (isSearchActive || showOnlyIncomplete) && (
        <div className="text-center py-10">
          <Search className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            {isSearchActive ? `Ничего не найдено по запросу «${searchQuery}»` : "Все модули завершены!"}
          </p>
        </div>
      )}

      {/* Table */}
      {filteredGroups.length > 0 && (
        <div className="rounded-lg border border-border/50 overflow-hidden bg-card/50 backdrop-blur-sm">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-medium">Название</TableHead>
                <TableHead className="text-xs font-medium w-[70px] hidden sm:table-cell">Уроков</TableHead>
                <TableHead className="text-xs font-medium w-[160px] hidden sm:table-cell">Прогресс</TableHead>
                <TableHead className="text-xs font-medium w-[100px]">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGroups.flatMap((g) => renderGroup(g))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
