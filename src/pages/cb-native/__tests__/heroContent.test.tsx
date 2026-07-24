import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeroSection } from "../sections/HeroSection";

describe("CbNativePreview hero acceptance slice", () => {
  it("uses the cbold hero title as the only H1", () => {
    render(<HeroSection onCta={() => {}} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("ЦЕННЫЙ БУХГАЛТЕР");
    expect(heading).not.toHaveTextContent("Как быстро освоить правильную методологию");
  });
});