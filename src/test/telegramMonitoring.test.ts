import { describe, expect, it, vi } from "vitest";
import { persistMonitoredTelegramMessage } from "../../supabase/functions/_shared/telegram-monitoring";

function database(clubs: Record<string, unknown>[] = [], channels: Record<string, unknown>[] = [], failWrite = false) {
  const stored = new Map<string, Record<string, unknown>>();
  const from = vi.fn((table: string) => {
    let rows = table === "telegram_clubs" ? clubs : channels;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      upsert: async (row: Record<string, unknown>, options: { onConflict: string }) => {
        if (failWrite) return { error: { message: "test failure" } };
        stored.set(`${table}:${options.onConflict.split(",").map((key) => row[key]).join(":")}`, row);
        return { error: null };
      },
    };
    return query;
  });
  return { from, stored };
}

const club = { id: "club", bot_id: "support", chat_id: -100, channel_id: -200, chat_analytics_enabled: true };
const post = { message_id: 10, chat: { id: -200, type: "channel", title: "Test channel" }, date: 1000, text: "Original" };

describe("Telegram group and channel persistence", () => {
  it("stores and edits a connected channel post without a duplicate or a sender user", async () => {
    const db = database([club]);
    await persistMonitoredTelegramMessage(db, "support", { channel_post: post });
    await persistMonitoredTelegramMessage(db, "support", { channel_post: post });
    await persistMonitoredTelegramMessage(db, "support", { edited_channel_post: { ...post, text: "Edited" } });
    expect(db.stored.size).toBe(1);
    expect([...db.stored.values()][0].text).toBe("Edited");
  });

  it("does not archive an unrelated bot, disabled group, or unconfigured channel", async () => {
    const db = database([{ ...club, chat_analytics_enabled: false }]);
    expect(await persistMonitoredTelegramMessage(db, "other", { channel_post: post })).toEqual({ handled: true, saved: 0 });
    expect(await persistMonitoredTelegramMessage(db, "support", { message: { ...post, chat: { id: -100, type: "group" } } })).toEqual({ handled: true, saved: 0 });
    expect(db.stored.size).toBe(0);
  });

  it("archives an active publishing channel associated with the receiving bot", async () => {
    const db = database([], [{ id: "publishing", bot_id: "support", channel_id: "-200", is_active: true }]);
    expect(await persistMonitoredTelegramMessage(db, "support", { channel_post: post })).toEqual({ handled: true, saved: 1 });
  });

  it("keeps group commands, anonymous senders, and voice attachments", async () => {
    const db = database([club]);
    await persistMonitoredTelegramMessage(db, "support", { message: {
      ...post, chat: { id: -100, type: "supergroup" }, sender_chat: { id: -100, title: "Group" },
      text: "/help", voice: { file_id: "fixture" },
    } });
    expect([...db.stored.values()][0]).toMatchObject({ text: "/help", from_tg_user_id: -100, has_media: true });
  });

  it("propagates a failed write so the webhook cannot acknowledge unsaved messages", async () => {
    await expect(persistMonitoredTelegramMessage(database([club], [], true), "support", { channel_post: post }))
      .rejects.toThrow("telegram_channel_archive_write_failed");
  });

  it("leaves private and Business messages to their existing handlers", async () => {
    const db = database();
    expect(await persistMonitoredTelegramMessage(db, "support", { message: { ...post, chat: { id: 1, type: "private" } } }))
      .toEqual({ handled: false, saved: 0 });
    expect(await persistMonitoredTelegramMessage(db, "support", { business_message: post })).toEqual({ handled: false, saved: 0 });
    expect(db.from).not.toHaveBeenCalled();
  });
});
