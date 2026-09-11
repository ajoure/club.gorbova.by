import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TELEGRAM_MONITORING_UPDATES } from "../../supabase/functions/_shared/telegram-monitoring";

const webhook = readFileSync("supabase/functions/telegram-webhook/index.ts", "utf8");
const actions = readFileSync("supabase/functions/telegram-bot-actions/index.ts", "utf8");
const cron = readFileSync("supabase/migrations/20260911071000_restore_telegram_summary_cron.sql", "utf8");
const summary = readFileSync("supabase/functions/telegram-daily-summary/index.ts", "utf8");

describe("Telegram recovery safety contracts", () => {
  it("does not ACK a failed private-message insert or continue notification side effects", () => {
    const failure = webhook.indexOf("if (!dbMessageId && !__AUDIT_SHAPE_ACTIVE)");
    const sideEffects = webhook.indexOf("// Queue media job if file present");
    expect(failure).toBeGreaterThan(0);
    expect(failure).toBeLessThan(sideEffects);
    expect(webhook.slice(failure, sideEffects)).toContain("status: 500");
    expect(webhook).toContain("insertError.message?.includes('telegram_messages_bot_update_dedupe_idx')");
    expect(webhook).toContain("telegram_update_id: update.update_id");
  });

  it("retains updates while reinstalling the secret and subscribing to channel posts", () => {
    expect(TELEGRAM_MONITORING_UPDATES).toEqual(["channel_post", "edited_channel_post"]);
    expect(actions.match(/\.\.\.TELEGRAM_MONITORING_UPDATES/g)).toHaveLength(2);
    expect(actions.match(/drop_pending_updates: false/g)).toHaveLength(2);
    expect(actions).not.toContain("missingUpdates.length === 0");
    expect(actions).toContain("...currentUpdates, ...businessRequiredUpdates");
  });

  it("keeps the cron secret in Vault and limits both wrapper RPCs to service_role", () => {
    for (const signature of ["verify_telegram_summary_cron_secret(text)", "invoke_telegram_daily_summary()"]) {
      expect(cron).toContain(`REVOKE ALL ON FUNCTION public.${signature}\n  FROM PUBLIC, anon, authenticated;`);
      expect(cron).toContain(`GRANT EXECUTE ON FUNCTION public.${signature}\n  TO service_role;`);
    }
    expect(cron).toContain("SELECT public.invoke_telegram_daily_summary();");
    expect(cron).toContain("vault.decrypted_secrets");
    expect(summary).toContain("valid !== true");
    expect(summary).toContain("communication !== true && telegram !== true");
    expect(summary).toContain("status: success ? 200 : 500");
  });

  it("binds the /start message before guest-contact persistence", () => {
    const start = webhook.indexOf("if (update.message?.text?.startsWith('/start'))");
    const guest = webhook.indexOf("// Brand-new user");
    expect(webhook.slice(start, guest)).toContain("const msg = update.message;");
  });
});
