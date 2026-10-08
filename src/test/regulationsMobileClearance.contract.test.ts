import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A source contract only; published 390x844 screenshots remain the acceptance gate.
describe("member AI mobile composer clearance", () => {
  it("reserves the fixed member navigation and safe area only below md", () => {
    const source = readFileSync("src/components/ai-chat/AiPageContent.tsx", "utf8");
    expect(source).toContain("[--ai-bottom-clearance:calc(3.5rem+env(safe-area-inset-bottom,0px))]");
    expect(source).toContain("md:[--ai-bottom-clearance:0px]");
    expect(source).toContain('mode === "user" ? "-mt-2');
    expect(source.match(/var\(--ai-bottom-clearance, 0px\)/g)).toHaveLength(2);
  });
});
