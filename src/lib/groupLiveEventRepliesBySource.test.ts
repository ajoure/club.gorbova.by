import { describe, expect, it } from "vitest";
import { groupLiveEventRepliesBySource } from "./groupLiveEventRepliesBySource";

const replies = [
  {
    id: "reply-later",
    source_comment_id: "comment-1",
    source_question_id: null,
    created_at: "2026-08-26T15:06:00.000Z",
  },
  {
    id: "reply-question",
    source_comment_id: null,
    source_question_id: "question-1",
    created_at: "2026-08-26T15:05:00.000Z",
  },
  {
    id: "reply-earlier",
    source_comment_id: "comment-1",
    source_question_id: null,
    created_at: "2026-08-26T15:04:00.000Z",
  },
];

describe("groupLiveEventRepliesBySource", () => {
  it("keeps comment replies with their source message in chronological order", () => {
    const grouped = groupLiveEventRepliesBySource(replies, "comment");

    expect([...grouped.keys()]).toEqual(["comment-1"]);
    expect(grouped.get("comment-1")?.map((reply) => reply.id)).toEqual([
      "reply-earlier",
      "reply-later",
    ]);
  });

  it("does not mix question replies into the comment thread", () => {
    const grouped = groupLiveEventRepliesBySource(replies, "question");

    expect([...grouped.keys()]).toEqual(["question-1"]);
    expect(grouped.get("question-1")?.map((reply) => reply.id)).toEqual(["reply-question"]);
  });
});
