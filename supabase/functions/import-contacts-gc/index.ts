import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ParsedRow {
  gc_user_id?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  tg_id?: string;
  tg_username?: string;
  country?: string;
  city?: string;
  birth_date?: string;
  instagram_url?: string;
  gc_registered_at?: string;
}

interface ChunkMeta {
  index: number;
  total: number;
}

interface BatchTotals {
  total: number;
  created: number;
  updated: number;
  filtered_out: number;
  invalid: number;
  conflicts: number;
  errors: number;
  skipped_active: number;
  skipped_no_changes: number;
}

interface RowResult {
  row_index: number;
  email?: string;
  name?: string;
  action: 'create' | 'update' | 'skip' | 'conflict' | 'filtered' | 'invalid';
  reason?: string;
  profile_id?: string;
}

// ── Normalization ──────────────────────────────────────────────

function normalizeEmail(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : null;
}

function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.length < 9) return null;
  return cleaned;
}

function normalizeInstagram(v: string | undefined | null): string | null {
  if (!v) return null;
  let trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http')) return trimmed;
  trimmed = trimmed.replace(/^@/, '');
  if (!trimmed) return null;
  return `https://instagram.com/${trimmed}`;
}

function parseDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const ddmmyyyy = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return trimmed.substring(0, 10);
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  return null;
}

function normalizeTelegram(username: string | undefined | null): string | null {
  if (!username) return null;
  let cleaned = username.trim()
    .replace(/^https?:\/\/@?/i, '')
    .replace(/^@/, '')
    .replace(/\s+/g, '');
  if (!cleaned || cleaned.length < 2) return null;
  return cleaned.toLowerCase();
}

// ── Exclusion filters ──────────────────────────────────────────

function isExcluded(row: ParsedRow): string | null {
  const email = normalizeEmail(row.email);
  if (email && email.includes('7500084@gmail.com')) return 'excluded_email';
  const fullName = (row.full_name || `${row.first_name || ''} ${row.last_name || ''}`).trim();
  if (/сергей\s+федорчук/i.test(fullName)) return 'excluded_name';
  const fields = [row.email, row.first_name, row.last_name, row.full_name, row.phone];
  for (const f of fields) {
    if (f && /тест/i.test(f)) return 'excluded_test';
  }
  return null;
}

// ── Main handler ───────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mode, batch_id, rows, chunk, batch_totals, options } = await req.json() as {
      mode: 'dry_run' | 'execute';
      batch_id?: string;
      rows: ParsedRow[];
      chunk: ChunkMeta;
      batch_totals?: BatchTotals;
      options?: { error_threshold?: number };
    };

    if (!mode || !['dry_run', 'execute'].includes(mode)) {
      return new Response(JSON.stringify({ error: 'mode must be dry_run or execute' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: 'rows array is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate chunk meta
    if (!chunk || typeof chunk.index !== 'number' || typeof chunk.total !== 'number' || chunk.index < 0 || chunk.total < 1 || chunk.index >= chunk.total) {
      return new Response(JSON.stringify({ error: 'chunk { index, total } is required and must be valid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Max chunk size guard
    const MAX_CHUNK_SIZE = 2000;
    if (rows.length > MAX_CHUNK_SIZE) {
      return new Response(JSON.stringify({ error: `chunk too large, max ${MAX_CHUNK_SIZE} rows` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const errorThreshold = options?.error_threshold || 20;
    const actualBatchId = batch_id || crypto.randomUUID();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Collect keys from chunk for targeted matching ──
    const gcIds: string[] = [];
    const emails: string[] = [];
    const phoneKeys: string[] = [];
    const tgUsernames: string[] = [];

    for (const row of rows) {
      const gcId = row.gc_user_id?.trim();
      if (gcId) gcIds.push(gcId);

      const email = normalizeEmail(row.email);
      if (email) emails.push(email);

      const phone = normalizePhone(row.phone);
      if (phone) phoneKeys.push(phone.slice(-9));

      const tgUsername = normalizeTelegram(row.tg_username);
      if (tgUsername) tgUsernames.push(tgUsername);
    }

    // ── Fetch only relevant profiles via RPC ──
    const { data: candidateProfiles, error: rpcError } = await supabase
      .rpc('find_profiles_for_gc_import', {
        p_gc_ids: gcIds.length > 0 ? gcIds : [],
        p_emails: emails.length > 0 ? emails : [],
        p_phone_keys: phoneKeys.length > 0 ? phoneKeys : [],
        p_tg_usernames: tgUsernames.length > 0 ? tgUsernames : [],
      });

    if (rpcError) {
      console.error('[GC Import] RPC error:', rpcError);
      return new Response(JSON.stringify({ error: 'Failed to load candidate profiles', detail: rpcError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const profiles = candidateProfiles || [];

    // Build indexes from candidates
    const byGcId = new Map<string, typeof profiles[0]>();
    const byEmail = new Map<string, typeof profiles[0]>();
    const byPhone = new Map<string, typeof profiles[0][]>();
    const byTelegram = new Map<string, typeof profiles[0]>();

    for (const p of profiles) {
      if (p.external_id_gc) byGcId.set(p.external_id_gc, p);
      if (p.email) byEmail.set(p.email.toLowerCase().trim(), p);
      if (p.phone) {
        const norm = normalizePhone(p.phone);
        if (norm) {
          const key = norm.slice(-9);
          byPhone.set(key, [...(byPhone.get(key) || []), p]);
        }
      }
      if (p.telegram_username) byTelegram.set(p.telegram_username.toLowerCase(), p);
    }

    // ── Process ALL rows in chunk ──
    const results: RowResult[] = [];
    const counts = {
      total: rows.length,
      filtered_out: 0,
      invalid: 0,
      will_create: 0,
      will_update: 0,
      will_skip_active: 0,
      will_skip_exists: 0,
      conflicts: 0,
      errors: 0,
      created: 0,
      updated: 0,
    };

    let errorCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // 1. Exclusion filter
      const exclusionReason = isExcluded(row);
      if (exclusionReason) {
        counts.filtered_out++;
        results.push({ row_index: i, email: row.email, name: row.full_name, action: 'filtered', reason: exclusionReason });
        continue;
      }

      // 2. Normalize
      const email = normalizeEmail(row.email);
      const phone = normalizePhone(row.phone);
      const gcId = row.gc_user_id?.trim() || null;
      const tgUsername = normalizeTelegram(row.tg_username);
      const tgId = row.tg_id ? parseInt(row.tg_id, 10) : null;
      const firstName = row.first_name?.trim() || null;
      const lastName = row.last_name?.trim() || null;
      const fullName = row.full_name?.trim() || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null);
      const country = row.country?.trim() || null;
      const city = row.city?.trim() || null;
      const birthDate = parseDate(row.birth_date);
      const instagramUrl = normalizeInstagram(row.instagram_url);
      const gcRegisteredAt = parseDate(row.gc_registered_at);

      // 3. Validate: need gcId or email or phone
      if (!gcId && !email && !phone) {
        counts.invalid++;
        results.push({ row_index: i, email: row.email, name: fullName, action: 'invalid', reason: 'no_gc_id_email_phone' });
        continue;
      }

      // 4. Matching
      let matched: typeof profiles[0] | null = null;
      let matchType = '';

      if (gcId && byGcId.has(gcId)) {
        matched = byGcId.get(gcId)!;
        matchType = 'gc_id';
      }

      if (!matched && email && byEmail.has(email)) {
        matched = byEmail.get(email)!;
        matchType = 'email';
      }

      if (!matched && phone) {
        const phoneKey = phone.slice(-9);
        const phoneMatches = byPhone.get(phoneKey) || [];
        if (phoneMatches.length === 1) {
          const phoneMatch = phoneMatches[0];
          if (email && phoneMatch.email && phoneMatch.email.toLowerCase() !== email) {
            counts.conflicts++;
            results.push({ row_index: i, email: row.email, name: fullName, action: 'conflict', reason: 'phone_email_mismatch' });
            continue;
          }
          matched = phoneMatch;
          matchType = 'phone';
        } else if (phoneMatches.length > 1) {
          counts.conflicts++;
          results.push({ row_index: i, email: row.email, name: fullName, action: 'conflict', reason: 'ambiguous_phone' });
          continue;
        }
      }

      if (!matched && tgUsername && byTelegram.has(tgUsername)) {
        matched = byTelegram.get(tgUsername)!;
        matchType = 'telegram';
      }

      // 5. Decide action
      if (matched) {
        if (matched.status === 'active' && matched.user_id) {
          counts.will_skip_active++;
          results.push({ row_index: i, email: row.email, name: fullName, action: 'skip', reason: 'active_profile', profile_id: matched.id });
          continue;
        }

        // Update empty fields only
        const updates: Record<string, unknown> = {};
        if (!matched.email && email) updates.email = email;
        if (!matched.phone && phone) updates.phone = phone;
        if (!matched.full_name && fullName) updates.full_name = fullName;
        if (!matched.first_name && firstName) updates.first_name = firstName;
        if (!matched.last_name && lastName) updates.last_name = lastName;
        if (!matched.external_id_gc && gcId) updates.external_id_gc = gcId;
        if (!matched.telegram_username && tgUsername) updates.telegram_username = tgUsername;
        if (!matched.telegram_user_id && tgId) updates.telegram_user_id = tgId;
        if (!matched.country && country) updates.country = country;
        if (!matched.city && city) updates.city = city;
        if (!matched.birth_date && birthDate) updates.birth_date = birthDate;
        if (!matched.instagram_url && instagramUrl) updates.instagram_url = instagramUrl;
        if (!matched.gc_registered_at && gcRegisteredAt) updates.gc_registered_at = gcRegisteredAt;

        if (Object.keys(updates).length === 0) {
          counts.will_skip_exists++;
          results.push({ row_index: i, email: row.email, name: fullName, action: 'skip', reason: 'no_changes', profile_id: matched.id });
          continue;
        }

        counts.will_update++;
        results.push({ row_index: i, email: row.email, name: fullName, action: 'update', reason: matchType, profile_id: matched.id });

        if (mode === 'execute') {
          updates.updated_at = new Date().toISOString();
          const { error } = await supabase.from('profiles').update(updates).eq('id', matched.id);
          if (error) {
            console.error(`[GC Import] Update error for ${matched.id}:`, error);
            errorCount++;
            counts.errors++;
            if (errorCount >= errorThreshold) {
              console.error(`[GC Import] Error threshold (${errorThreshold}) reached, aborting chunk ${chunk.index}`);
              break;
            }
          } else {
            counts.updated++;
          }
        }
      } else {
        // Create new profile
        counts.will_create++;
        results.push({ row_index: i, email: row.email, name: fullName, action: 'create' });

        if (mode === 'execute') {
          const insertData: Record<string, unknown> = {
            user_id: null,
            status: 'archived',
            is_archived: true,
            source: 'getcourse_import',
            import_batch_id: actualBatchId,
          };
          if (gcId) insertData.external_id_gc = gcId;
          if (email) insertData.email = email;
          if (phone) insertData.phone = phone;
          if (fullName) insertData.full_name = fullName;
          if (firstName) insertData.first_name = firstName;
          if (lastName) insertData.last_name = lastName;
          if (tgUsername) insertData.telegram_username = tgUsername;
          if (tgId) insertData.telegram_user_id = tgId;
          if (country) insertData.country = country;
          if (city) insertData.city = city;
          if (birthDate) insertData.birth_date = birthDate;
          if (instagramUrl) insertData.instagram_url = instagramUrl;
          if (gcRegisteredAt) insertData.gc_registered_at = gcRegisteredAt;

          const { error } = await supabase.from('profiles').insert(insertData);
          if (error) {
            console.error(`[GC Import] Insert error for ${email}:`, error);
            errorCount++;
            counts.errors++;
            if (errorCount >= errorThreshold) {
              console.error(`[GC Import] Error threshold (${errorThreshold}) reached, aborting chunk ${chunk.index}`);
              break;
            }
          } else {
            counts.created++;
            // Update indexes to prevent duplicates within same chunk
            if (gcId) byGcId.set(gcId, insertData as any);
            if (email) byEmail.set(email, insertData as any);
          }
        }
      }
    }

    // ── Audit log (execute only, last chunk only) ──
    if (mode === 'execute' && chunk.index === chunk.total - 1) {
      const auditTotals = batch_totals || {
        total: counts.total,
        created: counts.created,
        updated: counts.updated,
        filtered_out: counts.filtered_out,
        invalid: counts.invalid,
        conflicts: counts.conflicts,
        errors: counts.errors,
        skipped_active: counts.will_skip_active,
        skipped_no_changes: counts.will_skip_exists,
      };

      await supabase.from('audit_logs').insert({
        actor_type: 'system',
        actor_user_id: null,
        actor_label: 'import-contacts-gc',
        action: 'gc_contacts_import',
        meta: {
          batch_id: actualBatchId,
          mode,
          chunk_count: chunk.total,
          ...auditTotals,
        },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      mode,
      batch_id: actualBatchId,
      chunk,
      counts_chunk: counts,
      aborted: errorCount >= errorThreshold,
      preview: results.slice(0, 200),
      conflicts: results.filter(r => r.action === 'conflict').slice(0, 100),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[GC Import] Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
