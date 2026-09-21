import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { useUnifiedInbox } from "./useUnifiedInbox";

const mock = vi.hoisted(() => ({ profiles: vi.fn(), dialogs: [] as any[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async (name: string) => ({ data: name === "get_inbox_dialogs_v1" ? mock.dialogs : [], error: null }),
  functions: { invoke: async () => ({ data: { accounts: [] }, error: null }) },
  from: (table: string) => {
    const query: any = { then: (resolve: any, reject: any) => (table === "profiles" ? mock.profiles() : Promise.resolve({ data: [], error: null })).then(resolve, reject) };
    for (const method of ["select", "in", "eq", "not", "is", "order", "range"]) query[method] = () => query;
    return query;
  },
} }));
const profile = { id: "profile-a", user_id: "user-a", first_name: "Тест", last_name: "Контакт", telegram_user_id: 123 };
const dialog = (id: string) => ({ user_id: id, last_message_at: "2026-09-21T00:00:00Z", last_message_text: "test" });

beforeEach(() => { mock.profiles.mockReset().mockResolvedValue({ data: [profile], error: null }); mock.dialogs = [dialog("user-a")]; });

it("keeps the selected contact's name and Telegram id while the queue grows, reorders and profile reads fail", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useUnifiedInbox({ enabled: true }), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current.contactRows[0]?.displayName).toBe("Контакт Тест"));
  const unresolved: Array<(result: any) => void> = [];
  mock.profiles.mockImplementation(() => new Promise(resolve => unresolved.push(resolve)));
  act(() => client.setQueryData(["unified-inbox-telegram", 75, ""], { pages: [{ rows: [dialog("user-b"), dialog("user-a")] }], pageParams: [0] }));
  await waitFor(() => expect(unresolved).toHaveLength(2));
  expect(result.current.contactRows.find(row => row.key === "profile:profile-a")?.channels.telegram?.sourceRow.meta.telegramNumericId).toBe(123);
  expect(result.current.contactRows.some(row => row.displayName === "Без имени")).toBe(false);
  await act(async () => unresolved.forEach(resolve => resolve({ data: null, error: new Error("network unavailable") })));
  await waitFor(() => expect(result.current.errors.telegram).toBeTruthy());
  expect(result.current.contactRows.find(row => row.key === "profile:profile-a")?.displayName).toBe("Контакт Тест");
  const calls = mock.profiles.mock.calls.length;
  act(() => client.setQueryData(["unified-inbox-telegram", 75, ""], { pages: [{ rows: [dialog("user-a"), dialog("user-b")] }], pageParams: [0] }));
  expect(mock.profiles).toHaveBeenCalledTimes(calls);
});
