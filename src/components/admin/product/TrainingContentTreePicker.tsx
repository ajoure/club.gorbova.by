import { useState, useMemo, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, BookOpen, FileText, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeModule, TreeLesson } from "@/hooks/useTrainingContentRules";

interface Props {
  tree: TreeModule;
  selectedModuleIds: string[];
  selectedLessonIds: string[];
  onChange: (moduleIds: string[], lessonIds: string[]) => void;
}

// === Recursive tree helpers ===

/** Collect all descendant module IDs (excluding root itself) */
function collectAllModuleIds(node: TreeModule): string[] {
  const ids: string[] = [];
  node.children.forEach(c => { ids.push(c.id); ids.push(...collectAllModuleIds(c)); });
  return ids;
}

/** Collect all lesson IDs under a subtree */
function collectAllLessonIds(node: TreeModule): string[] {
  const ids: string[] = [];
  node.lessons.forEach(l => ids.push(l.id));
  node.children.forEach(c => ids.push(...collectAllLessonIds(c)));
  return ids;
}

/** Collect all descendant module IDs + all lesson IDs under a module (the whole branch) */
function collectBranchIds(node: TreeModule): { moduleIds: string[]; lessonIds: string[] } {
  const moduleIds: string[] = [];
  const lessonIds: string[] = [];
  const walk = (n: TreeModule) => {
    n.lessons.forEach(l => lessonIds.push(l.id));
    n.children.forEach(c => {
      moduleIds.push(c.id);
      walk(c);
    });
  };
  walk(node);
  return { moduleIds, lessonIds };
}

function findModule(tree: TreeModule, id: string): TreeModule | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findModule(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Tree picker for partial training_content access.
 * Hierarchical selection:
 * - root checkbox = entire training
 * - module checkbox = all lessons in the branch
 * - lesson checkbox = single lesson
 * - if all lessons of a module are selected individually, module auto-checks
 * - partial selection = indeterminate
 */
export function TrainingContentTreePicker({ tree, selectedModuleIds, selectedLessonIds, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    set.add(tree.id);
    tree.children.forEach(c => set.add(c.id));
    return set;
  });

  const modSet = useMemo(() => new Set(selectedModuleIds), [selectedModuleIds]);
  const lesSet = useMemo(() => new Set(selectedLessonIds), [selectedLessonIds]);

  // All module IDs (excluding root)
  const allModuleIds = useMemo(() => collectAllModuleIds(tree), [tree]);
  const allLessonIds = useMemo(() => collectAllLessonIds(tree), [tree]);

  // === Check state for a module (recursive) ===
  const getModuleCheckState = useCallback((mod: TreeModule): "checked" | "unchecked" | "indeterminate" => {
    // If explicitly selected as module
    if (modSet.has(mod.id)) return "checked";

    const ownLessonIds = mod.lessons.map(l => l.id);
    const childStates = mod.children.map(c => getModuleCheckState(c));

    const allOwnLessonsSelected = ownLessonIds.length > 0 && ownLessonIds.every(id => lesSet.has(id));
    const someOwnLessonsSelected = ownLessonIds.some(id => lesSet.has(id));
    const allChildrenChecked = mod.children.length > 0 && childStates.every(s => s === "checked");
    const someChildrenSelected = childStates.some(s => s !== "unchecked");

    const hasContent = ownLessonIds.length > 0 || mod.children.length > 0;

    // All content checked → auto-promote to checked
    if (hasContent) {
      const ownOk = ownLessonIds.length === 0 || allOwnLessonsSelected;
      const childOk = mod.children.length === 0 || allChildrenChecked;
      if (ownOk && childOk) return "checked";
    }

    // Partial selection
    if (someOwnLessonsSelected || someChildrenSelected) return "indeterminate";

    return "unchecked";
  }, [modSet, lesSet]);

  // Root "all" state
  const rootState = useMemo(() => {
    const hasModules = allModuleIds.length > 0;
    const hasRootLessons = tree.lessons.length > 0;
    if (!hasModules && !hasRootLessons) return "unchecked" as const;

    const allModsSelected = !hasModules || allModuleIds.every(id => modSet.has(id));
    const allRootLessonsSelected = !hasRootLessons || tree.lessons.every(l => lesSet.has(l.id));

    if (allModsSelected && allRootLessonsSelected && (hasModules || hasRootLessons)) return "checked" as const;
    if (modSet.size > 0 || lesSet.size > 0) return "indeterminate" as const;
    return "unchecked" as const;
  }, [allModuleIds, tree.lessons, modSet, lesSet]);

  // === Actions ===

  const handleSelectAll = () => {
    if (rootState === "checked") {
      onChange([], []);
    } else {
      // Select all modules + root-level lessons (not covered by any module)
      onChange([...allModuleIds], [...tree.lessons.map(l => l.id)]);
    }
  };

  const toggleModule = useCallback((mod: TreeModule) => {
    const state = getModuleCheckState(mod);

    if (state === "checked" || state === "indeterminate") {
      // Deselect entire branch
      const branch = collectBranchIds(mod);
      const toRemoveModules = new Set([mod.id, ...branch.moduleIds]);
      const toRemoveLessons = new Set([...mod.lessons.map(l => l.id), ...branch.lessonIds]);
      onChange(
        selectedModuleIds.filter(id => !toRemoveModules.has(id)),
        selectedLessonIds.filter(id => !toRemoveLessons.has(id))
      );
    } else {
      // Select entire branch: add this module + all descendant modules
      const branch = collectBranchIds(mod);
      const newModules = new Set([...selectedModuleIds, mod.id, ...branch.moduleIds]);
      // Remove individual lesson selections covered by modules
      const coveredLessons = new Set([...mod.lessons.map(l => l.id), ...branch.lessonIds]);
      onChange(
        [...newModules],
        selectedLessonIds.filter(id => !coveredLessons.has(id))
      );
    }
  }, [selectedModuleIds, selectedLessonIds, onChange, getModuleCheckState]);

  const toggleLesson = useCallback((lessonId: string, moduleId: string) => {
    if (modSet.has(moduleId)) {
      // Module was fully selected; deselect this lesson = select module's other lessons individually
      const mod = findModule(tree, moduleId);
      if (!mod) return;
      const otherLessons = mod.lessons.filter(l => l.id !== lessonId).map(l => l.id);
      onChange(
        selectedModuleIds.filter(id => id !== moduleId),
        [...selectedLessonIds, ...otherLessons]
      );
    } else if (lesSet.has(lessonId)) {
      onChange(selectedModuleIds, selectedLessonIds.filter(id => id !== lessonId));
    } else {
      onChange(selectedModuleIds, [...selectedLessonIds, lessonId]);
    }
  }, [modSet, lesSet, selectedModuleIds, selectedLessonIds, onChange, tree]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const isLessonChecked = (lessonId: string, moduleId: string): boolean =>
    modSet.has(moduleId) || lesSet.has(lessonId);

  const renderModule = (mod: TreeModule, depth: number) => {
    const state = getModuleCheckState(mod);
    const hasContent = mod.children.length > 0 || mod.lessons.length > 0;
    const isExpanded = expanded.has(mod.id);

    return (
      <div key={mod.id}>
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {hasContent ? (
            <button onClick={() => toggleExpand(mod.id)} className="p-0.5 shrink-0">
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          ) : <span className="w-[18px] shrink-0" />}

          <Checkbox
            checked={state === "checked" ? true : state === "indeterminate" ? "indeterminate" : false}
            onCheckedChange={() => toggleModule(mod)}
            className="shrink-0"
          />

          <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-sm flex-1 min-w-0 line-clamp-1">{mod.title}</span>

          {!mod.is_active && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground shrink-0">Неактивен</Badge>
          )}
          <span className="text-[10px] text-muted-foreground shrink-0">
            {mod.lessons.length} ур.
          </span>
        </div>

        {isExpanded && (
          <>
            {mod.lessons.map(lesson => (
              <div
                key={lesson.id}
                className="flex items-center gap-2 py-1 px-2 hover:bg-muted/30 transition-colors"
                style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
              >
                <span className="w-[18px] shrink-0" />
                <Checkbox
                  checked={isLessonChecked(lesson.id, mod.id)}
                  onCheckedChange={() => toggleLesson(lesson.id, mod.id)}
                  className="shrink-0"
                />
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground flex-1 min-w-0 line-clamp-1">{lesson.title}</span>
                {!lesson.is_active && (
                  <Badge variant="outline" className="text-[8px] text-muted-foreground shrink-0">Неактивен</Badge>
                )}
              </div>
            ))}
            {mod.children.map(child => renderModule(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {/* Bulk actions */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
          <Checkbox
            checked={rootState === "checked" ? true : rootState === "indeterminate" ? "indeterminate" : false}
            onCheckedChange={handleSelectAll}
          />
          Весь тренинг
        </label>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() => onChange([...allModuleIds], [...tree.lessons.map(l => l.id)])}
          >
            <CheckSquare className="h-3 w-3 mr-1" />
            Выбрать всё
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() => onChange([], [])}
          >
            <Square className="h-3 w-3 mr-1" />
            Снять всё
          </Button>
        </div>
      </div>

      {/* Tree */}
      <div className="max-h-[300px] overflow-y-auto border rounded-md bg-background">
        {tree.children.length === 0 && tree.lessons.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">
            Тренинг пуст — нет модулей и уроков
          </div>
        ) : (
          <div className="py-1">
            {tree.lessons.map(lesson => (
              <div
                key={lesson.id}
                className="flex items-center gap-2 py-1 px-2 hover:bg-muted/30 transition-colors"
                style={{ paddingLeft: "28px" }}
              >
                <span className="w-[18px] shrink-0" />
                <Checkbox
                  checked={isLessonChecked(lesson.id, tree.id)}
                  onCheckedChange={() => toggleLesson(lesson.id, tree.id)}
                  className="shrink-0"
                />
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground flex-1 min-w-0 line-clamp-1">{lesson.title}</span>
              </div>
            ))}
            {tree.children.map(child => renderModule(child, 0))}
          </div>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground">
        Выбрано: {selectedModuleIds.length > 0 || selectedLessonIds.length > 0 ? `${selectedModuleIds.length} модулей, ${selectedLessonIds.length} уроков` : "ничего"}
      </div>
    </div>
  );
}

/** Normalize payload: remove lesson ids that belong to fully selected modules */
export function normalizeTrainingContentPayload(
  moduleIds: string[],
  lessonIds: string[],
  tree: TreeModule,
): { allowed_module_ids: string[]; allowed_lesson_ids: string[] } {
  const moduleSet = new Set(moduleIds);

  // Collect all lesson IDs belonging to selected modules (recursively)
  const coveredLessonIds = new Set<string>();
  const collectCovered = (node: TreeModule) => {
    if (moduleSet.has(node.id)) {
      node.lessons.forEach(l => coveredLessonIds.add(l.id));
      // Also mark all descendant lessons as covered
      const allDescLessons = collectAllLessonIds(node);
      allDescLessons.forEach(id => coveredLessonIds.add(id));
    }
    node.children.forEach(c => collectCovered(c));
  };
  collectCovered(tree);

  return {
    allowed_module_ids: [...new Set(moduleIds)],
    allowed_lesson_ids: [...new Set(lessonIds.filter(id => !coveredLessonIds.has(id)))],
  };
}
