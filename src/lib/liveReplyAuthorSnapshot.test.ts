import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20260829081200_add_live_reply_author_snapshot.sql?raw";
import replies from "../components/live/LiveEventReplies.tsx?raw";

describe("live reply author snapshot", () => {
  it("derives the reply author from canonical room identity instead of client input", () => {
    expect(migration).toContain("NEW.created_by");
    expect(migration).toContain("live_event_participant_prefs");
    expect(migration).toContain("profile.full_name");
    expect(migration).toContain("CONCAT(LEFT(profile.email, 3), '***')");
    expect(migration).not.toContain("TRIM(NEW.author_display_name)");
  });

  it("backfills existing replies and snapshots all future inserts", () => {
    expect(migration).toContain("CREATE TRIGGER trg_snapshot_live_event_reply_author");
    expect(migration).toContain("BEFORE INSERT ON public.live_event_replies");
    expect(migration).toContain("WITH reply_author_snapshots AS");
    expect(migration).toContain("UPDATE public.live_event_replies reply");
  });

  it("selects and renders the author name in every reply presentation", () => {
    expect(replies).toContain("author_display_name, author_role, author_nickname_color");
    expect(replies).toContain("Ответ от:");
    expect(replies.match(/data-testid="live-reply-author"/g)).toHaveLength(2);
  });
});
