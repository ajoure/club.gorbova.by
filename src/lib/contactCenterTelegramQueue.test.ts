import { describe, expect, it } from "vitest";
import { mergeTelegramWorkQueue } from "./contactCenterTelegramQueue";

describe("mergeTelegramWorkQueue", () => {
  it("adds unanswered conversations missing from the paginated inbox", () => {
    const result = mergeTelegramWorkQueue(
      [{ user_id: "loaded", last_message_text: "latest" }],
      [
        {
          user_id: "loaded",
          unanswered_count: 2,
          oldest_message_text: "first loaded question",
          oldest_message_at: "2026-08-10T09:00:00Z",
        },
        {
          user_id: "missing",
          unanswered_count: 1,
          oldest_message_text: "missing question",
          oldest_message_at: "2026-08-10T10:00:00Z",
        },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      dialog: { user_id: "loaded" },
      unanswered: { unanswered_count: 2 },
    });
    expect(result[1]).toMatchObject({
      dialog: null,
      unanswered: { user_id: "missing", unanswered_count: 1 },
    });
  });

  it("does not duplicate a loaded conversation and keeps resolved dialogs", () => {
    const result = mergeTelegramWorkQueue(
      [{ user_id: "resolved" }, { user_id: "open" }],
      [{ user_id: "open", unanswered_count: 3 }],
    );

    expect(result.map((item) => item.dialog?.user_id ?? item.unanswered?.user_id)).toEqual([
      "resolved",
      "open",
    ]);
    expect(result[0].unanswered).toBeNull();
    expect(result[1].unanswered?.unanswered_count).toBe(3);
  });
});
