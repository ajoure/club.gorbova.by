import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContactTelegramChat } from "../ContactTelegramChat";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), callbacks: [] as Array<{ event: string; cb: (payload: any) => void }> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mocks.rpc, functions: { invoke: mocks.invoke },
  from: () => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: async () => ({ data: [], error: null }) };
    return query;
  },
  channel: () => {
    const subscription = { on: (_: string, options: any, cb: any) => { mocks.callbacks.push({ event: options.event, cb }); return subscription; }, subscribe: () => subscription };
    return subscription;
  }, removeChannel: vi.fn(),
} }));
vi.mock("@/integrations/supabase/operational-client", () => ({ operationalSupabase: { rpc: () => ({ order: async () => ({ data: [], error: null }) }) } }));
vi.mock("@/hooks/useTelegramReactions", () => ({ useTelegramReactions: () => ({ data: [] }), useToggleTelegramReaction: () => ({ mutate: vi.fn() }) }));
vi.mock("@/components/admin/TokenizedRichInput", () => ({ TokenizedRichInput: ({ value, onChange }: any) => <textarea aria-label="Черновик" value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock("./TelegramMessageBubble", () => ({ TelegramMessageBubble: ({ data, ...props }: any) => <div>{(data || props.bubble || props).messageText}</div> }));

const channels = [
  { channel_key: "bot:support", transport: "bot", channel_ref: "support", label: "Support", username: "support_bot", is_primary: true, can_reply: true, message_count: 1, unanswered_count: 0, bot_id: "support" },
  { channel_key: "business:personal", transport: "business", channel_ref: "personal", label: "Личный Telegram", username: "personal", can_reply: true, message_count: 1, unanswered_count: 0, bot_id: "support", first_name: "Личный Telegram" },
  ...["Other", "Club", "GetCourse"].map(name => ({ channel_key: `bot:${name}`, transport: "bot", channel_ref: name, label: name, username: name, can_reply: true, message_count: 0, unanswered_count: 0, bot_id: name })),
];
const messages = [
  { id: "support-message", transport: "bot", bot_id: "support", message_text: "Только саппорту", message_id: 42 },
  { id: "personal-message", transport: "business", bot_id: "support", business_account_id: "personal", message_text: "Только лично", message_id: 42 },
].map(m => ({ ...m, direction: "incoming", created_at: "2026-09-11T07:00:00Z", status: "sent", meta: {} }));

beforeEach(() => {
  mocks.rpc.mockReset(); mocks.invoke.mockReset(); mocks.callbacks.length = 0;
  mocks.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === "admin_get_contact_telegram_channels_v1") return { data: channels, error: null };
    if (name === "admin_get_telegram_channel_messages_v1") return { data: args.p_unanswered_only ? [] : messages.filter(m => m.transport === args.p_transport && (m.transport === "business" ? m.business_account_id : m.bot_id) === args.p_channel_ref), error: null };
    return { data: [], error: null };
  });
});

describe("Telegram channel navigation", () => {
  it("keeps all five channels, isolates history and restores each channel's draft", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ContactTelegramChat userId="11111111-1111-4111-8111-111111111111" telegramUserId={123} telegramUsername={null} hidePhotoButton /></QueryClientProvider>);
    const picker = await screen.findByRole("group", { name: "Каналы Telegram" });
    expect(within(picker).getAllByRole("button")).toHaveLength(5);
    expect(within(picker).getByRole("button", { name: /Support/ })).toHaveAttribute("aria-pressed", "true");
    await screen.findByLabelText("Черновик");
    fireEvent.change(screen.getByLabelText("Черновик"), { target: { value: "Черновик саппорта" } });
    fireEvent.click(within(picker).getByRole("button", { name: /Личный Telegram/ }));
    await waitFor(() => expect(screen.getByLabelText("Черновик")).toHaveValue(""));
    expect(screen.getByTestId("telegram-channel-sender")).toHaveTextContent("Личный Telegram");
    fireEvent.change(screen.getByLabelText("Черновик"), { target: { value: "Личный черновик" } });
    fireEvent.click(within(picker).getByRole("button", { name: /Support/ }));
    await waitFor(() => expect(screen.getByLabelText("Черновик")).toHaveValue("Черновик саппорта"));
    expect(client.getQueryData(["telegram-messages", "11111111-1111-4111-8111-111111111111", "bot", "support"])).toEqual(expect.arrayContaining([expect.objectContaining({ id: "support-message", transport: "bot" })]));
    expect(client.getQueryData(["telegram-messages", "11111111-1111-4111-8111-111111111111", "business", "personal"])).toEqual(expect.arrayContaining([expect.objectContaining({ id: "personal-message", transport: "business" })]));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
