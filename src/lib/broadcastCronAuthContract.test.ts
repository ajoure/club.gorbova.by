import { describe, expect, it } from "vitest";
import dispatcherSource from "../../supabase/functions/process-scheduled-broadcasts/index.ts?raw";
import cronMigrationSource from "../../supabase/migrations/20260815120000_secure_broadcast_dispatcher_cron.sql?raw";

describe("защищённый cron рассылок", () => {
  it("проверяет отдельный cron-секрет до запуска диспетчера", () => {
    expect(dispatcherSource).toContain("x-broadcast-cron-secret");
    expect(dispatcherSource).toContain("verify_broadcast_dispatcher_cron_secret");
    expect(dispatcherSource).toContain("!isServiceCaller && !isInternalCaller && !isCronCaller");
  });

  it("хранит секрет в Vault, а в cron оставляет только вызов защищённой обёртки", () => {
    expect(cronMigrationSource).toContain("broadcast_dispatcher_cron_secret");
    expect(cronMigrationSource).toContain("vault.create_secret");
    expect(cronMigrationSource).toContain("REVOKE ALL ON FUNCTION public.verify_broadcast_dispatcher_cron_secret(text)");
    expect(cronMigrationSource).toContain("TO service_role");
    expect(cronMigrationSource).toContain("command := 'SELECT public.invoke_process_scheduled_broadcasts();'");
    expect(cronMigrationSource).not.toContain("BROADCAST_FORCE_SECRET");
    expect(cronMigrationSource).not.toContain("BROADCAST_INTERNAL_SECRET");
  });
});
