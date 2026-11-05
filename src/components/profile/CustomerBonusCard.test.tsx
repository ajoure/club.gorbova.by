import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerBonusCard } from "./CustomerBonusCard";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "customer-auth" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); });
describe("customer bonus balance outside referral enrollment", () => {
  it("shows a manual credit in profile without starting a referral relationship", async () => {
    rpc.mockResolvedValue({ data: { available_minor: 15000, currency: "BYN", entries: [{ id: "entry", amount_minor: 15000, entry_type: "admin_adjustment", status: "posted", created_at: "2026-11-05T12:00:00Z" }] }, error: null });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CustomerBonusCard /></QueryClientProvider>);
    await screen.findByText("Мои бонусы");
    expect(screen.getByText("Начислено администратором")).toBeTruthy();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_customer_bonus_wallet");
  });
});
