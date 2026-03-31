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
  onChangeModules: (ids: string[]) => void;
  onChangeLessons: (ids: string[]) => void;
}

/**
 * Tree picker for partial training_content access.
 * Supports:
 * - Root checkbox "Весь тренинг"
 * - Indeterminate state for modules
 * - Bulk select/deselect
 * - Module selection implies all lessons
 * - Normalization: if module fully selected, lessons not duplicated
 */
export function TrainingContentTreePicker({ tree, selectedModuleIds, selectedLessonIds, onChangeModules, onChangeLessons }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    set.add(tree.id);
    tree.children.forEach(c => set.add(c.id));
    return set;
  });

  // Collect all module/lesson IDs for bulk actions
  const allModuleIds = useMemo(() => {
    const ids: string[] = [];
    const collect = (node: TreeModule) => {
      node.children.forEach(c => { ids.push(c.id); collect(c); });
    };
    collect(tree);
    return ids;
  }, [tree]);

  const allLessonIds = useMemo(() => {
    const ids: string[] = [];
    const collect = (node: TreeModule) => {
      node.lessons.forEach(l => ids.push(l.id));
      node.children.forEach(c => collect(c));
    };
    collect(tree);
    return ids;
  }, [tree]);

  // Check state helpers
  const isModuleSelected = (id: string) => selectedModuleIds.includes(id);

  const getModuleLessonIds = (mod: TreeModule): string[] => mod.lessons.map(l => l.id);

  const getModuleCheckState = (mod: TreeModule): "checked" | "unchecked" | "indeterminate" => {
    if (isModuleSelected(mod.id)) return "checked";
    const lessonIds = getModuleLessonIds(mod);
    const childStates = mod.children.map(c => getModuleCheckState(c));
    const selectedLessonsCount = lessonIds.filter(id => selectedLessonIds.includes(id)).length;
    const hasSelectedChildren = childStates.some(s => s !== "unchecked");
    const allChildrenChecked = mod.children.length > 0 && childStates.every(s => s === "checked");
    const allLessonsSelected = lessonIds.length > 0 && selectedLessonsCount === lessonIds.length;

    if (allChildrenChecked && allLessonsSelected && (mod.children.length > 0 || lessonIds.length > 0)) {
      return "checked";
    }
    if (hasSelectedChildren || selectedLessonsCount > 0) return "indeterminate";
    return "unchecked";
  };

  // Root "all" state
  const allSelected = allModuleIds.length > 0 && allModuleIds.every(id => selectedModuleIds.includes(id));
  const someSelected = selectedModuleIds.length > 0 || selectedLessonIds.length > 0;

  const handleSelectAll = () => {
    if (allSelected) {
      onChangeModules([]);
      onChangeLessons([]);
    } else {
      onChangeModules([...allModuleIds]);
      onChangeLessons([]);
    }
  };

  const toggleModule = useCallback((mod: TreeModule) => {
    const state = getModuleCheckState(mod);
    if (state === "checked" || state === "indeterminate") {
      // Deselect module + its lessons + children recursively
      const toRemoveModules = new Set<string>([mod.id]);
      const toRemoveLessons = new Set<string>();
      const removeRecursive = (node: TreeModule) => {
        toRemoveModules.add(node.id);
        node.lessons.forEach(l => toRemoveLessons.add(l.id));
        node.children.forEach(c => removeRecursive(c));
      };
      removeRecursive(mod);
      onChangeModules(selectedModuleIds.filter(id => !toRemoveModules.has(id)));
      onChangeLessons(selectedLessonIds.filter(id => !toRemoveLessons.has(id)));
    } else {
      // Select entire module
      onChangeModules([...selectedModuleIds, mod.id]);
      // Remove individual lesson selections for this module (module covers all)
      const moduleLessons = new Set(getModuleLessonIds(mod));
      onChangeLessons(selectedLessonIds.filter(id => !moduleLessons.has(id)));
    }
  }, [selectedModuleIds, selectedLessonIds, onChangeModules, onChangeLessons]);

  const toggleLesson = useCallback((lessonId: string, moduleId: string) => {
    if (isModuleSelected(moduleId)) {
      // Module was fully selected; now deselect this lesson = select module's other lessons individually
      const mod = findModule(tree, moduleId);
      if (!mod) return;
      const otherLessons = mod.lessons.filter(l => l.id !== lessonId).map(l => l.id);
      onChangeModules(selectedModuleIds.filter(id => id !== moduleId));
      onChangeLessons([...selectedLessonIds, ...otherLessons]);
    } else if (selectedLessonIds.includes(lessonId)) {
      onChangeLessons(selectedLessonIds.filter(id => id !== lessonId));
    } else {
      onChangeLessons([...selectedLessonIds, lessonId]);
    }
  }, [selectedModuleIds, selectedLessonIds, onChangeModules, onChangeLessons, tree]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderModule = (mod: TreeModule, depth: number) => {
    const state = getModuleCheckState(mod);
    const hasContent = mod.children.length > 0 || mod.lessons.length > 0;
    const isExpanded = expanded.has(mod.id);
    const isLessonVisible = (lessonId: string) =>
      isModuleSelected(mod.id) || selectedLessonIds.includes(lessonId);

    return (
      <div key={mod.id}>
        <div
          className={cn(
            "flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors",
          )}
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
                  checked={isLessonVisible(lesson.id)}
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

  const totalSelected = selectedModuleIds.length + selectedLessonIds.length;

  return (
    <div className="space-y-2">
      {/* Bulk actions */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={handleSelectAll}
          />
          Весь тренинг
        </label>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() => { onChangeModules([...allModuleIds]); onChangeLessons([]); }}
          >
            <CheckSquare className="h-3 w-3 mr-1" />
            Выбрать всё
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={() => { onChangeModules([]); onChangeLessons([]); }}
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
                  checked={selectedLessonIds.includes(lesson.id)}
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
        Выбрано: {totalSelected > 0 ? `${selectedModuleIds.length} модулей, ${selectedLessonIds.length} уроков` : "ничего"}
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

  // Collect all lesson IDs belonging to selected modules
  const coveredLessonIds = new Set<string>();
  const collectCovered = (node: TreeModule) => {
    if (moduleSet.has(node.id)) {
      node.lessons.forEach(l => coveredLessonIds.add(l.id));
    }
    node.children.forEach(c => collectCovered(c));
  };
  collectCovered(tree);

  return {
    allowed_module_ids: [...new Set(moduleIds)],
    allowed_lesson_ids: [...new Set(lessonIds.filter(id => !coveredLessonIds.has(id)))],
  };
}

function findModule(tree: TreeModule, id: string): TreeModule | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findModule(child, id);
    if (found) return found;
  }
  return null;
}
