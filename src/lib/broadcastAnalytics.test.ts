import { beforeEach, describe, expect, it } from "vitest";
import migrationSource from "../../supabase/migrations/20260817201724_83ce32a7-f560-498b-91ab-df70a973838e.sql?raw";
import quickComposerSource from "../components/admin/communication/BroadcastsTabContent.tsx?raw";
import analyticsUiSource from "../components/admin/communication/BroadcastAnalyticsSection.tsx?raw";
import dispatcherSource from "../../supabase/functions/process-scheduled-broadcasts/index.ts?raw";
import telegramSource from "../../supabase/functions/telegram-mass-broadcast/index.ts?raw";
import emailSource from "../../supabase/functions/email-mass-broadcast/index.ts?raw";
import trackerSource from "../../supabase/functions/broadcast-track/index.ts?raw";
import supabaseConfigSource from "../../supabase/config.toml?raw";
import {
  extractHtmlLinks,
  extractTelegramLinks,
  instrumentEmailHtml,
  instrumentTelegramText,
} from "../../supabase/functions/_shared/broadcastAnalytics";

describe("аналитика рассылок", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { Deno: unknown }).Deno = {
      env: { get: (name: string) => name === "SUPABASE_URL" ? "https://example.supabase.co" : undefined },
    };
  });

  it("создаёт каноническую цепочку и защищает запись RLS/grants", () => {
    expect(migrationSource).toContain("CREATE TABLE public.broadcast_campaigns");
    expect(migrationSource).toContain("CREATE TABLE public.broadcast_deliveries");
    expect(migrationSource).toContain("CREATE TABLE public.broadcast_events");
    expect(migrationSource).toContain("CREATE TABLE public.broadcast_tracking_tokens");
    expect(migrationSource).toContain("has_admin_section_access((SELECT auth.uid()), 'communication', 'view')");
    expect(migrationSource).toContain("REVOKE ALL ON public.broadcast_tracking_tokens FROM PUBLIC, anon, authenticated");
    expect(migrationSource).toContain("GRANT EXECUTE ON FUNCTION public.admin_get_broadcast_analytics");
    expect(migrationSource).toContain("admin_get_broadcast_analytics_filters");
    expect(migrationSource).toContain("Attribution is selected globally first");
    expect(migrationSource).toContain("JOIN public.orders_v2");
    expect(migrationSource).toContain("FROM public.payments_v2");
    expect(migrationSource).not.toContain("GRANT INSERT ON public.broadcast_events TO authenticated");
  });

  it("журналирует ручные, плановые, повторяющиеся и событийные отправки", () => {
    expect(quickComposerSource).toContain("analytics_campaign_id");
    expect(quickComposerSource).toContain("const analyticsCampaignId = crypto.randomUUID()");
    expect(dispatcherSource).toContain("analytics_send_mode: tpl.send_mode === 'recurring' ? 'recurring' : 'scheduled'");
    expect(dispatcherSource).toContain("analytics_send_mode: 'event'");
    expect(telegramSource).toContain("prepareAnalyticsDeliveries");
    expect(telegramSource).toContain("applyAnalyticsOutcomes");
    expect(telegramSource).toContain("telegram_message_insert_failed");
    expect(telegramSource).toContain("В выбранной аудитории нет получателей с доступным Telegram");
    expect(emailSource).toContain("profile_id: profile.profile_id");
    expect(emailSource).toContain("instrumentEmailHtml");
    expect(emailSource).toContain("В выбранной аудитории нет получателей с доступным email");
  });

  it("использует публичный opaque-token endpoint без персональных данных в URL", () => {
    expect(supabaseConfigSource).toContain("[functions.broadcast-track]");
    expect(supabaseConfigSource).toContain("verify_jwt = false");
    expect(trackerSource).toContain("analytics_record_tracking_event");
    expect(trackerSource).toContain("unsafe protocol");
    expect(trackerSource).toContain('request.method === "HEAD" || isLikelyMachine(userAgent)');
    expect(trackerSource).not.toContain("profile_id=");
    expect(trackerSource).not.toContain("email=");
  });

  it("ограничивает окно атрибуции и добавляет индексы времени доказательства", () => {
    expect(migrationSource).toContain("broadcast_deliveries_profile_evidence_idx");
    expect(migrationSource).toContain("payments_v2_profile_effective_paid_idx");
    expect(migrationSource).toContain("COALESCE(p.paid_at, p.created_at) >= _from");
    expect(migrationSource).toContain("_to + interval '90 days'");
  });

  it("находит и персонализирует ссылки в Telegram и email", () => {
    const html = '<a href="https://gorbova.by/a">Курс</a><a href="https://gorbova.by/a">Повтор</a>';
    expect(extractHtmlLinks(html)).toEqual([{ id: "", originalUrl: "https://gorbova.by/a", label: "Курс" }]);

    const telegramLinks = extractTelegramLinks("Смотрите [урок](https://gorbova.by/lesson) и https://gorbova.by/help", "https://gorbova.by/open");
    expect(telegramLinks.map((item) => item.originalUrl)).toEqual([
      "https://gorbova.by/open",
      "https://gorbova.by/lesson",
      "https://gorbova.by/help",
    ]);

    const tracking = {
      openToken: "11111111-1111-4111-8111-111111111111",
      clickTokens: new Map([["https://gorbova.by/a", "22222222-2222-4222-8222-222222222222"]]),
    };
    const trackedHtml = instrumentEmailHtml(html, tracking);
    expect(trackedHtml).toContain("/broadcast-track/c/22222222-2222-4222-8222-222222222222");
    expect(trackedHtml).toContain("/broadcast-track/o/11111111-1111-4111-8111-111111111111.gif");
    expect(instrumentTelegramText("Открыть https://gorbova.by/a", tracking)).toContain("/broadcast-track/c/22222222-2222-4222-8222-222222222222");
  });

  it("показывает честные ограничения и мобильную детализацию", () => {
    expect(analyticsUiSource).toContain("Telegram не передаёт ботам факт прочтения");
    expect(analyticsUiSource).toContain("Открытие email — технический сигнал");
    expect(analyticsUiSource).toContain("Уникальные получатели");
    expect(analyticsUiSource).toContain("md:hidden");
    expect(analyticsUiSource).toContain("admin_get_broadcast_campaign_recipients");
    expect(analyticsUiSource).toContain("Покупки после рассылки");
  });
});
