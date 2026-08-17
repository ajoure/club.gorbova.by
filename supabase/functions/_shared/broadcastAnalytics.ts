import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type ServiceClient = SupabaseClient;

export interface BroadcastAnalyticsContextInput {
  campaignId: string;
  channel: "telegram" | "email";
  name: string;
  source?: "contact_center" | "scheduled_dispatcher" | "automation" | "system" | "historical";
  sendMode?: "manual" | "scheduled" | "recurring" | "event" | "test" | "historical";
  templateId?: string | null;
  runId?: string | null;
  createdBy?: string | null;
  audienceFilters?: Record<string, unknown>;
  audienceSnapshot?: Record<string, unknown>;
  contentSnapshot?: Record<string, unknown>;
}

export interface BroadcastAnalyticsContext {
  campaignId: string;
  runId: string;
  channel: "telegram" | "email";
}

export interface AnalyticsRecipient {
  profileId?: string | null;
  userId?: string | null;
  recipientKey: string;
  botId?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsDelivery extends AnalyticsRecipient {
  id: string;
}

export interface AnalyticsLink {
  id: string;
  originalUrl: string;
  label?: string | null;
}

export interface AnalyticsTracking {
  openToken?: string;
  clickTokens: Map<string, string>;
}

export interface AnalyticsOutcome {
  id: string;
  status: "accepted" | "sent" | "delivered" | "failed" | "bounced" | "skipped";
  provider?: string | null;
  provider_message_id?: string | null;
  email_log_id?: string | null;
  telegram_message_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

const HTTP_URL_RE = /^https?:\/\//i;

function chunk<T>(items: T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function ensureBroadcastAnalyticsContext(
  supabase: ServiceClient,
  input: BroadcastAnalyticsContextInput,
): Promise<BroadcastAnalyticsContext> {
  const { data, error } = await supabase.rpc("analytics_ensure_broadcast_run", {
    _campaign_id: input.campaignId,
    _channel: input.channel,
    _name: input.name,
    _source: input.source ?? "contact_center",
    _send_mode: input.sendMode ?? "manual",
    _template_id: input.templateId ?? null,
    _run_id: input.runId ?? null,
    _created_by: input.createdBy ?? null,
    _audience_filters: input.audienceFilters ?? {},
    _audience_snapshot: input.audienceSnapshot ?? {},
    _content_snapshot: input.contentSnapshot ?? {},
  });
  if (error) throw new Error(`analytics_context_failed: ${error.message}`);

  const row = (data ?? {}) as { campaign_id?: string; run_id?: string };
  if (!row.campaign_id || !row.run_id) {
    throw new Error("analytics_context_failed: missing campaign_id/run_id");
  }
  return { campaignId: row.campaign_id, runId: row.run_id, channel: input.channel };
}

export async function prepareAnalyticsDeliveries(
  supabase: ServiceClient,
  context: BroadcastAnalyticsContext,
  recipients: AnalyticsRecipient[],
): Promise<AnalyticsDelivery[]> {
  if (recipients.length === 0) return [];

  const prepared = recipients.map((recipient) => ({
    id: crypto.randomUUID(),
    campaign_id: context.campaignId,
    run_id: context.runId,
    profile_id: recipient.profileId ?? null,
    user_id: recipient.userId ?? null,
    channel: context.channel,
    recipient_key: recipient.recipientKey,
    bot_id: recipient.botId ?? null,
    provider: recipient.provider ?? null,
    status: "queued",
    metadata: recipient.metadata ?? {},
  }));

  for (const batch of chunk(prepared)) {
    const { error } = await supabase
      .from("broadcast_deliveries")
      .upsert(batch, { onConflict: "run_id,recipient_key", ignoreDuplicates: true });
    if (error) throw new Error(`analytics_delivery_failed: ${error.message}`);
  }

  const persisted: Array<{ id: string; recipient_key: string }> = [];
  for (const recipientBatch of chunk(recipients)) {
    const { data, error } = await supabase
      .from("broadcast_deliveries")
      .select("id,recipient_key")
      .eq("run_id", context.runId)
      .in("recipient_key", recipientBatch.map((recipient) => recipient.recipientKey));
    if (error) throw new Error(`analytics_delivery_read_failed: ${error.message}`);
    persisted.push(...((data ?? []) as Array<{ id: string; recipient_key: string }>));
  }

  const byKey = new Map(persisted.map((row) => [row.recipient_key, row.id]));
  const deliveries = recipients.map((recipient) => ({
    ...recipient,
    id: byKey.get(recipient.recipientKey)!,
  })).filter((delivery) => Boolean(delivery.id));

  for (const ids of chunk(deliveries.map((delivery) => delivery.id))) {
    const { error } = await supabase.rpc("analytics_snapshot_delivery_segments", {
      _delivery_ids: ids,
    });
    if (error) throw new Error(`analytics_segments_failed: ${error.message}`);
  }

  return deliveries;
}

export function extractHtmlLinks(html: string): AnalyticsLink[] {
  const urls: AnalyticsLink[] = [];
  const seen = new Set<string>();
  const hrefPattern = /<a\b[^>]*?href\s*=\s*(["'])(https?:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    const originalUrl = match[2].trim();
    if (!HTTP_URL_RE.test(originalUrl) || seen.has(originalUrl)) continue;
    seen.add(originalUrl);
    const label = match[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    urls.push({ id: "", originalUrl, label: label || null });
  }
  return urls;
}

export function extractTelegramLinks(message: string, buttonUrl?: string | null): AnalyticsLink[] {
  const urls: AnalyticsLink[] = [];
  const seen = new Set<string>();
  const add = (originalUrl: string, label?: string | null) => {
    const cleaned = originalUrl.trim().replace(/[.,!?;:)]+$/, "");
    if (!HTTP_URL_RE.test(cleaned) || seen.has(cleaned)) return;
    seen.add(cleaned);
    urls.push({ id: "", originalUrl: cleaned, label: label ?? null });
  };
  if (buttonUrl) add(buttonUrl, "Кнопка");

  const markdownPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownPattern.exec(message)) !== null) {
    add(markdownMatch[2], markdownMatch[1]);
  }

  const barePattern = /https?:\/\/[^\s<>{}[\]"']+/g;
  for (const bare of message.match(barePattern) ?? []) add(bare);
  return urls;
}

export async function ensureAnalyticsLinks(
  supabase: ServiceClient,
  context: BroadcastAnalyticsContext,
  links: AnalyticsLink[],
): Promise<AnalyticsLink[]> {
  if (links.length === 0) return [];
  const unique = Array.from(new Map(links.map((link) => [link.originalUrl, link])).values());
  const rows = unique.map((link, position) => ({
    campaign_id: context.campaignId,
    channel: context.channel,
    original_url: link.originalUrl,
    label: link.label ?? null,
    position,
  }));
  const { data, error } = await supabase
    .from("broadcast_links")
    .upsert(rows, { onConflict: "campaign_id,channel,original_url", ignoreDuplicates: false })
    .select("id,original_url,label");
  if (error) throw new Error(`analytics_links_failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; original_url: string; label: string | null }>).map((row) => ({
    id: row.id,
    originalUrl: row.original_url,
    label: row.label,
  }));
}

export async function prepareAnalyticsTracking(
  supabase: ServiceClient,
  deliveries: AnalyticsDelivery[],
  links: AnalyticsLink[],
  includeOpenToken: boolean,
): Promise<Map<string, AnalyticsTracking>> {
  const result = new Map<string, AnalyticsTracking>();
  if (deliveries.length === 0) return result;

  const deliveryIds = deliveries.map((delivery) => delivery.id);
  const existing: Array<{ token: string; delivery_id: string; link_id: string | null; purpose: string }> = [];
  for (const ids of chunk(deliveryIds)) {
    const { data, error } = await supabase
      .from("broadcast_tracking_tokens")
      .select("token,delivery_id,link_id,purpose")
      .in("delivery_id", ids);
    if (error) throw new Error(`analytics_tokens_read_failed: ${error.message}`);
    existing.push(...((data ?? []) as typeof existing));
  }

  const existingKey = new Set(existing.map((row) => `${row.delivery_id}:${row.purpose}:${row.link_id ?? "open"}`));
  const missing: Array<Record<string, unknown>> = [];
  for (const delivery of deliveries) {
    if (includeOpenToken && !existingKey.has(`${delivery.id}:open:open`)) {
      missing.push({ token: crypto.randomUUID(), delivery_id: delivery.id, link_id: null, purpose: "open" });
    }
    for (const link of links) {
      if (!existingKey.has(`${delivery.id}:click:${link.id}`)) {
        missing.push({ token: crypto.randomUUID(), delivery_id: delivery.id, link_id: link.id, purpose: "click" });
      }
    }
  }
  for (const batch of chunk(missing)) {
    const { error } = await supabase.from("broadcast_tracking_tokens").insert(batch);
    if (error) throw new Error(`analytics_tokens_write_failed: ${error.message}`);
  }

  const rows: Array<{ token: string; delivery_id: string; link_id: string | null; purpose: string }> = [];
  for (const ids of chunk(deliveryIds)) {
    const { data, error } = await supabase
      .from("broadcast_tracking_tokens")
      .select("token,delivery_id,link_id,purpose")
      .in("delivery_id", ids);
    if (error) throw new Error(`analytics_tokens_read_failed: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
  }

  const linkById = new Map(links.map((link) => [link.id, link.originalUrl]));
  for (const delivery of deliveries) result.set(delivery.id, { clickTokens: new Map() });
  for (const row of rows) {
    const tracking = result.get(row.delivery_id);
    if (!tracking) continue;
    if (row.purpose === "open") tracking.openToken = row.token;
    if (row.purpose === "click" && row.link_id && linkById.has(row.link_id)) {
      tracking.clickTokens.set(linkById.get(row.link_id)!, row.token);
    }
  }
  return result;
}

export function trackingBaseUrl(): string {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) throw new Error("SUPABASE_URL is not configured");
  return `${base}/functions/v1/broadcast-track`;
}

export function instrumentEmailHtml(html: string, tracking: AnalyticsTracking): string {
  const base = trackingBaseUrl();
  let instrumented = html;
  const replacements = Array.from(tracking.clickTokens.entries())
    .sort(([a], [b]) => b.length - a.length);
  for (const [originalUrl, token] of replacements) {
    const trackedUrl = `${base}/c/${token}`;
    instrumented = instrumented.split(originalUrl).join(trackedUrl);
  }
  if (tracking.openToken) {
    const pixel = `<img src="${base}/o/${tracking.openToken}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
    instrumented = /<\/body>/i.test(instrumented)
      ? instrumented.replace(/<\/body>/i, `${pixel}</body>`)
      : `${instrumented}${pixel}`;
  }
  return instrumented;
}

export function instrumentTelegramText(message: string, tracking: AnalyticsTracking): string {
  const base = trackingBaseUrl();
  let instrumented = message;
  const replacements = Array.from(tracking.clickTokens.entries())
    .sort(([a], [b]) => b.length - a.length);
  for (const [originalUrl, token] of replacements) {
    instrumented = instrumented.split(originalUrl).join(`${base}/c/${token}`);
  }
  return instrumented;
}

export function trackedTelegramButtonUrl(
  originalUrl: string | null | undefined,
  tracking: AnalyticsTracking,
): string | undefined {
  if (!originalUrl) return undefined;
  const token = tracking.clickTokens.get(originalUrl);
  return token ? `${trackingBaseUrl()}/c/${token}` : originalUrl;
}

export async function applyAnalyticsOutcomes(
  supabase: ServiceClient,
  outcomes: AnalyticsOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  for (const batch of chunk(outcomes)) {
    const { error } = await supabase.rpc("analytics_apply_delivery_outcomes", {
      _outcomes: batch,
    });
    if (error) throw new Error(`analytics_outcomes_failed: ${error.message}`);
  }
}
