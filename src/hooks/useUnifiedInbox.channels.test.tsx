import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { useUnifiedInbox } from "./useUnifiedInbox";

const fixtures = vi.hoisted(() => ({
  incoming: { id: "question", transport: "business", bot_id: "bridge-bot", business_account_id: "personal" as string | null },
  requestedMessageIds: [] as string[],
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (name: string) => {
    const response = Promise.resolve({ data: name === "get_inbox_dialogs_v1"
    ? [{ user_id: "user", last_message_id: "broadcast", last_message_text: "Service broadcast", last_message_at: "2026-10-29T00:00:00Z", last_bot_id: "service-bot", last_bot_name: "Service bot" }]
    : name === "get_contact_center_unanswered_dialogs_v1"
      ? [{ user_id: "user", unanswered_count: 1, oldest_message_id: "question", oldest_message_at: "2026-10-28T00:00:00Z" }]
      : name === "list_operational_telegram_bots"
        ? [{ id: "question-bot", bot_name: "Question bot", bot_username: "question_bot" }]
        : [], error: null });
    return Object.assign(response, { order: () => response });
  },
  functions: { invoke: async () => ({ data: { accounts: [] }, error: null }) },
  from: (table: string) => {
    let ids: string[] = [];
    const data = () => {
      if (table === "profiles") return [{ id: "profile", user_id: "user", first_name: "Тест", last_name: "Контакт", telegram_user_id: 123 }];
      if (table === "telegram_messages") {
        fixtures.requestedMessageIds.push(...ids);
        return [fixtures.incoming, { id: "broadcast", transport: "bot", bot_id: "service-bot", business_account_id: null }].filter((row) => ids.includes(row.id));
      }
      if (table === "telegram_business_connections") return [{ id: "personal", first_name: "Тестовый", last_name: "Администратор" }];
      return [];
    };
    const query: any = { then: (resolve: any, reject: any) => Promise.resolve({ data: data(), error: null }).then(resolve, reject) };
    for (const method of ["select", "eq", "not", "is", "order", "range"]) query[method] = () => query;
    query.in = (_column: string, values: string[]) => { ids = values; return query; };
    return query;
  },
} }));

beforeEach(() => {
  fixtures.requestedMessageIds = [];
  fixtures.incoming = { id: "question", transport: "business", bot_id: "bridge-bot", business_account_id: "personal" };
});

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useUnifiedInbox({ enabled: true }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

it("keeps the personal destination of an incoming question after a service bot broadcast", async () => {
  const { result } = renderInbox();
  await waitFor(() => expect(result.current.rows[0]?.sourceLabel).toBe("Тестовый Администратор · личный Telegram"));
  expect(fixtures.requestedMessageIds).toContain("question");
  expect(fixtures.requestedMessageIds).not.toContain("broadcast");
});

it("shows the bot the customer addressed rather than the bot that later broadcast", async () => {
  fixtures.incoming = { id: "question", transport: "bot", bot_id: "question-bot", business_account_id: null };
  const { result } = renderInbox();
  await waitFor(() => expect(result.current.rows[0]?.sourceLabel).toBe("Question bot"));
});
