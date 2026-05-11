import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveSystemTokens, extractUsedTokens } from "../_shared/systemTokens.ts";
import { resolveCustomFieldTokens, extractCustomFieldTokenIds } from "../_shared/customFieldTokens.ts";
import { evaluateBroadcastGuards, auditBlockedAttempt } from "../_shared/broadcast-guards.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Sanitize HTML attribute values that were corrupted by markdown-style
 * link wrapping: src="[https://x/y](https://x/y)" → src="https://x/y".
 *
 * This happens when content is pasted from editors (Tilda export, chat apps,
 * markdown previewers) that auto-linkify URLs inside attribute values.
 * Browsers and email clients cannot resolve such "URLs", so images and links
 * silently break.
 *
 * Strategy:
 *   1. For src=, href=, srcset=, background=, action=, poster= and
 *      data-*-url style attributes: if the value matches the markdown
 *      pattern [X](Y), replace with Y (the URL inside parens).
 *   2. Idempotent: a clean URL passes through unchanged.
 *   3. Quote-style preserved (single or double).
 */
function sanitizeMarkdownWrappedAttributes(html: string): string {
  if (!html || typeof html !== 'string') return html;
  if (!html.includes('](')) return html; // fast path: no markdown link syntax at all

  const ATTRS = ['src', 'href', 'srcset', 'background', 'action', 'poster', 'cite', 'formaction'];
  // Matches: attr="[anything](URL)"  or  attr='[anything](URL)'
  // Group 1: attr name; Group 2: quote char; Group 3: URL inside parens
  const pattern = new RegExp(
    `\\b(${ATTRS.join('|')})\\s*=\\s*(["'])\\[[^\\]]*\\]\\(([^)\\s"']+)\\)\\2`,
    'gi',
  );

  return html.replace(pattern, (_m, attr, quote, url) => `${attr}=${quote}${url}${quote}`);
}

/**
 * Resolve standard contact tokens in a template string.
 */
function resolveContactTokens(
  text: string,
  profile: { full_name?: string | null; email?: string | null; phone?: string | null; telegram_username?: string | null }
): string {
  if (!text.includes('{{')) return text;
  
  const fullName = profile.full_name || '';
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  return text
    // Legacy unprefixed
    .replace(/\{\{full_name\}\}/g, fullName)
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{last_name\}\}/g, lastName)
    .replace(/\{\{name\}\}/g, fullName)
    .replace(/\{\{email\}\}/g, profile.email || '')
    .replace(/\{\{phone\}\}/g, profile.phone || '')
    .replace(/\{\{telegram_username\}\}/g, profile.telegram_username || '')
    // Canonical prefixed (Sprint canonical picker)
    .replace(/\{\{contact\.full_name\}\}/g, fullName)
    .replace(/\{\{contact\.first_name\}\}/g, firstName)
    .replace(/\{\{contact\.last_name\}\}/g, lastName)
    .replace(/\{\{contact\.email\}\}/g, profile.email || '')
    .replace(/\{\{contact\.phone\}\}/g, profile.phone || '')
    .replace(/\{\{contact\.telegram_username\}\}/g, profile.telegram_username || '');
}

interface EmailAccount {
  id: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_password: string;
  smtp_encryption: string;
  from_name: string;
  from_email: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64Utf8(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function wrapBase64(value: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += lineLength) {
    lines.push(value.slice(i, i + lineLength));
  }
  return lines.join("\r\n");
}

function parseSmtpCode(response: string): number {
  const m = response.match(/^(\d{3})/m);
  return m ? Number(m[1]) : 0;
}

async function getEmailAccount(supabase: any): Promise<EmailAccount | null> {
  // Try integration_instances first
  const { data: integration } = await supabase
    .from("integration_instances")
    .select("*")
    .eq("category", "email")
    .eq("is_default", true)
    .maybeSingle();

  if (integration?.config) {
    const config = integration.config as Record<string, unknown>;
    return {
      id: integration.id,
      email: config.email as string || "",
      smtp_host: config.smtp_host as string || "",
      smtp_port: Number(config.smtp_port) || 465,
      smtp_password: config.smtp_password as string || "",
      smtp_encryption: config.smtp_encryption as string || "SSL",
      from_name: config.from_name as string || integration.alias,
      from_email: config.from_email as string || config.email as string || "",
    };
  }

  // Try email_accounts
  const { data: account } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle();

  return account;
}

async function sendEmailViaSMTP(params: {
  to: string;
  subject: string;
  html: string;
  account: EmailAccount;
}): Promise<boolean> {
  const { account } = params;

  let smtpHost = account.smtp_host;
  let smtpPort = account.smtp_port || 465;
  const username = account.email;
  let password = account.smtp_password;
  const fromName = account.from_name || "Gorbova.by";
  const fromEmail = account.from_email || account.email;

  if (!smtpHost) {
    const domain = username.split("@")[1]?.toLowerCase();
    const smtpSettings: Record<string, { host: string; port: number }> = {
      "yandex.ru": { host: "smtp.yandex.ru", port: 465 },
      "yandex.com": { host: "smtp.yandex.ru", port: 465 },
      "gmail.com": { host: "smtp.gmail.com", port: 465 },
      "mail.ru": { host: "smtp.mail.ru", port: 465 },
    };
    const detected = smtpSettings[domain] || { host: "smtp.yandex.ru", port: 465 };
    smtpHost = detected.host;
    smtpPort = detected.port;
  }

  if (!password && smtpHost.includes("yandex")) {
    password = Deno.env.get("YANDEX_SMTP_PASSWORD") || "";
  }

  if (!password) {
    throw new Error(`SMTP password not set for ${username}`);
  }

  let conn: Deno.TlsConn;
  conn = await Deno.connectTls({ hostname: smtpHost, port: smtpPort });

  async function readResponse(): Promise<string> {
    let out = "";
    const buf = new Uint8Array(4096);
    while (!out.includes("\n")) {
      const n = await conn.read(buf);
      if (n === null) break;
      out += decoder.decode(buf.subarray(0, n));
      if (n < buf.length) break;
    }
    return out;
  }

  async function sendCommand(cmd: string, expectCodes?: number[]): Promise<string> {
    await conn.write(encoder.encode(cmd + "\r\n"));
    const response = await readResponse();
    if (expectCodes && expectCodes.length) {
      const code = parseSmtpCode(response);
      if (!expectCodes.includes(code)) {
        throw new Error(`SMTP error ${code}: ${response.trim()}`);
      }
    }
    return response;
  }

  try {
    const greeting = await readResponse();
    if (parseSmtpCode(greeting) !== 220) throw new Error(`SMTP greeting failed`);

    const domain = username.split("@")[1] || "gorbova.by";
    await sendCommand(`EHLO ${domain}`, [250]);
    await sendCommand("AUTH LOGIN", [334]);
    await sendCommand(b64Utf8(username), [334]);
    
    const passResp = await sendCommand(b64Utf8(password));
    if (parseSmtpCode(passResp) !== 235) throw new Error("SMTP auth failed");

    await sendCommand(`MAIL FROM:<${fromEmail}>`, [250]);
    await sendCommand(`RCPT TO:<${params.to}>`, [250, 251]);
    await sendCommand("DATA", [354]);

    const boundary = `boundary_${crypto.randomUUID()}`;
    const subjectEncoded = `=?UTF-8?B?${b64Utf8(params.subject)}?=`;
    const htmlPart = wrapBase64(b64Utf8(params.html));

    const dataLines = [
      `From: "${fromName}" <${fromEmail}>`,
      `To: ${params.to}`,
      `Subject: ${subjectEncoded}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      htmlPart,
      "",
      `--${boundary}--`,
      "",
      ".",
    ].join("\r\n");

    await conn.write(encoder.encode(dataLines + "\r\n"));
    const dataResp = await readResponse();
    if (parseSmtpCode(dataResp) !== 250) throw new Error("SMTP DATA failed");

    try { await sendCommand("QUIT"); } catch { /* ignore */ }
    return true;
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // NOTE: this 'supabase' is a SERVICE_ROLE client (RLS bypass).
    // Required by resolveCustomFieldTokens and direct table queries.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ===== Auth path resolution =====
    // Two paths:
    //   (A) System actor (scheduled dispatcher): x-system-actor + internal secret.
    //   (B) User JWT with entitlements.manage permission.
    const authHeader = req.headers.get('Authorization');
    const systemActor = req.headers.get('x-system-actor');
    const internalSecretHeader = req.headers.get('x-broadcast-internal-secret');
    const internalSecretEnv =
      Deno.env.get('BROADCAST_INTERNAL_SECRET') ||
      Deno.env.get('BROADCAST_FORCE_SECRET') ||
      '';

    let isSystemActor = false;
    let user: { id: string } | null = null;

    if (systemActor || internalSecretHeader) {
      // System bypass attempted — both header pieces required and must match.
      const bearerSecret = authHeader?.startsWith('Bearer ')
        ? authHeader.replace('Bearer ', '')
        : '';
      const providedSecret = internalSecretHeader || bearerSecret;
      if (
        systemActor !== 'broadcast-dispatcher' ||
        !internalSecretEnv ||
        providedSecret !== internalSecretEnv
      ) {
        // Do NOT log secret values.
        console.warn('[email-broadcast] system bypass rejected', {
          actor: systemActor,
          has_secret: !!providedSecret,
        });
        return new Response(
          JSON.stringify({ error: 'Forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      isSystemActor = true;
    } else {
      // User JWT path (unchanged).
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const token = authHeader.replace('Bearer ', '');
      const { data: { user: authedUser }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authedUser) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { data: hasPermission } = await supabase.rpc('has_permission', {
        _user_id: authedUser.id,
        _permission_code: 'entitlements.manage',
      });
      if (!hasPermission) {
        return new Response(
          JSON.stringify({ error: 'Forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      user = { id: authedUser.id };
    }

    const reqBody = await req.json();
    const {
      subject,
      html,
      filters,
      product_context_id,
      dry_run,
      test_self,
      allow_full_audience,
      confirm_full_audience_text,
    } = reqBody;

    // Normalize product_context_id
    const productContextId = (product_context_id && product_context_id !== 'all') ? product_context_id : null;
    const isDryRun = dry_run === true;
    const isTestSelf = test_self === true;
    const allowFullAudience = allow_full_audience === true;
    const confirmFullAudienceText = typeof confirm_full_audience_text === 'string' ? confirm_full_audience_text : null;

    if (!subject || !html) {
      return new Response(
        JSON.stringify({ error: 'Subject and HTML are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== Sanitize markdown-wrapped attribute values =====
    // Fixes broken images/links from pasted Tilda/markdown HTML where
    // src="[URL](URL)" replaces a clean URL. Idempotent for clean HTML.
    const sanitizedHtml = sanitizeMarkdownWrappedAttributes(html);
    if (sanitizedHtml !== html) {
      console.log('[email-mass-broadcast] sanitized markdown-wrapped attributes in html');
    }

    // ===== PATCH-GUARD (user-path only): empty filters / short message / full-audience override =====
    if (!isSystemActor) {
      const guardText = `${subject || ''}\n${(sanitizedHtml || '').replace(/<[^>]+>/g, '')}`;
      const guard = evaluateBroadcastGuards({
        filters,
        messageText: guardText,
        isDryRun,
        isTestSelf,
        allowFullAudience,
        confirmFullAudienceText,
      });
      if (guard.blocked) {
        await auditBlockedAttempt({
          supabase,
          channel: 'email',
          actorUserId: user?.id ?? null,
          isSystemActor: false,
          reason: guard.reason,
          filters,
          messageText: guardText,
          extraMeta: { subject, dry_run: isDryRun, test_self: isTestSelf, ...guard.meta },
        });
        return new Response(
          JSON.stringify({
            error: guard.reason,
            message: guard.message,
            dry_run: isDryRun,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ===== P0 GUARD: prevent catastrophic full-scan =====
    // Detect "new schema" presence (any of include/exclude/club_ids supplied as arrays).
    const hasIncludeArr = Array.isArray(filters?.include);
    const hasExcludeArr = Array.isArray(filters?.exclude);
    const hasClubIdsArr = Array.isArray(filters?.club_ids);
    const hasNewSchemaShape = hasIncludeArr || hasExcludeArr || hasClubIdsArr;
    const newSchemaHasContent =
      (hasIncludeArr && (filters!.include as unknown[]).length > 0) ||
      (hasExcludeArr && (filters!.exclude as unknown[]).length > 0) ||
      (hasClubIdsArr && (filters!.club_ids as unknown[]).length > 0);

    // Rule 1: targeted broadcast (product_context_id given) MUST have audience filters.
    if (productContextId && !newSchemaHasContent) {
      console.error('[email-broadcast] GUARD: product_context_id without audience filters', {
        productContextId, hasNewSchemaShape, newSchemaHasContent,
      });
      return new Response(
        JSON.stringify({
          error: 'missing_audience_filters',
          message: 'product_context_id requires non-empty filters.include/exclude/club_ids to prevent catastrophic full-scan',
          dry_run: isDryRun,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rule 2: if new-schema shape is present at all, it must contain content.
    // (Empty include/exclude/club_ids arrays => caller intended targeting but forgot to fill it.)
    if (hasNewSchemaShape && !newSchemaHasContent) {
      console.error('[email-broadcast] GUARD: new-schema filters present but all empty');
      return new Response(
        JSON.stringify({
          error: 'missing_audience_filters',
          message: 'filters.include/exclude/club_ids present but all empty — refusing to broadcast to entire base',
          dry_run: isDryRun,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rule 3: validate include[]/exclude[] entries — every rule MUST contain a usable
    // product_id (non-empty string). This catches contract drift like {id:...} instead of {product_id:...}.
    if (hasIncludeArr || hasExcludeArr) {
      const allRules: any[] = [
        ...((filters?.include as any[]) || []),
        ...((filters?.exclude as any[]) || []),
      ];
      const badRule = allRules.find((r) => {
        const pid = typeof r?.product_id === 'string' ? r.product_id.trim() : '';
        // product_id may legitimately be empty IF tariff_ids non-empty (any product, specific tariffs)
        const hasTariffIds = Array.isArray(r?.tariff_ids) && r.tariff_ids.length > 0;
        return pid.length === 0 && !hasTariffIds;
      });
      if (badRule) {
        console.error('[email-broadcast] GUARD: include/exclude rule lacks product_id and tariff_ids', { badRule });
        return new Response(
          JSON.stringify({
            error: 'invalid_audience_rule',
            message: 'Each include/exclude rule must contain product_id (string) or non-empty tariff_ids[]',
            offending_rule: badRule,
            dry_run: isDryRun,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('Starting email broadcast...', { productContextId, hasNewSchemaShape, newSchemaHasContent });

    // Get email account
    const emailAccount = await getEmailAccount(supabase);
    if (!emailAccount) {
      return new Response(
        JSON.stringify({ error: 'No email account configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== Resolve audience via canonical CONTACT-LEVEL RPC =====
    // Source of truth: profiles + orders_v2 (purchased) / entitlements (active_access).
    // Returns one row per email-contact (profile_id + email), including ghost / no-account profiles.
    const useNewSchema = Array.isArray(filters?.include) || Array.isArray(filters?.exclude) || Array.isArray(filters?.club_ids);
    type ContactRow = {
      profile_id: string;
      email: string;
      email_normalized: string;
      user_id: string | null;
      has_account: boolean;
      is_archived: boolean;
      has_telegram: boolean;
      full_name: string | null;
      telegram_username: string | null;
    };
    let audienceContacts: ContactRow[] | null = null;

    if (useNewSchema) {
      const rpcFilters: Record<string, unknown> = {
        include: filters.include || [],
        exclude: filters.exclude || [],
        club_ids: filters.club_ids || [],
        club_membership: filters.club_membership || 'any',
        // По умолчанию архивные НЕ включаются. Явный opt-in приходит из UI.
        include_archived: (reqBody as Record<string, unknown>)?.include_archived === true,
      };
      let rpcErr: { message: string } | null = null;
      if (isSystemActor) {
        const r = await supabase.rpc('resolve_broadcast_audience_contacts_system', { _filters: rpcFilters });
        audienceContacts = (r.data as ContactRow[]) || [];
        rpcErr = r.error as typeof rpcErr;
      } else {
        const userClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader! } } }
        );
        const r = await userClient.rpc('resolve_broadcast_audience_contacts', { _filters: rpcFilters });
        audienceContacts = (r.data as ContactRow[]) || [];
        rpcErr = r.error as typeof rpcErr;
      }
      if (rpcErr) {
        console.error('[email-broadcast] contact RPC failed:', rpcErr);
        return new Response(
          JSON.stringify({ error: `Audience resolution failed: ${rpcErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ===== Diagnostic counters =====
    let allowedCount = 0;
    let foundCount = 0;
    let missingCount = 0;
    let duplicateCount = 0;
    let invalidEmailCount = 0;
    let archivedIncludedCount = 0;
    const invalidSample: Array<{ profile_id: string; email: string | null }> = [];

    let filteredProfiles: Array<{
      user_id: string | null;
      profile_id: string;
      email: string;
      full_name?: string | null;
      phone?: string | null;
      telegram_username?: string | null;
    }> = [];

    if (useNewSchema && audienceContacts) {
      // ===== CONTACT-LEVEL PATH =====
      allowedCount = audienceContacts.length;
      archivedIncludedCount = audienceContacts.filter(c => c.is_archived).length;

      if (allowedCount === 0) {
        console.warn('[email-broadcast] allowed audience is empty — nothing to send');
        return new Response(
          JSON.stringify({
            success: true,
            sent: 0,
            failed: 0,
            skipped: true,
            reason: 'empty_audience',
            dry_run: isDryRun,
            diagnostic: { allowed: 0, found: 0, missing: 0, duplicates: 0, invalid_emails: 0 },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Anti-duplicate guard: один email = одно письмо в рамках broadcast.
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seenEmails = new Set<string>();
      for (const c of audienceContacts) {
        const em = (c.email_normalized || c.email || '').trim().toLowerCase();
        if (!em || !emailRe.test(em)) {
          invalidEmailCount++;
          if (invalidSample.length < 10) invalidSample.push({ profile_id: c.profile_id, email: c.email });
          continue;
        }
        if (seenEmails.has(em)) { duplicateCount++; continue; }
        seenEmails.add(em);
        filteredProfiles.push({
          user_id: c.user_id,
          profile_id: c.profile_id,
          email: em,
          full_name: c.full_name,
          telegram_username: c.telegram_username,
        });
      }

      foundCount = filteredProfiles.length;
      missingCount = Math.max(0, allowedCount - (foundCount + invalidEmailCount + duplicateCount));

      console.log(`[email-broadcast] diagnostic: allowed=${allowedCount} found=${foundCount} archived_included=${archivedIncludedCount} duplicates=${duplicateCount} invalid_emails=${invalidEmailCount} dry_run=${isDryRun}`);
      if (invalidSample.length > 0) console.log('[email-broadcast] invalid emails (first 10):', invalidSample);
    } else {
      // ===== Legacy path: full email base via batch loading (no 10000 cap) =====
      const PAGE = 1000;
      const allProfiles: Array<{ id: string; user_id: string | null; email: string | null; full_name: string | null; phone: string | null; telegram_username: string | null; is_archived: boolean | null; status: string }>= [];
      let from = 0;
      while (true) {
        const { data, error: e } = await supabase
          .from('profiles')
          .select('id, user_id, email, full_name, phone, telegram_username, is_archived, status')
          .not('email', 'is', null)
          .range(from, from + PAGE - 1);
        if (e) throw e;
        const batch = (data || []) as typeof allProfiles;
        allProfiles.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
        if (allProfiles.length > 200000) break; // safety cap
      }

      const includeArchived = (reqBody as Record<string, unknown>)?.include_archived === true;
      const baseProfiles = allProfiles.filter(p => includeArchived ? true : !(p.is_archived || p.status === 'archived'));
      archivedIncludedCount = includeArchived ? allProfiles.filter(p => p.is_archived || p.status === 'archived').length : 0;

      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const seen = new Set<string>();
      for (const p of baseProfiles) {
        const em = (p.email || '').trim().toLowerCase();
        if (!em || !emailRe.test(em)) { invalidEmailCount++; continue; }
        if (seen.has(em)) { duplicateCount++; continue; }
        seen.add(em);
        filteredProfiles.push({
          user_id: p.user_id,
          profile_id: p.id,
          email: em,
          full_name: p.full_name,
          telegram_username: p.telegram_username,
        });
      }
      allowedCount = baseProfiles.length;
      foundCount = filteredProfiles.length;
    }

    console.log(`Sending to ${filteredProfiles.length} recipients (dry_run=${isDryRun})`);

    // ===== DRY-RUN short-circuit: do NOT send, return diagnostic + recipient list =====
    if (isDryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          would_send: filteredProfiles.length,
          diagnostic: {
            allowed: allowedCount,
            found: foundCount,
            missing: missingCount,
            duplicates: duplicateCount,
            invalid_emails: invalidEmailCount,
            archived_included: archivedIncludedCount,
            invalid_sample: invalidSample,
          },
          recipients: filteredProfiles.map(p => ({ profile_id: p.profile_id, user_id: p.user_id, email: p.email })),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // Extract token usage from original templates
    const combinedTemplate = subject + ' ' + sanitizedHtml;
    const tokensInfo = extractUsedTokens(combinedTemplate);
    const cfFieldIds = extractCustomFieldTokenIds(combinedTemplate);
    const broadcastNow = new Date();

    // Resolve cf tokens once (product-scoped, not per-user)
    let cfTokensIgnored = false;
    let subjectAfterCf = subject;
    let htmlAfterCf = sanitizedHtml;
    if (cfFieldIds.length > 0) {
      // NOTE: supabase is service_role client — required by resolveCustomFieldTokens
      const cfSubject = await resolveCustomFieldTokens(subject, productContextId, supabase);
      const cfHtml = await resolveCustomFieldTokens(sanitizedHtml, productContextId, supabase);
      subjectAfterCf = cfSubject.text;
      htmlAfterCf = cfHtml.text;
      cfTokensIgnored = cfSubject.cfTokensIgnored || cfHtml.cfTokensIgnored;
    }

    let sent = 0;
    let failed = 0;

    for (const profile of filteredProfiles) {
      if (!profile.email) continue;

      // Resolve chain: Contact → System (cf already resolved)
      const personalizedSubject = resolveSystemTokens(resolveContactTokens(subjectAfterCf, profile), broadcastNow);
      const personalizedHtml = resolveSystemTokens(resolveContactTokens(htmlAfterCf, profile), broadcastNow);

      try {
        await sendEmailViaSMTP({
          to: profile.email,
          subject: personalizedSubject,
          html: personalizedHtml,
          account: emailAccount,
        });
        sent++;
        console.log(`Email sent to ${profile.email}`);

        await supabase.from('email_logs').insert({
          direction: 'outgoing',
          from_email: emailAccount.from_email || emailAccount.email,
          to_email: profile.email,
          subject,
          body_html: sanitizedHtml,
          status: 'sent',
          profile_id: profile.user_id,
          template_code: 'mass_broadcast',
        });

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failed++;
        console.error(`Failed to send to ${profile.email}:`, error);

        await supabase.from('email_logs').insert({
          direction: 'outgoing',
          from_email: emailAccount.from_email || emailAccount.email,
          to_email: profile.email,
          subject,
          body_html: sanitizedHtml,
          status: 'failed',
          error_message: (error as Error).message,
          profile_id: profile.user_id,
          template_code: 'mass_broadcast',
        });
      }
    }

    // Log to audit_logs
    await supabase.from('audit_logs').insert({
      actor_user_id: isSystemActor ? null : user!.id,
      actor_type: isSystemActor ? 'system' : 'user',
      actor_label: isSystemActor ? 'broadcast-dispatcher' : null,
      action: 'email_mass_broadcast',
      meta: {
        sent,
        failed,
        total: sent + failed,
        subject,
        actor_type: isSystemActor ? 'system' : 'user',
        actor_label: isSystemActor ? 'broadcast-dispatcher' : undefined,
        source: isSystemActor ? 'scheduled_dispatcher' : undefined,
        include_archived: (reqBody as Record<string, unknown>)?.include_archived === true,
        tokens_used_contact: tokensInfo.contact,
        tokens_used_system: tokensInfo.system,
        tokens_used_cf_ids: cfFieldIds,
        cf_product_id: productContextId,
        cf_tokens_ignored: cfTokensIgnored,
        diagnostic: {
          allowed: allowedCount,
          found: foundCount,
          missing: missingCount,
          duplicates: duplicateCount,
          invalid_emails: invalidEmailCount,
          archived_included: archivedIncludedCount,
        },
      },
    });

    console.log(`Email broadcast complete: sent=${sent}, failed=${failed}`);

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        failed,
        diagnostic: {
          allowed: allowedCount,
          found: foundCount,
          missing: missingCount,
          duplicates: duplicateCount,
          invalid_emails: invalidEmailCount,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Email broadcast error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
