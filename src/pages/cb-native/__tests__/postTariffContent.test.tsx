import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostTariffSection } from "../sections/PostTariffSection";

describe("CbNativePreview post-tariff content", () => {
  it("does not render the obsolete countdown", () => {
    render(<PostTariffSection />);

    expect(screen.queryByText("БОНУСЫ И СКИДКИ СГОРАЮТ ЧЕРЕЗ")).not.toBeInTheDocument();
  });
});
