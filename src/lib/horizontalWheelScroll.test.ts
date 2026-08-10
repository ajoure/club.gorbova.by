import { describe, expect, it } from "vitest";
import { scrollHorizontalRibbon } from "./horizontalWheelScroll";

function ribbon(overrides: Partial<HTMLElement> = {}) {
  return {
    clientWidth: 400,
    scrollLeft: 0,
    scrollWidth: 900,
    ...overrides,
  } as Pick<HTMLElement, "clientWidth" | "scrollLeft" | "scrollWidth">;
}

describe("scrollHorizontalRibbon", () => {
  it("uses a regular Windows mouse wheel to move the ribbon horizontally", () => {
    const element = ribbon();

    expect(scrollHorizontalRibbon(element, 0, 120)).toBe(true);
    expect(element.scrollLeft).toBe(120);
  });

  it("preserves a trackpad's dominant horizontal gesture", () => {
    const element = ribbon({ scrollLeft: 200 } as Partial<HTMLElement>);

    expect(scrollHorizontalRibbon(element, -80, 10)).toBe(true);
    expect(element.scrollLeft).toBe(120);
  });

  it("clamps at the edges and releases the wheel when it cannot move", () => {
    const element = ribbon({ scrollLeft: 500 } as Partial<HTMLElement>);

    expect(scrollHorizontalRibbon(element, 0, 120)).toBe(false);
    expect(element.scrollLeft).toBe(500);
  });

  it("does not capture the wheel when the ribbon fits without overflow", () => {
    const element = ribbon({ clientWidth: 900, scrollWidth: 900 } as Partial<HTMLElement>);

    expect(scrollHorizontalRibbon(element, 0, 120)).toBe(false);
    expect(element.scrollLeft).toBe(0);
  });
});
