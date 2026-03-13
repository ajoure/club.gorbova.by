import { supabase } from "@/integrations/supabase/client";

/**
 * Auto-discover V1 diagnostic_table source lesson within the same module.
 * 
 * Logic:
 * 1. If overrideSourceId is set, validate it (same module, has V1 block, not self)
 * 2. If override invalid or empty → find closest previous lesson by sort_order
 *    that has a diagnostic_table block without version='v2'
 * 
 * Returns { sourceLessonId, method } or null if nothing found.
 */
export interface V1SourceResult {
  sourceLessonId: string;
  method: 'override' | 'auto';
  lessonTitle?: string;
}

export async function findV1DiagnosticSource(opts: {
  currentLessonId: string;
  moduleId: string;
  currentSortOrder: number;
  overrideSourceId?: string;
}): Promise<V1SourceResult | null> {
  const { currentLessonId, moduleId, currentSortOrder, overrideSourceId } = opts;

  // 1. Try override first
  if (overrideSourceId && overrideSourceId.length > 10) {
    const result = await validateOverrideSource(overrideSourceId, moduleId, currentLessonId);
    if (result) return result;
    // Override invalid → fall through to auto-discover
    console.log('[V1Source] Override invalid, falling back to auto-discover');
  }

  // 2. Auto-discover: find closest previous lesson in same module with V1 diagnostic_table
  const { data: candidates, error } = await supabase
    .from('training_lessons')
    .select('id, title, sort_order')
    .eq('module_id', moduleId)
    .eq('is_active', true)
    .neq('id', currentLessonId)
    .lt('sort_order', currentSortOrder)
    .order('sort_order', { ascending: false })
    .limit(10); // check up to 10 previous lessons

  if (error || !candidates?.length) {
    console.log('[V1Source] No previous lessons found in module');
    return null;
  }

  // For each candidate (closest first), check if it has a V1 diagnostic_table block
  for (const lesson of candidates) {
    const hasV1 = await lessonHasV1DiagnosticBlock(lesson.id);
    if (hasV1) {
      return {
        sourceLessonId: lesson.id,
        method: 'auto',
        lessonTitle: lesson.title,
      };
    }
  }

  console.log('[V1Source] No V1 diagnostic_table found in previous lessons');
  return null;
}

async function validateOverrideSource(
  sourceId: string,
  moduleId: string,
  currentLessonId: string
): Promise<V1SourceResult | null> {
  // Check lesson exists, same module, not self
  const { data: lesson } = await supabase
    .from('training_lessons')
    .select('id, title, module_id')
    .eq('id', sourceId)
    .maybeSingle();

  if (!lesson) return null;
  if (lesson.module_id !== moduleId) return null;
  if (lesson.id === currentLessonId) return null;

  // Check has V1 diagnostic_table
  const hasV1 = await lessonHasV1DiagnosticBlock(sourceId);
  if (!hasV1) return null;

  return {
    sourceLessonId: sourceId,
    method: 'override',
    lessonTitle: lesson.title,
  };
}

async function lessonHasV1DiagnosticBlock(lessonId: string): Promise<boolean> {
  const { data: blocks } = await supabase
    .from('lesson_blocks')
    .select('id, content')
    .eq('lesson_id', lessonId)
    .eq('block_type', 'diagnostic_table');

  if (!blocks?.length) return false;

  return blocks.some(b => {
    const ver = (b.content as any)?.version;
    return !ver || ver !== 'v2';
  });
}

/**
 * Quick lookup for LessonBlockEditor: find V1 source for a new V2 block.
 * Returns source_lesson_id or empty string.
 */
export async function findV1SourceForNewBlock(
  currentLessonId: string
): Promise<string> {
  // Get current lesson's module_id and sort_order
  const { data: lesson } = await supabase
    .from('training_lessons')
    .select('module_id, sort_order')
    .eq('id', currentLessonId)
    .single();

  if (!lesson) return '';

  const result = await findV1DiagnosticSource({
    currentLessonId,
    moduleId: lesson.module_id,
    currentSortOrder: lesson.sort_order,
  });

  return result?.sourceLessonId || '';
}
