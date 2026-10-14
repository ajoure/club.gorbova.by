import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20261014162634_manual_email_broadcast_queue.sql?raw";

describe("manual email queue SQL in an isolated database", () => {
  it("claims ten once, skips accepted and historic rows, and protects payload access", async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE TABLE public.broadcast_deliveries(id uuid PRIMARY KEY,channel text,status text,accepted_at timestamptz);`);
      await db.exec(migration);
      const accountId = "11111111-1111-4111-8111-111111111111";
      const ids = Array.from({ length: 25 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
      for (let index = 0; index < ids.length; index++) await db.query("INSERT INTO broadcast_deliveries VALUES($1,'email',$2,$3)", [ids[index], index === 0 ? "accepted" : "queued", index === 0 ? new Date().toISOString() : null]);
      const payload = ids.slice(0, 24).map((delivery_id) => ({ delivery_id, account_id: accountId, recipient: "test@example.invalid", subject: "test", html: "test" }));
      await db.query("SELECT enqueue_manual_broadcast_emails($1::jsonb)", [JSON.stringify(payload)]);
      await db.query("SELECT enqueue_manual_broadcast_emails($1::jsonb)", [JSON.stringify(payload)]);
      expect((await db.query("SELECT count(*)::int AS n FROM broadcast_email_queue")).rows).toEqual([{ n: 23 }]);
      const claimed = await db.query<{ delivery_id: string }>("SELECT * FROM claim_manual_broadcast_emails($1)", [accountId]);
      expect(claimed.rows).toHaveLength(10);
      expect(claimed.rows.map((row) => row.delivery_id)).not.toContain(ids[0]);
      expect(claimed.rows.map((row) => row.delivery_id)).not.toContain(ids[24]);
      expect((await db.query("SELECT * FROM claim_manual_broadcast_emails($1)", [accountId])).rows).toHaveLength(0);
      await db.exec("SET ROLE authenticated;");
      await expect(db.query("SELECT * FROM broadcast_email_queue")).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE; SET ROLE anon;");
      await expect(db.query("SELECT * FROM claim_manual_broadcast_emails($1)", [accountId])).rejects.toThrow(/permission denied/);
    } finally { await db.close(); }
  }, 30_000);
});
