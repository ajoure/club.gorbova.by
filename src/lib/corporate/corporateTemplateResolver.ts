/**
 * Corporate Template Resolver
 * 
 * PATCH 2.1: Links manifest codes to DB templates and storage files.
 * Provides detailed availability diagnostics for each template.
 * 
 * Flow: wizard → calculatePackageManifest() → resolveManifestTemplates() → enriched manifest
 */

import { supabase } from '@/integrations/supabase/client';
import { getTemplateSpec } from './corporateTemplateSpec';
import type {
  PackageManifestItem,
  TemplateAvailability,
  TemplateRuntimeStatus,
} from './corporateTypes';

// ─── Types ────────────────────────────────────────────────────────

export interface TemplateResolutionResult {
  /** Enriched manifest items with DB/storage/availability data */
  items: PackageManifestItem[];
  /** Summary of blocking issues (active + included templates that are unavailable) */
  blocking_issues: TemplateAvailabilityIssue[];
  /** Summary of non-blocking issues (pending/excluded/informational) */
  non_blocking_issues: TemplateAvailabilityIssue[];
}

export interface TemplateAvailabilityIssue {
  template_code: string;
  title: string;
  availability: TemplateAvailability;
  message: string;
  blocking: boolean;
}

// ─── Resolver ─────────────────────────────────────────────────────

/**
 * Resolves ALL manifest items (included + excluded) against DB templates.
 * For included items: runtime-critical status.
 * For excluded items: informational status.
 * For externally_provided: skipped (no DB template expected).
 */
export async function resolveManifestTemplates(
  manifest: PackageManifestItem[]
): Promise<TemplateResolutionResult> {
  // Collect all non-external template codes
  const codesToResolve = manifest
    .filter(m => m.category !== 'externally_provided')
    .map(m => m.template_code);

  // Single batch query to document_templates (soft-deleted шаблоны исключаем)
  const { data: dbTemplates, error } = await supabase
    .from('document_templates')
    .select('id, code, is_active, template_path')
    .eq('template_scope', 'corporate')
    .is('deleted_at', null)
    .in('code', codesToResolve);

  if (error) {
    console.error('[corporateTemplateResolver] DB query error:', error);
  }

  const dbMap = new Map(
    (dbTemplates || []).map(t => [t.code, t])
  );

  const blocking_issues: TemplateAvailabilityIssue[] = [];
  const non_blocking_issues: TemplateAvailabilityIssue[] = [];

  const enrichedItems = manifest.map(item => {
    const enriched = { ...item };

    // Get runtime_status from spec (source of truth)
    const spec = getTemplateSpec(item.template_code);
    if (spec) {
      enriched.runtime_status = spec.runtime_status as TemplateRuntimeStatus;
    }

    // Externally provided — no DB template, mark as not_applicable
    if (item.category === 'externally_provided') {
      enriched.availability = 'not_applicable';
      return enriched;
    }

    // Check DB record
    const dbRecord = dbMap.get(item.template_code);

    if (!dbRecord) {
      enriched.availability = 'missing_db_record';
      const issue: TemplateAvailabilityIssue = {
        template_code: item.template_code,
        title: item.title,
        availability: 'missing_db_record',
        message: `Шаблон «${item.title}» не найден в базе данных`,
        blocking: item.included && enriched.runtime_status === 'active',
      };
      if (issue.blocking) blocking_issues.push(issue);
      else non_blocking_issues.push(issue);
      return enriched;
    }

    enriched.db_template_id = dbRecord.id;

    // Check is_active
    if (!dbRecord.is_active) {
      enriched.availability = 'inactive_template';
      const issue: TemplateAvailabilityIssue = {
        template_code: item.template_code,
        title: item.title,
        availability: 'inactive_template',
        message: `Шаблон «${item.title}» деактивирован`,
        blocking: item.included && enriched.runtime_status === 'active',
      };
      if (issue.blocking) blocking_issues.push(issue);
      else non_blocking_issues.push(issue);
      return enriched;
    }

    // Check template_path
    if (!dbRecord.template_path) {
      enriched.availability = 'missing_template_path';
      const issue: TemplateAvailabilityIssue = {
        template_code: item.template_code,
        title: item.title,
        availability: 'missing_template_path',
        message: `У шаблона «${item.title}» не указан путь к файлу`,
        blocking: item.included && enriched.runtime_status === 'active',
      };
      if (issue.blocking) blocking_issues.push(issue);
      else non_blocking_issues.push(issue);
      return enriched;
    }

    enriched.template_path = dbRecord.template_path;

    // Check runtime_status from spec
    if (enriched.runtime_status === 'pending_sprint3') {
      enriched.availability = 'pending_sprint3';
      non_blocking_issues.push({
        template_code: item.template_code,
        title: item.title,
        availability: 'pending_sprint3',
        message: `Шаблон «${item.title}» подготовлен, активация в Sprint 3 (требуется поддержка массивов)`,
        blocking: false,
      });
      return enriched;
    }

    // All checks passed
    enriched.availability = 'available';
    return enriched;
  });

  return {
    items: enrichedItems,
    blocking_issues,
    non_blocking_issues,
  };
}

// ─── Storage File Verification ────────────────────────────────────

/**
 * Verifies that storage files actually exist for resolved templates.
 * Call separately when deep validation is needed (e.g., before generation).
 */
export async function verifyStorageFiles(
  items: PackageManifestItem[]
): Promise<PackageManifestItem[]> {
  const toCheck = items.filter(
    i => i.availability === 'available' && i.template_path
  );

  if (toCheck.length === 0) return items;

  // List files in templates/ folder
  const { data: storageFiles, error } = await supabase.storage
    .from('documents-templates')
    .list('templates', { limit: 100 });

  if (error) {
    console.error('[corporateTemplateResolver] Storage list error:', error);
    return items;
  }

  const fileNames = new Set(
    (storageFiles || []).map(f => `templates/${f.name}`)
  );

  return items.map(item => {
    if (item.availability !== 'available' || !item.template_path) return item;

    if (!fileNames.has(item.template_path)) {
      return {
        ...item,
        availability: 'missing_storage_file' as const,
      };
    }
    return item;
  });
}

// ─── Validation Layer ─────────────────────────────────────────────

export interface TemplateValidationResult {
  ready: boolean;
  blocking: TemplateAvailabilityIssue[];
  warnings: TemplateAvailabilityIssue[];
  informational: TemplateAvailabilityIssue[];
}

/**
 * Full validation: checks all included templates are ready for generation.
 * Returns blocking/non-blocking/informational results.
 */
export function validateTemplateAvailability(
  resolution: TemplateResolutionResult
): TemplateValidationResult {
  const blocking: TemplateAvailabilityIssue[] = [];
  const warnings: TemplateAvailabilityIssue[] = [];
  const informational: TemplateAvailabilityIssue[] = [];

  for (const item of resolution.items) {
    if (item.category === 'externally_provided') {
      informational.push({
        template_code: item.template_code,
        title: item.title,
        availability: 'not_applicable',
        message: `«${item.title}» — внешний документ, не генерируется системой`,
        blocking: false,
      });
      continue;
    }

    if (!item.included) {
      // Excluded — informational only
      if (item.availability && item.availability !== 'available' && item.availability !== 'not_applicable') {
        informational.push({
          template_code: item.template_code,
          title: item.title,
          availability: item.availability,
          message: `Исключённый шаблон «${item.title}»: ${availabilityLabel(item.availability)}`,
          blocking: false,
        });
      }
      continue;
    }

    // Included templates
    switch (item.availability) {
      case 'available':
        break; // OK
      case 'pending_sprint3':
        warnings.push({
          template_code: item.template_code,
          title: item.title,
          availability: 'pending_sprint3',
          message: `«${item.title}» — подготовлен, активация в Sprint 3`,
          blocking: false,
        });
        break;
      case 'missing_db_record':
      case 'inactive_template':
      case 'missing_template_path':
      case 'missing_storage_file':
        if (item.runtime_status === 'active') {
          blocking.push({
            template_code: item.template_code,
            title: item.title,
            availability: item.availability,
            message: `«${item.title}» — ${availabilityLabel(item.availability)}`,
            blocking: true,
          });
        } else {
          warnings.push({
            template_code: item.template_code,
            title: item.title,
            availability: item.availability,
            message: `«${item.title}» — ${availabilityLabel(item.availability)}`,
            blocking: false,
          });
        }
        break;
    }
  }

  return {
    ready: blocking.length === 0,
    blocking,
    warnings,
    informational,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function availabilityLabel(a: TemplateAvailability): string {
  switch (a) {
    case 'available': return 'доступен';
    case 'pending_sprint3': return 'подготовлен, ожидает Sprint 3';
    case 'missing_db_record': return 'не найден в базе данных';
    case 'inactive_template': return 'деактивирован';
    case 'missing_template_path': return 'не указан путь к файлу';
    case 'missing_storage_file': return 'файл отсутствует в хранилище';
    case 'not_applicable': return 'не применимо';
    default: return 'неизвестный статус';
  }
}
