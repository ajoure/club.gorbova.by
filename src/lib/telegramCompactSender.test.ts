import { describe, expect, it } from "vitest";
import { defaultTelegramSender, mergeTelegramChannelPages, telegramMessageScopeKey } from "./telegramCompactSender";
import type { ContactTelegramChannel } from "./telegramChannelScope";
const channels = [
  { channel_key: "bot:support", transport: "bot", channel_ref: "support", is_primary: true },
  { channel_key: "business:personal", transport: "business", channel_ref: "personal", bot_id: "support" },
  { channel_key: "bot:other", transport: "bot", channel_ref: "other" },
] as ContactTelegramChannel[];
const inbound = { id: "a", created_at: "2026-09-11T08:00:00Z", direction: "incoming", requires_reply: true, transport: "business", business_account_id: "personal", bot_id: "support" };
describe("compact sender defaults and combined history", () => {
  it("uses primary for ordinary opens, exact account for unanswered inbound, and primary after a reply", () => {
    expect(defaultTelegramSender(channels, [])?.channel_key).toBe("bot:support");
    expect(defaultTelegramSender(channels, [inbound])?.channel_key).toBe("business:personal");
    expect(defaultTelegramSender(channels, [{ ...inbound, requires_reply: false }])?.channel_key).toBe("bot:support");
    expect(defaultTelegramSender(channels, [inbound, { ...inbound, id: "b", direction: "outgoing" }])?.channel_key).toBe("bot:support");
    expect(defaultTelegramSender(channels, [{ ...inbound, transport: "bot", bot_id: "other" }])?.channel_key).toBe("bot:other");
  });
  it("merges page ties and paginates every message exactly once", () => {
    const all = Array.from({length: 63}, (_, i) => ({ ...inbound, id: String(i).padStart(3, "0"), created_at: `2026-09-11T08:${String(Math.floor(i/3)).padStart(2,"0")}:00Z` }));
    const sources = [all.filter((_,i)=>i%3===0), all.filter((_,i)=>i%3===1), all.filter((_,i)=>i%3===2), [], []];
    let remaining = sources; const seen: string[] = [];
    while (remaining.some(p=>p.length)) {
      const page = mergeTelegramChannelPages(remaining.map(p=>mergeTelegramChannelPages([p],20)),20);
      seen.push(...page.map(m=>m.id)); const last=page.at(-1)!;
      remaining=remaining.map(p=>p.filter(m=>m.created_at<last.created_at || (m.created_at===last.created_at && m.id<last.id)));
    }
    expect(seen).toHaveLength(63); expect(new Set(seen).size).toBe(63);
    expect(mergeTelegramChannelPages(sources, 1, true)[0].id).toBe("000");
  });
  it("does not confuse quotes from a Business account and its bridge bot", () => {
    expect(telegramMessageScopeKey(inbound,42)).not.toBe(telegramMessageScopeKey({...inbound,transport:"bot"},42));
  });
});
