import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeroSection } from "../sections/HeroSection";
import { rec } from "../manifest";

describe("CbNativePreview hero acceptance slice", () => {
  it("uses the cbold hero title as the only H1", () => {
    render(<HeroSection onCta={() => {}} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("ЦЕННЫЙ БУХГАЛТЕР");
    expect(heading).not.toHaveTextContent("Как быстро освоить правильную методологию");
    expect(screen.getAllByText("октябрь 2026 года")).toHaveLength(2);
  });

  it("uses the crown asset, not the format-video pictogram, above the headline", () => {
    const { container } = render(<HeroSection onCta={() => {}} />);
    const hero = rec("rec776467157");
    const crown = container.querySelector('h1')?.parentElement?.querySelector("img");

    expect(crown).toHaveAttribute("src", hero.images[1]);
    expect(crown).not.toHaveAttribute("src", hero.images[0]);
  });
});
