import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { useTariffOffers } from "@/hooks/useTariffOffers";
import { TokenizedRichInput } from "./TokenizedRichInput";
import { ContactFeedTab } from "./contact/ContactFeedTab";

const network = vi.hoisted(() => ({ reads: [] as string[] }));
vi.mock("@/components/admin/tasks/CreateCrmTaskDialog", () => ({ CreateCrmTaskDialog: () => null }));
vi.mock("@/components/admin/chat/PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const query: Record<string, unknown> = {};
    for (const key of ["select", "eq", "in", "order", "not", "is", "limit"]) query[key] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => {
      network.reads.push(table);
      return Promise.resolve(resolve({ data: [], error: null }));
    };
    return query;
  },
  rpc: async (name: string) => { network.reads.push(name); return { data: [], error: null }; },
} }));
const clients: QueryClient[] = [];
function setup() {
  network.reads.length = 0;
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(cache);
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
  return { cache, wrapper };
}
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("hidden contact-center panels", () => {
  it("keeps catalog hooks dormant until enabled, then uses their normal cache keys", async () => {
    const { wrapper, cache } = setup();
    const view = renderHook(({ active }) => ({ products: useProductsV2(active), tariffs: useTariffs("product", active), offers: useTariffOffers("tariff", active) }), { wrapper, initialProps: { active: false } });
    expect(network.reads).toEqual([]);
    view.rerender({ active: true });
    await waitFor(() => expect(view.result.current.offers.isSuccess).toBe(true));
    expect(network.reads).toEqual(["products_v2", "tariffs", "tariff_offers"]);
    view.rerender({ active: false });
    await cache.invalidateQueries();
    expect(network.reads).toHaveLength(3);
    expect(view.result.current.products.data).toEqual([]);
  });

  it("does not hydrate token registries for a hidden editor and preserves its draft", async () => {
    const { wrapper, cache } = setup();
    const tree = (active: boolean) => <TokenizedRichInput value="Synthetic saved draft" onChange={() => {}} tokenContext="contact_center" isActive={active} />;
    const view = render(tree(false), { wrapper });
    expect(network.reads).toEqual([]);
    view.rerender(tree(true));
    await waitFor(() => expect(network.reads).toContain("document_token_registry"));
    await waitFor(() => expect(cache.isFetching()).toBe(0));
    view.rerender(tree(false));
    const before = network.reads.length;
    await cache.invalidateQueries();
    expect(network.reads).toHaveLength(before);
    expect(view.container).toHaveTextContent("Synthetic saved draft");
  });

  it("reads the activity feed only when visible and pauses invalidation while hidden", async () => {
    const { wrapper, cache } = setup();
    const tree = (active: boolean) => <ContactFeedTab companyId="synthetic-company" readOnly isActive={active} />;
    const view = render(tree(false), { wrapper });
    expect(network.reads).toEqual([]);
    view.rerender(tree(true));
    await waitFor(() => expect(network.reads).toEqual(["company_feed_list"]));
    await waitFor(() => expect(cache.isFetching()).toBe(0));
    view.rerender(tree(false));
    await cache.invalidateQueries();
    expect(network.reads).toEqual(["company_feed_list"]);
    view.rerender(tree(true));
    await waitFor(() => expect(network.reads).toHaveLength(2));
  });
});
