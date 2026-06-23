// ============================================================================
// PATCH-DOCX-TABLE-REPEAT-BY-ROLE-V1 / Stage E.4 (main)
// docx-table-repeat-expand.ts — реальное row expansion для
// {{tableRepeat:TR-XXXXXX}} в word/document.xml.
// ----------------------------------------------------------------------------
// Контракт:
//   • Вызывается в canonical-document-generate-strict ровно ОДИН раз,
//     ДО `new Docxtemplater(zip, ...)`, только в package_session mode.
//   • SOT конфигов: document_package_template_items.metadata.table_repeats[]
//   • SOT строк:    document_package_item_role_assignments
//                   (session+item+role, is_active=true).
//   • cell_index индексирует ФИЗИЧЕСКИЕ <w:tc> (НЕ visual columns с gridSpan).
//   • merged cells / nested tables / multi-paragraph cells: НЕ поддерживается,
//     structured warning `tr_cell_complex_structure_unsupported`.
//   • Любая ошибка — fail-soft: marker зачищается, в report пишется
//     severity+code; HTTP 500 НЕ отдаём.
//   • Audit/report НЕ содержит значений ячеек, ФИО, паспорта, custom values.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  readTableRepeats,
  validateTableRepeatConfig,
  TABLE_REPEAT_MARKER_REGEX,
  type TableRepeatConfig,
} from './table-repeat-spec.ts';
import { renderTableRepeatCell, type RowRenderContext } from './table-repeat-cell-render.ts';

// PizZip-совместимый file API (тот же, что использует canonical-document-generate-strict).
interface PizZipLike {
  file(name: string): { asText(): string } | null;
  // deno-lint-ignore no-explicit-any
  file(name: string, content: string): any;
}

export type TableRepeatMarkerSeverity = 'info' | 'warn' | 'error';

export interface TableRepeatMarkerReport {
  tr_id: string;
  role_catalog_id?: string;
  rows_count: number;
  columns_count: number;
  occurrence_count: number;
  ok_occurrences: number;
  failed_occurrences: number;
  cell_codes_summary: Record<string, number>;
  source_types_count: Record<string, number>;
  severity?: TableRepeatMarkerSeverity;
  code?: string;
}

export interface TableRepeatExpansionReport {
  applied: boolean;
  super_admin: boolean;
  markers: TableRepeatMarkerReport[];
}

export interface TableRepeatExpansionInput {
  zip: PizZipLike;
  supabase: SupabaseClient;
  packageSessionId: string;
  packageTemplateItemId: string;
  packageTemplateId: string;
  itemMetadata: unknown;
  isSuperAdmin: boolean;
  /** pf-XXXXXX → rendered value (то же, что прочая часть strict уже отдаёт). */
  preresolvedPfFields: Record<string, { rendered_value?: string; raw_value?: unknown }>;
}

// ──────────────────────────────────────────────────────────────────────────
// XML helpers (no DOM, regex/index-based).
// ──────────────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Merge consecutive `<w:r>` runs внутри одного `<w:p>`, склеивая <w:t>
 * фрагменты, чтобы маркер `{{tableRepeat:...}}` или `{{ln-...}}`,
 * разрезанный Word'ом на несколько runs, распознавался единым regex.
 *
 * Используется только в скоупе предполагаемой template row (т.е. на
 * фрагменте уже найденной <w:tr>). НЕ трогает атрибуты, NS, rPr и пр.
 *
 * Реализация: внутри каждого <w:p> ищем последовательные <w:r> без rPr
 * (или с identical rPr — для упрощения склеиваем только когда соседи
 * имеют один и тот же rPr-блок); склеиваем их `<w:t>`-содержимое в первом
 * run'е, остальные удаляем. Маркер из 1 run'а остаётся как был.
 *
 * Безопасность: если структура неоднозначна (вложенные `<w:r>` и т.п.),
 * helper выходит no-op для этого `<w:p>`.
 */
export function normalizeSplitMarkerRuns(trXml: string): string {
  // Простая стратегия: внутри каждого <w:p>...</w:p> найдём ВСЕ <w:t...>TEXT</w:t>
  // и склеим в один <w:t> в первом подходящем <w:r>. Это безопасно для
  // маркеров `{{...}}`, потому что Word гарантирует, что разрезанный токен
  // остаётся в пределах одного параграфа.
  return trXml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (whole, inner: string) => {
    // Если параграф вообще не содержит `{{` или `}}` — скип (оптимизация).
    if (!inner.includes('{{') && !inner.includes('}}')) return whole;

    // Соберём все <w:t...>TEXT</w:t> по порядку
    const tRe = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    const texts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tRe.exec(inner)) !== null) {
      texts.push(m[2]);
    }
    if (texts.length < 2) return whole;
    const joined = texts.join('');
    // Только если объединение реально содержит маркер, который НЕ виден
    // в отдельных run'ах — иначе не трогаем (минимально-инвазивно).
    const hasMarkerJoined =
      /\{\{tableRepeat:TR-\d{6,}\}\}/.test(joined)
      || /\{\{ln-\d+\.custom\.[A-Za-z0-9_]+\}\}/.test(joined);
    const hasMarkerSeparate =
      texts.some((t) => /\{\{tableRepeat:TR-\d{6,}\}\}/.test(t))
      || texts.some((t) => /\{\{ln-\d+\.custom\.[A-Za-z0-9_]+\}\}/.test(t));
    if (!hasMarkerJoined || hasMarkerSeparate) return whole;

    // Сшиваем: оставляем первый <w:r> с его <w:rPr>, заменяем все <w:t> в нём
    // на один объединённый, остальные <w:r> удаляем.
    let replaced = false;
    let out = inner.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (rChunk) => {
      if (!replaced) {
        replaced = true;
        // Найдём первый <w:t..> внутри и заменим его на объединённый;
        // остальные <w:t> внутри ЭТОГО же run'а уберём.
        let firstTReplaced = false;
        const newR = rChunk.replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/g, (tChunk) => {
          if (!firstTReplaced) {
            firstTReplaced = true;
            return `<w:t xml:space="preserve">${xmlEscape(joined).replace(/&apos;/g, "'").replace(/&quot;/g, '"')}</w:t>`;
          }
          return '';
        });
        return newR;
      }
      // Остальные run'ы — удаляем (их текст уже в первом).
      return '';
    });
    return `<w:p${whole.slice(4, whole.indexOf('>'))}>${out}</w:p>`;
  });
}

/**
 * Найти ближайшую родительскую top-level <w:tr> для абсолютной позиции `pos`
 * в `xml`. Возвращает {start,end} (полуоткрытый интервал на </w:tr> + len).
 * top-level = не nested внутри другого <w:tr>; учёт балансом тегов.
 */
export function findEnclosingTopLevelTr(
  xml: string,
  pos: number,
): { start: number; end: number } | null {
  // 1. ищем последний "<w:tr " или "<w:tr>" до pos с балансом
  // Стратегия: двигаемся от позиции назад, считая открывающие/закрывающие
  // <w:tr>. Для top-level берём первый "уровень 0".
  const openRe = /<w:tr(?:\s[^>]*)?>/g;
  const closeRe = /<\/w:tr>/g;
  // Соберём все <w:tr> и </w:tr> до позиции pos.
  const trEvents: Array<{ idx: number; type: 'open' | 'close'; len: number }> = [];
  let m: RegExpExecArray | null;
  openRe.lastIndex = 0;
  while ((m = openRe.exec(xml)) !== null && m.index < pos) {
    trEvents.push({ idx: m.index, type: 'open', len: m[0].length });
  }
  closeRe.lastIndex = 0;
  while ((m = closeRe.exec(xml)) !== null && m.index < pos) {
    trEvents.push({ idx: m.index, type: 'close', len: m[0].length });
  }
  trEvents.sort((a, b) => a.idx - b.idx);

  // Найдём последний "open" с балансом 0
  let depth = 0;
  let lastOpenStart: number | null = null;
  for (const ev of trEvents) {
    if (ev.type === 'open') {
      if (depth === 0) lastOpenStart = ev.idx;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) lastOpenStart = null;
    }
  }
  if (lastOpenStart == null || depth <= 0) return null;

  // Теперь найдём закрывающий </w:tr> ПОСЛЕ pos с депфом 0 относительно lastOpenStart
  // Простая стратегия: продолжим сканирование с pos.
  let depth2 = depth; // текущий уровень
  const after = xml.slice(pos);
  const openAfterRe = /<w:tr(?:\s[^>]*)?>/g;
  const closeAfterRe = /<\/w:tr>/g;
  const eventsAfter: Array<{ idx: number; type: 'open' | 'close'; len: number }> = [];
  while ((m = openAfterRe.exec(after)) !== null) {
    eventsAfter.push({ idx: m.index, type: 'open', len: m[0].length });
  }
  while ((m = closeAfterRe.exec(after)) !== null) {
    eventsAfter.push({ idx: m.index, type: 'close', len: m[0].length });
  }
  eventsAfter.sort((a, b) => a.idx - b.idx);
  for (const ev of eventsAfter) {
    if (ev.type === 'open') depth2 += 1;
    else {
      depth2 -= 1;
      if (depth2 === 0) {
        const closeAbs = pos + ev.idx + ev.len;
        return { start: lastOpenStart, end: closeAbs };
      }
    }
  }
  return null;
}

/**
 * Разбить XML внутри <w:tr> на массив top-level <w:tc>...</w:tc>
 * (без nested таблиц, которые могут содержать собственные <w:tc>).
 * Возвращает массив объектов с позицией и текстом ячейки + признак "сложности".
 */
export interface TopLevelCellInfo {
  start: number;   // относительно tr inner xml
  end: number;
  xml: string;
  complex: boolean; // gridSpan/vMerge/nested table/multiple paragraphs
}

export function extractTopLevelCells(trInner: string): TopLevelCellInfo[] {
  const result: TopLevelCellInfo[] = [];
  const openRe = /<w:tc(?:\s[^>]*)?>/g;
  const closeRe = /<\/w:tc>/g;
  const events: Array<{ idx: number; type: 'open' | 'close'; len: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(trInner)) !== null) {
    events.push({ idx: m.index, type: 'open', len: m[0].length });
  }
  while ((m = closeRe.exec(trInner)) !== null) {
    events.push({ idx: m.index, type: 'close', len: m[0].length });
  }
  events.sort((a, b) => a.idx - b.idx);

  let depth = 0;
  let curStart = -1;
  for (const ev of events) {
    if (ev.type === 'open') {
      if (depth === 0) curStart = ev.idx;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && curStart >= 0) {
        const endAbs = ev.idx + ev.len;
        const xml = trInner.slice(curStart, endAbs);
        const complex = isCellComplex(xml);
        result.push({ start: curStart, end: endAbs, xml, complex });
        curStart = -1;
      }
    }
  }
  return result;
}

function isCellComplex(cellXml: string): boolean {
  // gridSpan / vMerge — merged cells
  if (/<w:gridSpan\b/.test(cellXml)) return true;
  if (/<w:vMerge\b/.test(cellXml)) return true;
  // nested table inside cell
  if (/<w:tbl\b/.test(cellXml)) return true;
  // multi-paragraph cells
  const pCount = (cellXml.match(/<w:p\b/g) || []).length;
  if (pCount > 1) return true;
  return false;
}

/**
 * Заменить контент ячейки на одну <w:r><w:t>VALUE</w:t></w:r>,
 * сохранив <w:tcPr> и первый <w:pPr> (если есть).
 */
export function setCellTextValue(cellXml: string, value: string): string {
  // Извлекаем <w:tcPr>...</w:tcPr> (один или ноль)
  const tcPrMatch = cellXml.match(/<w:tcPr\b[\s\S]*?<\/w:tcPr>/);
  const tcPr = tcPrMatch ? tcPrMatch[0] : '';

  // Извлекаем первый <w:pPr> (для сохранения форматирования параграфа)
  const pPrMatch = cellXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';

  // Извлекаем первый <w:rPr> внутри первого <w:r> (для сохранения шрифта/размера)
  const firstRMatch = cellXml.match(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/);
  let rPr = '';
  if (firstRMatch) {
    const rPrInner = firstRMatch[1].match(/<w:rPr\b[\s\S]*?<\/w:rPr>/);
    if (rPrInner) rPr = rPrInner[0];
  }

  // Извлечь tcAttrs из исходного <w:tc ...> для сохранения атрибутов
  const tcOpenMatch = cellXml.match(/^<w:tc(\s[^>]*)?>/);
  const tcAttrs = tcOpenMatch && tcOpenMatch[1] ? tcOpenMatch[1] : '';

  const safeValue = xmlEscape(value);
  return (
    `<w:tc${tcAttrs}>${tcPr}<w:p>${pPr}<w:r>${rPr}` +
    `<w:t xml:space="preserve">${safeValue}</w:t></w:r></w:p></w:tc>`
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────────

export async function applyTableRepeatExpansion(
  input: TableRepeatExpansionInput,
): Promise<TableRepeatExpansionReport> {
  const report: TableRepeatExpansionReport = {
    applied: false,
    super_admin: !!input.isSuperAdmin,
    markers: [],
  };

  const docFile = input.zip.file('word/document.xml');
  if (!docFile) return report;
  const originalXml = (docFile as { asText(): string }).asText();
  if (!originalXml.includes('{{tableRepeat:')) return report;

  // Configs (через shared helper, тот же что в E.2/E.3 dry-run)
  let configs: TableRepeatConfig[] = [];
  try {
    configs = readTableRepeats(input.itemMetadata);
  } catch (_e) {
    report.markers.push({
      tr_id: '*',
      rows_count: 0,
      columns_count: 0,
      occurrence_count: 0,
      ok_occurrences: 0,
      failed_occurrences: 0,
      cell_codes_summary: {},
      source_types_count: {},
      severity: 'error',
      code: 'tr_expansion_metadata_read_failed',
    });
    return report;
  }

  // Найдём все TR-id, упомянутые в документе
  const trIdsInDoc = new Set<string>();
  {
    const re = new RegExp(TABLE_REPEAT_MARKER_REGEX.source, 'g');
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(originalXml)) !== null) {
      trIdsInDoc.add(mm[1]);
    }
  }

  let workingXml = originalXml;
  report.applied = true;

  // role_catalog cache: id → { metadata.assignment_custom_fields }
  const roleCatalogCache = new Map<string, { role_key: string; package_template_id: string; metadata: unknown }>();
  // assignments cache: per role_catalog_id → assignments array
  const assignmentsCache = new Map<string, Array<{ person_id: string | null; metadata: unknown }>>();
  // persons cache: id → row
  const personById = new Map<string, Record<string, unknown>>();

  for (const trId of trIdsInDoc) {
    const cfg = configs.find((c) => c.id === trId);
    if (!cfg) {
      // tr_id_not_found — зачищаем все occurrences, severity=error
      workingXml = stripAllOccurrences(workingXml, trId);
      report.markers.push({
        tr_id: trId,
        rows_count: 0,
        columns_count: 0,
        occurrence_count: countOccurrences(originalXml, trId),
        ok_occurrences: 0,
        failed_occurrences: countOccurrences(originalXml, trId),
        cell_codes_summary: {},
        source_types_count: {},
        severity: 'error',
        code: 'tr_id_not_found',
      });
      continue;
    }

    // Load role catalog (cache)
    let role = roleCatalogCache.get(cfg.role_catalog_id);
    if (!role) {
      const { data: roleRow } = await input.supabase
        .from('document_package_role_catalog')
        .select('id, role_key, package_template_id, metadata')
        .eq('id', cfg.role_catalog_id)
        .maybeSingle();
      if (!roleRow) {
        workingXml = stripAllOccurrences(workingXml, trId);
        report.markers.push({
          tr_id: trId,
          role_catalog_id: cfg.role_catalog_id,
          rows_count: 0,
          columns_count: cfg.columns.length,
          occurrence_count: countOccurrences(originalXml, trId),
          ok_occurrences: 0,
          failed_occurrences: countOccurrences(originalXml, trId),
          cell_codes_summary: {},
          source_types_count: {},
          severity: 'error',
          code: 'tr_config_invalid',
        });
        continue;
      }
      role = roleRow as { role_key: string; package_template_id: string; metadata: unknown };
      roleCatalogCache.set(cfg.role_catalog_id, role);
    }
    if (role.package_template_id !== input.packageTemplateId) {
      workingXml = stripAllOccurrences(workingXml, trId);
      report.markers.push({
        tr_id: trId,
        role_catalog_id: cfg.role_catalog_id,
        rows_count: 0,
        columns_count: cfg.columns.length,
        occurrence_count: countOccurrences(originalXml, trId),
        ok_occurrences: 0,
        failed_occurrences: countOccurrences(originalXml, trId),
        cell_codes_summary: {},
        source_types_count: {},
        severity: 'error',
        code: 'tr_config_invalid',
      });
      continue;
    }

    // known custom keys for schema check
    const roleMeta = (role.metadata && typeof role.metadata === 'object')
      ? role.metadata as Record<string, unknown>
      : {};
    const acfRaw = Array.isArray(roleMeta['assignment_custom_fields'])
      ? roleMeta['assignment_custom_fields']
      : [];
    const knownCustomKeys = new Set<string>();
    for (const f of acfRaw) {
      if (f && typeof f === 'object' && typeof (f as { key?: unknown }).key === 'string') {
        knownCustomKeys.add((f as { key: string }).key);
      }
    }

    // validate config
    const cfgIssues = validateTableRepeatConfig(cfg, { knownCustomKeysForRole: knownCustomKeys });
    const cfgErrors = cfgIssues.filter((i) => i.severity === 'error');
    if (cfgErrors.length > 0) {
      workingXml = stripAllOccurrences(workingXml, trId);
      report.markers.push({
        tr_id: trId,
        role_catalog_id: cfg.role_catalog_id,
        rows_count: 0,
        columns_count: cfg.columns.length,
        occurrence_count: countOccurrences(originalXml, trId),
        ok_occurrences: 0,
        failed_occurrences: countOccurrences(originalXml, trId),
        cell_codes_summary: {},
        source_types_count: {},
        severity: 'error',
        code: 'tr_config_invalid',
      });
      continue;
    }

    // load assignments
    let assignments = assignmentsCache.get(cfg.role_catalog_id);
    if (!assignments) {
      const { data: asgs } = await input.supabase
        .from('document_package_item_role_assignments')
        .select('person_id, metadata, sort_order, created_at, id')
        .eq('package_session_id', input.packageSessionId)
        .eq('package_template_item_id', input.packageTemplateItemId)
        .eq('role_catalog_id', cfg.role_catalog_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      assignments = (asgs ?? []) as Array<{ person_id: string | null; metadata: unknown }>;
      assignmentsCache.set(cfg.role_catalog_id, assignments);
    }

    // load persons (batch)
    const needPersonRows = cfg.columns.some((c) => c.source_type === 'role_person');
    if (needPersonRows) {
      const missingIds = assignments
        .map((a) => a.person_id)
        .filter((x): x is string => !!x && !personById.has(x));
      if (missingIds.length > 0) {
        const { data: persons } = await input.supabase
          .from('legal_details_persons')
          .select('*')
          .in('id', missingIds);
        for (const p of (persons ?? []) as Array<Record<string, unknown>>) {
          personById.set(String((p as { id: string }).id), p);
        }
      }
    }

    // pf cache (одно значение на все строки)
    const pfCache = new Map<string, { value: string; code?: string }>();
    for (const col of cfg.columns) {
      if (col.source_type === 'package_field' && col.source_key && !pfCache.has(col.source_key)) {
        const entry = input.preresolvedPfFields[col.source_key];
        if (!entry) {
          pfCache.set(col.source_key, { value: '', code: 'pf_token_not_found' });
        } else {
          pfCache.set(col.source_key, { value: String(entry.rendered_value ?? '') });
        }
      }
    }

    // Expand each occurrence (across the WHOLE document, not just first one).
    const cellCodes: Record<string, number> = {};
    const sourceTypesCount: Record<string, number> = {};
    for (const c of cfg.columns) {
      sourceTypesCount[c.source_type] = (sourceTypesCount[c.source_type] ?? 0) + 1;
    }
    let occCount = 0;
    let okOcc = 0;
    let failedOcc = 0;

    // Цикл, пока в документе есть хотя бы один маркер этого trId.
    // Каждая итерация: находим первое вхождение → нормализуем split-runs
    // в окружающей <w:tr> → расширяем строку → заменяем оригинал.
    // Лимит итераций для защиты от runaway: 200.
    const markerLiteral = `{{tableRepeat:${trId}}}`;
    let safety = 0;
    while (safety < 200) {
      safety += 1;
      let pos = workingXml.indexOf(markerLiteral);
      let splitNormalized = false;
      if (pos < 0) {
        // Возможно, маркер разрезан Word'ом на несколько runs. Нормализуем
        // весь документ безопасно: только параграфы с `{{` и `}}` склеиваются.
        const normalized = normalizeSplitMarkerRuns(workingXml);
        if (normalized !== workingXml) {
          splitNormalized = true;
          workingXml = normalized;
          pos = workingXml.indexOf(markerLiteral);
        }
      }
      if (pos < 0) break; // больше нет вхождений
      occCount += 1;

      const trBounds = findEnclosingTopLevelTr(workingXml, pos);
      if (!trBounds) {
        // marker outside any <w:tr> — fail-soft
        workingXml = workingXml.slice(0, pos) + workingXml.slice(pos + markerLiteral.length);
        failedOcc += 1;
        cellCodes['tr_marker_not_inside_tr'] = (cellCodes['tr_marker_not_inside_tr'] ?? 0) + 1;
        continue;
      }

      const trXml = workingXml.slice(trBounds.start, trBounds.end);
      // template inner = всё между <w:tr...> и </w:tr>
      const trOpenEnd = trXml.indexOf('>') + 1;
      const trCloseStart = trXml.lastIndexOf('</w:tr>');
      const trAttrsOpen = trXml.slice(0, trOpenEnd); // включая >
      const trInner = trXml.slice(trOpenEnd, trCloseStart);

      // Очистка маркера в template inner (потом каждая клонированная строка
      // получит уже чистый шаблон).
      const cleanInner = trInner.split(markerLiteral).join('');

      // Top-level cells шаблона
      const templateCells = extractTopLevelCells(cleanInner);

      // Сборка N клонов
      const rowsCount = assignments.length;
      const clones: string[] = [];

      if (rowsCount === 0) {
        // 0 assignments → row удаляется
        cellCodes['tr_role_has_no_assignments'] =
          (cellCodes['tr_role_has_no_assignments'] ?? 0) + 1;
        // Заменим целиком на пусто
        workingXml = workingXml.slice(0, trBounds.start) + workingXml.slice(trBounds.end);
        okOcc += 1; // expansion применён, просто 0 строк
        continue;
      }

      for (let rowIdx = 0; rowIdx < rowsCount; rowIdx += 1) {
        const asg = assignments[rowIdx];
        const person = asg.person_id ? personById.get(asg.person_id) : undefined;
        const ctx: RowRenderContext = {
          rowIndex: rowIdx,
          assignment: asg,
          person,
          pfCache,
          knownCustomKeysForRole: knownCustomKeys,
          isSuperAdmin: !!input.isSuperAdmin,
        };

        // Сначала вычислим map cell_index → value
        const valueByCellIdx = new Map<number, { value: string; code?: string }>();
        for (const col of cfg.columns) {
          const r = renderTableRepeatCell(col, ctx);
          if (r.code) cellCodes[r.code] = (cellCodes[r.code] ?? 0) + 1;
          else cellCodes['ok'] = (cellCodes['ok'] ?? 0) + 1;
          valueByCellIdx.set(col.cell_index, { value: r.value, code: r.code });
        }

        // Применим к ячейкам строки
        // Идём по templateCells от КОНЦА к НАЧАЛУ, чтобы индексы оставались валидными.
        let cloneInner = cleanInner;
        // Сначала найдём для текущей клонированной копии актуальные позиции
        const liveCells = extractTopLevelCells(cloneInner);
        for (let i = liveCells.length - 1; i >= 0; i -= 1) {
          const cell = liveCells[i];
          // cell_index = физический порядковый i (0-based)
          if (!valueByCellIdx.has(i)) continue;
          const target = valueByCellIdx.get(i)!;
          if (cell.complex) {
            cellCodes['tr_cell_complex_structure_unsupported'] =
              (cellCodes['tr_cell_complex_structure_unsupported'] ?? 0) + 1;
            continue; // не трогаем сложные ячейки
          }
          const newCell = setCellTextValue(cell.xml, target.value);
          cloneInner = cloneInner.slice(0, cell.start) + newCell + cloneInner.slice(cell.end);
        }
        // Проверка cell_index out_of_range
        for (const col of cfg.columns) {
          if (col.cell_index >= liveCells.length) {
            cellCodes['cell_index_out_of_range'] = (cellCodes['cell_index_out_of_range'] ?? 0) + 1;
          }
        }

        clones.push(`${trAttrsOpen}${cloneInner}</w:tr>`);
      }

      const expanded = clones.join('');
      workingXml = workingXml.slice(0, trBounds.start) + expanded + workingXml.slice(trBounds.end);
      okOcc += 1;

      if (splitNormalized) {
        cellCodes['tr_split_marker_normalized'] = (cellCodes['tr_split_marker_normalized'] ?? 0) + 1;
      }
    }

    const markerReport: TableRepeatMarkerReport = {
      tr_id: trId,
      role_catalog_id: cfg.role_catalog_id,
      rows_count: assignments.length,
      columns_count: cfg.columns.length,
      occurrence_count: occCount,
      ok_occurrences: okOcc,
      failed_occurrences: failedOcc,
      cell_codes_summary: cellCodes,
      source_types_count: sourceTypesCount,
    };
    if (failedOcc > 0) {
      markerReport.severity = 'warn';
    } else if (assignments.length === 0) {
      markerReport.severity = 'warn';
      markerReport.code = 'tr_role_has_no_assignments';
    }
    report.markers.push(markerReport);
  }

  // Defensive: убедимся, что НИ один маркер `{{tableRepeat:` не остался.
  if (workingXml.includes('{{tableRepeat:')) {
    workingXml = workingXml.replace(/\{\{tableRepeat:TR-\d{6,}\}\}/g, '');
  }

  input.zip.file('word/document.xml', workingXml);
  return report;
}

function countOccurrences(xml: string, trId: string): number {
  const re = new RegExp(`\\{\\{tableRepeat:${trId}\\}\\}`, 'g');
  return (xml.match(re) || []).length;
}

function stripAllOccurrences(xml: string, trId: string): string {
  const re = new RegExp(`\\{\\{tableRepeat:${trId}\\}\\}`, 'g');
  return xml.replace(re, '');
}
