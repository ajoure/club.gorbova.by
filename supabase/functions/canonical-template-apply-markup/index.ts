// ============================================================================
// canonical-template-apply-markup — Sprint 11 C2
// ----------------------------------------------------------------------------
// Применяет ручную разметку к DOCX-версии шаблона:
//   1. Читает исходный DOCX из storage.
//   2. Для каждого replacement (status='accepted'|'changed') заменяет
//      original_text на {{field:FLD-XXXXXX}} в word/document.xml и других
//      видимых частях (header*, footer*, footnotes, endnotes, comments).
//   3. Сохраняет новый DOCX как новую version_number+1.
//   4. Проставляет token_manifest = [{ field_public_id }] (только FLD).
//   5. Запускает strict validation и пишет результат в новую версию.
//   6. Audit: document_template.markup_applied.
//
// Body:
//   {
//     template_version_id: uuid,                       // источник
//     replacements: [
//       { original_text: string, field_public_id: 'FLD-000123', status: 'accepted'|'changed'|'skipped' }
//     ],
//     new_version_notes?: string
//   }
//
// Response: { new_version_id, applied_count, skipped_count, missed_count, validation }
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import PizZip from 'npm:pizzip@3.1.6';
import { extractDocxTokensWithLocations } from '../_shared/docx-helpers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Strict ID-first token формат:
//   field:FLD-XXXXXX
//   field:FLD-XXXXXX|format=words
//   field:FLD-XXXXXX|format=text
//   field:FLD-XXXXXX|case=<allowed>
//   field:FLD-XXXXXX|format=words|case=<allowed>
const ALLOWED_CASES = new Set([
  'nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional',
]);
const ALLOWED_FORMATS = new Set(['words', 'text']);
const STRICT_FIELD_RE = /^field:(FLD-\d+)((?:\|[a-z_]+=[a-z_]+)*)$/;
const ANY_TOKEN_RE = /\{\{([^}]+)\}\}/g;

interface Replacement {
  original_text: string;
  field_public_id: string;
  status: 'accepted' | 'changed' | 'skipped' | 'manually_added';
  format?: 'words' | 'text' | null;
  case_modifier?:
    | 'nominative' | 'genitive' | 'dative' | 'accusative'
    | 'instrumental' | 'prepositional' | null;
  /** опционально — клиент может прислать готовый placeholder (доверяем после strict-валидации) */
  placeholder?: string;
  /** Sprint 11 C5-D: 0-based индекс occurrence в документе. Если не задан и
   * вхождений больше одного — возвращается ambiguous_replacement_multiple_matches. */
  occurrence_index?: number | null;
}

function parseStrictToken(inside: string): {
  field_public_id: string;
  format: string | null;
  case_modifier: string | null;
  unknown_modifier?: string;
  invalid_value?: string;
} | null {
  const m = inside.match(STRICT_FIELD_RE);
  if (!m) return null;
  const fld = m[1];
  let format: string | null = null;
  let cs: string | null = null;
  const tail = (m[2] || '').split('|').filter(Boolean);
  for (const part of tail) {
    const [k, v] = part.split('=');
    if (k === 'format') {
      if (!ALLOWED_FORMATS.has(v)) return { field_public_id: fld, format: null, case_modifier: null, invalid_value: `format=${v}` };
      format = v;
    } else if (k === 'case') {
      if (!ALLOWED_CASES.has(v)) return { field_public_id: fld, format: null, case_modifier: null, invalid_value: `case=${v}` };
      cs = v;
    } else {
      return { field_public_id: fld, format: null, case_modifier: null, unknown_modifier: k };
    }
  }
  return { field_public_id: fld, format, case_modifier: cs };
}

function buildPlaceholder(fld: string, format: string | null, cs: string | null): string {
  const parts = [`field:${fld}`];
  if (format) parts.push(`format=${format}`);
  if (cs) parts.push(`case=${cs}`);
  return `{{${parts.join('|')}}}`;
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function listScannablePaths(zip: any): string[] {
  return Object.keys(zip.files || {}).filter((p) => {
    if (!p.startsWith('word/')) return false;
    if (!p.endsWith('.xml')) return false;
    if (p.startsWith('word/_rels/')) return false;
    if (p.startsWith('word/theme/')) return false;
    if (/word\/(styles|settings|webSettings|fontTable|numbering|stylesWithEffects)\.xml$/.test(p)) return false;
    if (p.endsWith('.xml.rels')) return false;
    return (
      p === 'word/document.xml' ||
      /^word\/header\d*\.xml$/.test(p) ||
      /^word\/footer\d*\.xml$/.test(p) ||
      p === 'word/footnotes.xml' ||
      p === 'word/endnotes.xml' ||
      p === 'word/comments.xml' ||
      /^word\/glossary\/document\.xml$/.test(p)
    );
  });
}

/**
 * Подсчитать общее количество вхождений `original_text` во всех видимых частях.
 * Используется для ambiguity-guard и для resolve `occurrence_index`.
 */
function countGlobalOccurrences(zip: any, paths: string[], original_text: string): number {
  if (!original_text) return 0;
  let count = 0;
  for (const p of paths) {
    const file = zip.file(p);
    if (!file) continue;
    const xml = file.asText();
    const wtRe = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = wtRe.exec(xml)) !== null) {
      const decoded = m[2]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      let from = 0;
      while (true) {
        const idx = decoded.indexOf(original_text, from);
        if (idx < 0) break;
        count++;
        from = idx + original_text.length;
      }
    }
    // Add merged-run extras (split-run occurrences)
    const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    let pm: RegExpExecArray | null;
    while ((pm = paraRe.exec(xml)) !== null) {
      const para = pm[0];
      const tRe = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
      const decodedRuns: string[] = [];
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(para)) !== null) {
        decodedRuns.push(
          tm[2]
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
        );
      }
      if (decodedRuns.length < 2) continue;
      const concatenated = decodedRuns.join('');
      let f = 0; let cc = 0;
      while (true) {
        const idx = concatenated.indexOf(original_text, f);
        if (idx < 0) break;
        cc++;
        f = idx + original_text.length;
      }
      let sc = 0;
      for (const dr of decodedRuns) {
        let g = 0;
        while (true) {
          const idx = dr.indexOf(original_text, g);
          if (idx < 0) break;
          sc++;
          g = idx + original_text.length;
        }
      }
      count += Math.max(0, cc - sc);
    }
  }
  return count;
}

/**
 * Замена в одной XML-части. Если задан occurrence_index — меняет только N-е
 * вхождение (по running counter в state), иначе все.
 */
function applyReplacementsToXml(
  xml: string,
  replacements: Array<{ original_text: string; placeholder: string; occurrence_index: number | null }>,
  state: { seen: Map<string, number> },
): { xml: string; appliedByOriginal: Map<string, number> } {
  const appliedByOriginal = new Map<string, number>();
  let content = xml;

  const shouldReplaceAt = (key: string, target: number | null): boolean => {
    const cur = state.seen.get(key) ?? 0;
    if (target == null) return true;
    return cur === target;
  };
  const incSeen = (key: string) => {
    state.seen.set(key, (state.seen.get(key) ?? 0) + 1);
  };

  // pass A: single <w:t>
  for (const r of replacements) {
    const wtRe = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
    let totalApplied = 0;
    content = content.replace(wtRe, (full, attrs, body) => {
      const decoded = (body as string)
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      if (!decoded.includes(r.original_text)) return full;
      let out = '';
      let cursor = 0;
      while (true) {
        const idx = decoded.indexOf(r.original_text, cursor);
        if (idx < 0) { out += decoded.slice(cursor); break; }
        out += decoded.slice(cursor, idx);
        if (shouldReplaceAt(r.original_text, r.occurrence_index)) {
          out += r.placeholder;
          totalApplied++;
        } else {
          out += r.original_text;
        }
        incSeen(r.original_text);
        cursor = idx + r.original_text.length;
      }
      const safeAttrs = attrs ?? '';
      const attrsWithSpace = / xml:space="preserve"/.test(safeAttrs)
        ? safeAttrs
        : `${safeAttrs} xml:space="preserve"`;
      return `<w:t${attrsWithSpace}>${escXml(out)}</w:t>`;
    });
    if (totalApplied > 0) {
      appliedByOriginal.set(r.original_text, (appliedByOriginal.get(r.original_text) ?? 0) + totalApplied);
    }
  }

  // pass B: paragraph-level merge for split runs
  const remaining = replacements.filter((r) => !appliedByOriginal.has(r.original_text));
  if (remaining.length > 0) {
    const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    content = content.replace(paraRe, (paragraph) => {
      let para = paragraph;
      for (const r of remaining) {
        const tRe = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
        const runs: Array<{ start: number; end: number; body: string; openTag: string; closeTag: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = tRe.exec(para)) !== null) {
          runs.push({
            start: m.index,
            end: m.index + m[0].length,
            body: m[2],
            openTag: `<w:t${m[1] ?? ''}>`,
            closeTag: '</w:t>',
          });
        }
        if (runs.length === 0) continue;
        const decodedTexts = runs.map((rr) =>
          rr.body
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
        );
        const concatenated = decodedTexts.join('');
        const idx = concatenated.indexOf(r.original_text);
        if (idx < 0) continue;
        if (!shouldReplaceAt(r.original_text, r.occurrence_index)) {
          incSeen(r.original_text);
          continue;
        }
        incSeen(r.original_text);

        const endIdx = idx + r.original_text.length;
        let cursor = 0;
        let firstRunIdx = -1;
        let lastRunIdx = -1;
        const offsets: number[] = [];
        for (let i = 0; i < decodedTexts.length; i++) {
          const len = decodedTexts[i].length;
          offsets.push(cursor);
          const runStart = cursor;
          const runEnd = cursor + len;
          if (firstRunIdx < 0 && runEnd > idx) firstRunIdx = i;
          if (runStart < endIdx) lastRunIdx = i;
          cursor += len;
        }
        if (firstRunIdx < 0 || lastRunIdx < 0) continue;

        const newBodies = decodedTexts.slice();
        const before = decodedTexts[firstRunIdx].slice(0, idx - offsets[firstRunIdx]);
        const afterFromLast = decodedTexts[lastRunIdx].slice(endIdx - offsets[lastRunIdx]);
        if (firstRunIdx === lastRunIdx) {
          newBodies[firstRunIdx] = before + r.placeholder + afterFromLast;
        } else {
          newBodies[firstRunIdx] = before + r.placeholder;
          for (let i = firstRunIdx + 1; i < lastRunIdx; i++) newBodies[i] = '';
          newBodies[lastRunIdx] = afterFromLast;
        }

        let rebuilt = para;
        for (let i = runs.length - 1; i >= 0; i--) {
          if (newBodies[i] === decodedTexts[i]) continue;
          const rr = runs[i];
          const openTag = / xml:space="preserve"/.test(rr.openTag)
            ? rr.openTag
            : rr.openTag.replace(/>$/, ' xml:space="preserve">');
          const newRun = `${openTag}${escXml(newBodies[i])}${rr.closeTag}`;
          rebuilt = rebuilt.slice(0, rr.start) + newRun + rebuilt.slice(rr.end);
        }
        para = rebuilt;
        appliedByOriginal.set(r.original_text, (appliedByOriginal.get(r.original_text) ?? 0) + 1);
      }
      return para;
    });
  }

  return { xml: content, appliedByOriginal };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // --- auth: JWT + admin role
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: authData } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const userId = authData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: roleRows } = await supabase.from('user_roles_v2').select('roles!inner(code)').eq('user_id', userId);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    if (!codes.some((c: string) => ['admin', 'super_admin', 'owner'].includes(c))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- input
    const body = await req.json().catch(() => ({}));
    const sourceVersionId: string | null = body.template_version_id || null;
    const replacementsRaw: Replacement[] = Array.isArray(body.replacements) ? body.replacements : [];
    const activate: boolean = !!body.activate;
    const clearDraft: boolean = body.clear_draft !== false; // default true
    if (!sourceVersionId) {
      return new Response(JSON.stringify({ error: 'template_version_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const accepted = replacementsRaw.filter(
      (r) => r && (r.status === 'accepted' || r.status === 'changed' || r.status === 'manually_added'),
    );
    if (accepted.length === 0) {
      return new Response(JSON.stringify({ error: 'no_accepted_replacements' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // validate FLD ids
    const fldIds = Array.from(new Set(accepted.map((r) => r.field_public_id).filter(Boolean)));
    for (const fid of fldIds) {
      if (!/^FLD-\d+$/.test(fid)) {
        return new Response(JSON.stringify({ error: 'invalid_field_public_id', field_public_id: fid }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    const { data: knownFields } = await supabase
      .from('fields_registry')
      .select('public_id')
      .in('public_id', fldIds)
      .is('archived_at', null);
    const knownSet = new Set((knownFields ?? []).map((x: any) => x.public_id));
    const missing = fldIds.filter((id) => !knownSet.has(id));
    if (missing.length > 0) {
      return new Response(JSON.stringify({ error: 'unknown_field_public_id', missing }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- load source version
    const { data: srcVer, error: srcErr } = await supabase
      .from('document_template_versions')
      .select('*')
      .eq('id', sourceVersionId)
      .maybeSingle();
    if (srcErr || !srcVer) {
      return new Response(JSON.stringify({ error: 'version_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- download DOCX
    const { data: blob, error: dlErr } = await supabase.storage.from(srcVer.storage_bucket).download(srcVer.storage_path);
    if (dlErr || !blob) {
      return new Response(JSON.stringify({ error: 'download_failed', detail: dlErr?.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const buf = new Uint8Array(await blob.arrayBuffer());

    // --- apply replacements
    const zip = new PizZip(buf);
    const paths = listScannablePaths(zip);

    // C5-D ambiguity guard: count global occurrences per replacement first.
    const ambiguous: Array<{ original_text: string; field_public_id: string; occurrences: number }> = [];
    const placeholderMap: Array<{
      original_text: string;
      placeholder: string;
      field_public_id: string;
      format: string | null;
      case_modifier: string | null;
      occurrence_index: number | null;
    }> = [];
    for (const r of accepted) {
      const fmt = (r.format && ALLOWED_FORMATS.has(r.format)) ? r.format : null;
      const cs = (r.case_modifier && ALLOWED_CASES.has(r.case_modifier)) ? r.case_modifier : null;
      const occIdx = (typeof r.occurrence_index === 'number' && r.occurrence_index >= 0)
        ? r.occurrence_index : null;
      const total = countGlobalOccurrences(zip, paths, r.original_text);
      if (total > 1 && occIdx == null) {
        ambiguous.push({
          original_text: r.original_text,
          field_public_id: r.field_public_id,
          occurrences: total,
        });
        continue;
      }
      placeholderMap.push({
        original_text: r.original_text,
        placeholder: buildPlaceholder(r.field_public_id, fmt, cs),
        field_public_id: r.field_public_id,
        format: fmt,
        case_modifier: cs,
        occurrence_index: occIdx,
      });
    }

    const totalApplied = new Map<string, number>();
    const stateByOriginal = { seen: new Map<string, number>() };
    for (const p of paths) {
      const file = zip.file(p);
      if (!file) continue;
      const xml = file.asText();
      const { xml: out, appliedByOriginal } = applyReplacementsToXml(xml, placeholderMap, stateByOriginal);
      if (out !== xml) zip.file(p, out);
      for (const [k, v] of appliedByOriginal) totalApplied.set(k, (totalApplied.get(k) ?? 0) + v);
    }
    const missedReplacements = placeholderMap.filter((r) => !totalApplied.has(r.original_text));

    // --- pack new docx
    const outBytes = zip.generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;

    // --- next version_number
    const { data: maxRow } = await supabase
      .from('document_template_versions')
      .select('version_number')
      .eq('template_id', srcVer.template_id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version_number ?? 0) + 1;

    // --- upload new file
    const ts = Date.now();
    const baseName = (srcVer.file_name ?? 'template.docx').replace(/\.docx$/i, '');
    const newStoragePath = `templates/${ts}-v${nextVersion}-${baseName.replace(/[^a-zA-Z0-9._-]/g, '_')}.docx`;
    const { error: upErr } = await supabase.storage
      .from(srcVer.storage_bucket)
      .upload(newStoragePath, outBytes, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    if (upErr) {
      return new Response(JSON.stringify({ error: 'upload_failed', detail: upErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- re-extract tokens & validate strict
    const parsed = extractDocxTokensWithLocations(outBytes);
    const validationErrors: any[] = [];
    const recognizedTokens: Array<{
      placeholder: string;
      field_public_id: string;
      format: string | null;
      case_modifier: string | null;
    }> = [];
    const allFldInDoc: string[] = [];
    for (const tk of parsed.tokens) {
      const inside = tk.trim();
      // Legacy формат: document.*, executor.*, customer.*, deal.*, cf.*
      if (/^(document|executor|customer|deal|cf)\./i.test(inside)) {
        validationErrors.push({
          code: 'legacy_placeholder_format_detected',
          placeholder: `{{${inside}}}`,
          message: `В шаблоне найден старый формат плейсхолдера «{{${inside}}}». Используйте только {{field:FLD-XXXXXX}}.`,
        });
        continue;
      }
      const parsedTok = parseStrictToken(inside);
      if (!parsedTok) {
        validationErrors.push({
          code: 'legacy_placeholder_format_detected',
          placeholder: `{{${inside}}}`,
          message: `Невалидный плейсхолдер «{{${inside}}}». Допустим только {{field:FLD-XXXXXX}}.`,
        });
        continue;
      }
      if (parsedTok.unknown_modifier) {
        validationErrors.push({
          code: 'unknown_modifier',
          placeholder: `{{${inside}}}`,
          message: `Неподдерживаемый модификатор «${parsedTok.unknown_modifier}». Допустимы только format=words, format=text и case=...`,
        });
        continue;
      }
      if (parsedTok.invalid_value) {
        validationErrors.push({
          code: 'unknown_modifier',
          placeholder: `{{${inside}}}`,
          message: `Недопустимое значение модификатора «${parsedTok.invalid_value}».`,
        });
        continue;
      }
      allFldInDoc.push(parsedTok.field_public_id);
      recognizedTokens.push({
        placeholder: `{{${inside}}}`,
        field_public_id: parsedTok.field_public_id,
        format: parsedTok.format,
        case_modifier: parsedTok.case_modifier,
      });
    }
    // verify all FLD exist + load data_type for warnings/manifest
    const fieldMeta = new Map<string, { data_type: string; label: string; required: boolean }>();
    if (allFldInDoc.length > 0) {
      const { data: chk } = await supabase
        .from('fields_registry')
        .select('public_id, data_type, label, is_required')
        .in('public_id', allFldInDoc)
        .is('archived_at', null);
      for (const row of (chk ?? []) as any[]) {
        fieldMeta.set(row.public_id, {
          data_type: (row.data_type ?? 'string').toLowerCase(),
          label: row.label ?? '',
          required: !!row.is_required,
        });
      }
      for (const fld of allFldInDoc) {
        if (!fieldMeta.has(fld)) {
          validationErrors.push({
            code: 'unknown_field_public_id',
            placeholder: `{{field:${fld}}}`,
            message: `Field ID ${fld} не найден в каталоге полей.`,
          });
        }
      }
    }
    // Warnings (не блокируют валидацию)
    const validationWarnings: any[] = [];
    const TEXT_DT = new Set(['string', 'text', 'email', 'phone']);
    const NUM_DT = new Set(['number', 'money', 'date', 'datetime']);
    for (const t of recognizedTokens) {
      const meta = fieldMeta.get(t.field_public_id);
      if (!meta) continue;
      if (t.format === 'words' && TEXT_DT.has(meta.data_type)) {
        validationWarnings.push({
          code: 'format_words_on_text_field',
          placeholder: t.placeholder,
          message: 'format=words применяется к суммам/числам/датам. Для текстового поля используйте падеж без format=words.',
        });
      }
      if (t.format === 'text' && meta.data_type !== 'boolean') {
        validationWarnings.push({
          code: 'format_text_on_non_boolean_field',
          placeholder: t.placeholder,
          message: 'format=text применим только к boolean-полям.',
        });
      }
      if (!t.format && t.case_modifier && NUM_DT.has(meta.data_type)) {
        validationWarnings.push({
          code: 'case_on_non_text_field_without_words',
          placeholder: t.placeholder,
          message: 'Падеж для числа/даты/суммы корректно работает только вместе с format=words.',
        });
      }
    }
    if (parsed.tokens.length === 0) {
      validationErrors.push({
        code: 'no_placeholders_in_template',
        message: 'В шаблоне не найдено ни одного плейсхолдера.',
      });
    }
    const validationStatus = validationErrors.length === 0 ? 'valid' : 'invalid';

    // --- token_manifest: field_public_id + format + case_modifier + label + data_type
    const manifestKey = (t: typeof recognizedTokens[number]) =>
      `${t.field_public_id}|${t.format ?? ''}|${t.case_modifier ?? ''}`;
    const manifestMap = new Map<string, any>();
    for (const t of recognizedTokens) {
      const k = manifestKey(t);
      if (manifestMap.has(k)) continue;
      const meta = fieldMeta.get(t.field_public_id);
      manifestMap.set(k, {
        field_public_id: t.field_public_id,
        placeholder: t.placeholder,
        format: t.format,
        case_modifier: t.case_modifier,
        label: meta?.label ?? null,
        data_type: meta?.data_type ?? null,
        required: meta?.required ?? false,
      });
    }
    const tokenManifest = Array.from(manifestMap.values());

    // --- insert new version row
    const { data: newVer, error: insErr } = await supabase
      .from('document_template_versions')
      .insert({
        template_id: srcVer.template_id,
        version_number: nextVersion,
        storage_bucket: srcVer.storage_bucket,
        storage_path: newStoragePath,
        file_name: `${baseName}.v${nextVersion}.docx`,
        file_size_bytes: outBytes.byteLength,
        is_current: false,
        detected_tokens: parsed.tokens as any,
        token_manifest: tokenManifest as any,
        unmapped_tokens: [],
        tokens: parsed.tokens as any,
        validation_status: validationStatus,
        validation_errors: validationErrors as any,
        validation_checked_at: new Date().toISOString(),
        markup_status: 'marked',
        notes: body.new_version_notes ?? null,
        created_by: userId,
      })
      .select('id')
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: 'version_insert_failed', detail: insErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // --- audit
    await supabase.from('audit_logs').insert({
      actor_user_id: userId,
      actor_type: 'user',
      action: 'document_template.markup_applied',
      meta: {
        template_id: srcVer.template_id,
        source_version_id: sourceVersionId,
        new_version_id: newVer.id,
        new_version_number: nextVersion,
        applied_count: Array.from(totalApplied.values()).reduce((a, b) => a + b, 0),
        missed_count: missedReplacements.length,
        skipped_count: replacementsRaw.length - accepted.length,
        validation_status: validationStatus,
        validation_errors_count: validationErrors.length,
        validation_warnings_count: validationWarnings.length,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        new_version_id: newVer.id,
        new_version_number: nextVersion,
        new_storage_path: newStoragePath,
        applied_count: Array.from(totalApplied.values()).reduce((a, b) => a + b, 0),
        missed: missedReplacements.map((r) => ({ original_text: r.original_text, field_public_id: r.field_public_id })),
        validation: { status: validationStatus, errors: validationErrors, warnings: validationWarnings, recognized: recognizedTokens },
        token_manifest: tokenManifest,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
