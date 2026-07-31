import { describe, expect, it } from "vitest";
import previewSource from "./HtmlIframePreview.tsx?raw";

describe("Tilda offer-slot fallback", () => {
  it("keeps an actionable slot visible when the page has no matching template", () => {
    expect(previewSource).toContain(
      "Keep the button actionable using\n          // its authored visual treatment",
    );
    expect(previewSource).not.toContain(
      "// rendering a mismatched button.\n          deactivateWrapper(pw.el);",
    );
  });
});
