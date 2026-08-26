import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20260823094017_participant_live_event_replies.sql?raw";
import replies from "../components/live/LiveEventReplies.tsx?raw";
import comments from "../components/live/LiveEventComments.tsx?raw";
import questions from "../components/live/LiveEventQuestions.tsx?raw";

describe("participant webinar replies", () => {
  it("allows any attendee with event access to reply while honoring moderation", () => {
    expect(migration).toContain('CREATE POLICY "Participants can create live event replies"');
    expect(migration).toContain("public.user_has_live_event_access((SELECT auth.uid()), live_event_id)");
    expect(migration).toContain("NOT public.is_user_removed_from_room");
    expect(migration).toContain("NOT public.is_user_muted_in_room");
    expect(migration).not.toContain("AND public.has_role_v2((SELECT auth.uid()), 'employee')\n  AND public.user_has_live_event_access");
  });

  it("keeps private replies visible to author, target and all staff", () => {
    expect(migration).toContain("public.has_role_v2((SELECT auth.uid()), 'employee')");
    expect(migration).toContain("target_user_id = (SELECT auth.uid())");
    expect(migration).toContain("created_by = (SELECT auth.uid())");
    expect(migration).toContain("live_event_replies.target_user_id = comment.user_id");
    expect(migration).toContain("live_event_replies.target_user_id = question.user_id");
    expect(migration).toContain("live_event_replies.target_user_id IS NULL");
    expect(migration).toContain("live_event_replies.visibility_scope = 'private'");
  });

  it("publishes replies to Realtime without duplicating publication membership", () => {
    expect(migration).toContain("pg_publication_tables");
    expect(migration).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_replies");
    expect(migration).toContain("ALTER TABLE public.live_event_replies REPLICA IDENTITY FULL");
  });

  it("shows participant reply controls and keeps each answer with its source message", () => {
    expect(comments).toContain("aria-label={`Ответить ${displayName}`}");
    expect(questions).toContain("aria-label={`Ответить ${displayName}`}");
    expect(comments).toContain("replies={commentRepliesBySource.get(comment.id) ?? []}");
    expect(questions).toContain("replies={questionRepliesBySource.get(q.id) ?? []}");
    expect(comments).not.toContain("<LiveEventReplyActivity replies={commentReplies}");
    expect(questions).not.toContain("<LiveEventReplyActivity replies={questionReplies}");
    expect(replies).toContain('table: "live_event_replies"');
    expect(replies).toContain('data-testid="live-reply-activity"');
    expect(replies).toContain("Для всех");
    expect(replies).toContain("Лично");
  });
});
