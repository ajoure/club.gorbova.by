import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CasesSection } from "../sections/CasesSection";

describe("CbNative cases carousel", () => {
  it("keeps every case in one swipeable horizontal rail", () => {
    const { container } = render(<CasesSection />);
    const carousel = container.querySelector("[data-cb-native-cases-carousel]");
    const items = carousel?.querySelectorAll("[data-cb-native-case-item]");

    expect(carousel).toBeTruthy();
    expect(container.querySelector("[data-cb-native-cases-grid]")).toBeNull();
    expect(items?.length).toBeGreaterThanOrEqual(12);
  });
});
