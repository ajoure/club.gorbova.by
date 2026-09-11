import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("./TelegramMessageBubble", () => ({ TelegramMessageBubble: ({ data, onReply }: any) => <div>{data.messageText}<button onClick={() => onReply(data.id)}>Ответить {data.id}</button></div> }));

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

describe("Compact Telegram sender", () => {
  it("keeps history visible, offers five senders below, and routes an explicit reply independently of the bridge bot", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ContactTelegramChat userId="11111111-1111-4111-8111-111111111111" telegramUserId={123} telegramUsername={null} hidePhotoButton /></QueryClientProvider>);
    await screen.findByText("Только саппорту");
    expect(screen.getByText("Только лично")).toBeInTheDocument();
    expect(screen.queryByTestId("telegram-channel-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("telegram-channel-sender")).toHaveTextContent("Support");
    fireEvent.change(screen.getByLabelText("Черновик"), { target: { value: "Черновик ответа" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "Выбрать отправителя" }), { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(5);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /GetCourse/ }));
    expect(screen.getByTestId("telegram-channel-sender")).toHaveTextContent("GetCourse");
    expect(screen.getByLabelText("Черновик")).toHaveValue("");
    expect(screen.getByText("Только лично")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ответить personal-message" }));
    expect(screen.getByTestId("telegram-channel-sender")).toHaveTextContent("Личный Telegram");
    fireEvent.click(screen.getByRole("button", { name: "Ответить support-message" }));
    expect(screen.getByTestId("telegram-channel-sender")).toHaveTextContent("Support");
    expect(client.getQueryData(["telegram-messages", "11111111-1111-4111-8111-111111111111", "combined-senders-v1"])).toHaveLength(2);
    expect(screen.getByLabelText("Черновик")).toHaveValue("Черновик ответа");
    await act(async () => { mocks.callbacks.find(c => c.event === "INSERT")!.cb({ new: { ...messages[1], id: "new-personal", message_text: "Новое личное", requires_reply: true } }); });
    expect(screen.getByTestId("telegram-channel-sender")).toHaveTextContent("Support");
    expect(await screen.findByText("Новое личное")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("defaults to the exact channel of the latest unanswered message", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: any) => {
      if (name === "admin_get_contact_telegram_channels_v1") return { data: channels, error: null };
      if (name === "admin_get_telegram_channel_messages_v1") return { data: args.p_transport === "business" ? [{ ...messages[1], requires_reply: true }] : [], error: null };
      return { data: [], error: null };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ContactTelegramChat userId="11111111-1111-4111-8111-111111111111" telegramUserId={123} telegramUsername={null} hidePhotoButton /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("telegram-channel-sender")).toHaveTextContent("Личный Telegram"));
  });

});
