import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoursePricing } from "./CoursePricing";
import { CB21_PRODUCT_ID } from "@/pages/cb-native/tariffPublicContract";
const { lookup, checkout } = vi.hoisted(() => ({ lookup: vi.fn(), checkout: vi.fn() }));
vi.mock("@/hooks/usePublicProduct", () => ({ usePublicProduct: lookup }));
vi.mock("@/components/landing/UniversalPricingSection", () => ({
  UniversalPricingSkeleton: () => <p>Загрузка</p>,
  UniversalPricingSection: (props: unknown) => { checkout(props); return <p>Каталог</p>; },
}));

describe("course landing uses the actual 21st cohort catalogue", () => {
  it("passes live product, tariff and offer IDs and amounts to the shared checkout", () => {
    const product = { id: CB21_PRODUCT_ID, name: "21 поток" };
    const tariffs = [1790, 2190, 2990].map((price, index) => ({
      id: `new-tariff-${index}`, code: ["accountant", "chief_accountant", "business_lady"][index],
      name: "", current_price: price, offers: [{ id: `new-offer-${index}`, amount: price }],
    }));
    lookup.mockReturnValue({ data: { product, tariffs } });
    render(<CoursePricing />);
    expect(lookup).toHaveBeenLastCalledWith({ productId: CB21_PRODUCT_ID });
    expect(checkout).toHaveBeenLastCalledWith(expect.objectContaining({ product, tariffs, composableCheckoutMode: "always" }));
    const changed = tariffs.map(t => ({ ...t, current_price: 3100, offers: [{ id: "changed-offer", amount: 3100 }] }));
    lookup.mockReturnValue({ data: { product, tariffs: changed } });
    render(<CoursePricing />);
    expect(checkout.mock.lastCall?.[0].tariffs).toEqual(changed);
  });
  it.each([
    { error: new Error("unavailable") },
    { data: { product: { id: "20th-cohort" }, tariffs: [{ id: "old" }] } },
    { data: { product: { id: CB21_PRODUCT_ID }, tariffs: [] } },
  ])("does not offer stale or wrong-cohort payment when catalogue is unavailable", (result) => {
    checkout.mockClear(); lookup.mockReturnValue(result);
    render(<CoursePricing />);
    expect(screen.getByText(/Тарифы временно недоступны/)).toBeInTheDocument();
    expect(checkout).not.toHaveBeenCalled();
  });
});
