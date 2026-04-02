import type { ModuleTreeNodeWithData } from "./moduleTreeUtils";

/**
 * Pre-computed indexes for efficient tree selection operations.
 * Built once from the tree, reused in toggle/preview without deep traversal.
 */
export interface TreeIndexes {
  /** moduleId → all descendant module IDs (not including self) */
  descendantModules: Map<string, string[]>;
  /** moduleId → all descendant lesson IDs */
  descendantLessons: Map<string, string[]>;
  /** lessonId → ordered ancestor module IDs from immediate parent to root */
  lessonAncestorModules: Map<string, string[]>;
  /** moduleId → ordered ancestor module IDs from immediate parent to root */
  moduleAncestorModules: Map<string, string[]>;
  /** all module IDs in the tree */
  allModuleIds: string[];
  /** all lesson IDs in the tree */
  allLessonIds: string[];
}

export function buildTreeIndexes<T extends { id: string }>(
  tree: ModuleTreeNodeWithData<T>[],
): TreeIndexes {
  const descendantModules = new Map<string, string[]>();
  const descendantLessons = new Map<string, string[]>();
  const lessonAncestorModules = new Map<string, string[]>();
  const moduleAncestorModules = new Map<string, string[]>();
  const allModuleIds: string[] = [];
  const allLessonIds: string[] = [];

  // Recursively walk tree, collecting ancestors along the way
  function walk(node: ModuleTreeNodeWithData<T>, ancestors: string[]) {
    const mid = node.module.id;
    allModuleIds.push(mid);
    moduleAncestorModules.set(mid, [...ancestors]);

    const descMods: string[] = [];
    const descLessons: string[] = [];

    // Lessons directly in this module
    for (const item of node.items) {
      allLessonIds.push(item.id);
      descLessons.push(item.id);
      lessonAncestorModules.set(item.id, [mid, ...ancestors]);
    }

    // Children
    const childAncestors = [mid, ...ancestors];
    for (const child of node.children) {
      walk(child, childAncestors);
      // Collect from child
      descMods.push(child.module.id);
      descMods.push(...(descendantModules.get(child.module.id) || []));
      descLessons.push(...(descendantLessons.get(child.module.id) || []));
    }

    descendantModules.set(mid, descMods);
    descendantLessons.set(mid, descLessons);
  }

  for (const root of tree) {
    walk(root, []);
  }

  return {
    descendantModules,
    descendantLessons,
    lessonAncestorModules,
    moduleAncestorModules,
    allModuleIds,
    allLessonIds,
  };
}

/**
 * Check state for a module node considering both module and lesson selections.
 * Returns "checked" if all descendants (modules + lessons) are selected,
 * "indeterminate" if some are, "unchecked" if none.
 */
export function getModuleCheckState(
  moduleId: string,
  indexes: TreeIndexes,
  selectedModuleIds: Set<string>,
  selectedLessonIds: Set<string>,
): "checked" | "indeterminate" | "unchecked" {
  // Collect all IDs in subtree (self + descendants)
  const descMods = indexes.descendantModules.get(moduleId) || [];
  const descLessons = indexes.descendantLessons.get(moduleId) || [];

  const allIds = [moduleId, ...descMods, ...descLessons];
  const totalCount = allIds.length;
  if (totalCount === 0) return "unchecked";

  let selectedCount = 0;
  if (selectedModuleIds.has(moduleId)) selectedCount++;
  for (const id of descMods) {
    if (selectedModuleIds.has(id)) selectedCount++;
  }
  for (const id of descLessons) {
    if (selectedLessonIds.has(id)) selectedCount++;
  }

  if (selectedCount === 0) return "unchecked";
  if (selectedCount === totalCount) return "checked";
  return "indeterminate";
}

/**
 * Toggle a module: if checked → deselect entire subtree, otherwise → select entire subtree.
 */
export function toggleModuleSubtree(
  moduleId: string,
  indexes: TreeIndexes,
  selectedModuleIds: Set<string>,
  selectedLessonIds: Set<string>,
): { nextModuleIds: Set<string>; nextLessonIds: Set<string> } {
  const state = getModuleCheckState(moduleId, indexes, selectedModuleIds, selectedLessonIds);
  const nextModuleIds = new Set(selectedModuleIds);
  const nextLessonIds = new Set(selectedLessonIds);

  const descMods = indexes.descendantModules.get(moduleId) || [];
  const descLessons = indexes.descendantLessons.get(moduleId) || [];

  if (state === "checked") {
    // Deselect entire subtree
    nextModuleIds.delete(moduleId);
    for (const id of descMods) nextModuleIds.delete(id);
    for (const id of descLessons) nextLessonIds.delete(id);
  } else {
    // Select entire subtree
    nextModuleIds.add(moduleId);
    for (const id of descMods) nextModuleIds.add(id);
    for (const id of descLessons) nextLessonIds.add(id);
  }

  return { nextModuleIds, nextLessonIds };
}

/**
 * Toggle a single lesson. Does NOT affect parent modules.
 */
export function toggleLesson(
  lessonId: string,
  selectedLessonIds: Set<string>,
): Set<string> {
  const next = new Set(selectedLessonIds);
  if (next.has(lessonId)) next.delete(lessonId);
  else next.add(lessonId);
  return next;
}
