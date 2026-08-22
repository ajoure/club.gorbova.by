import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20260822093925_allow_staff_live_event_replies.sql?raw";

describe("live event replies RLS", () => {
  it("allows canonical staff to insert replies they author", () => {
    expect(migration).toContain('CREATE POLICY "Staff can create live event replies"');
    expect(migration).toMatch(/FOR INSERT\s+TO authenticated/i);
    expect(migration).toContain("created_by = (SELECT auth.uid())");
    expect(migration).toContain("public.has_role_v2((SELECT auth.uid()), 'employee')");
    expect(migration).toContain(
      "public.user_has_live_event_access((SELECT auth.uid()), live_event_id)",
    );
  });

  it("rejects cross-event reply sources", () => {
    expect(migration).toContain("comment.live_event_id = live_event_replies.live_event_id");
    expect(migration).toContain("question.live_event_id = live_event_replies.live_event_id");
  });

  it("does not replace the existing admin management policy", () => {
    expect(migration).not.toContain('DROP POLICY IF EXISTS "Admins can manage replies"');
  });
});
