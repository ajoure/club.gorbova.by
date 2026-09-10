import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const stylesheet = postcss.parse(readFileSync("src/index.css", "utf8"));

// Guard the global declarations that caused the member-area regression.
// This is a CSS contract, not a substitute for native iOS scroll acceptance.
function declarationsFor(selector: string, property: string) {
  const values: string[] = [];
  stylesheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (declaration) => { values.push(declaration.value); });
  });
  return values;
}

describe("document scrolling and pull-to-refresh boundary", () => {
  it("blocks native refresh at the document root, not at the non-scrolling body", () => {
    expect(declarationsFor("html", "overscroll-behavior-y")).toContain("none");
    expect(declarationsFor("body", "overscroll-behavior-y")).not.toContain("none");
    expect(declarationsFor("body", "overscroll-behavior-y")).not.toContain("contain");
    expect(declarationsFor("body", "overscroll-behavior")).not.toContain("none");
    expect(declarationsFor("body", "overscroll-behavior")).not.toContain("contain");
  });

  it("keeps horizontal page overflow protection and nested vertical scroll chaining", () => {
    expect(declarationsFor("html", "overflow-x")).toContain("hidden");
    expect(declarationsFor("body", "overflow-x")).toContain("hidden");
    expect(declarationsFor(".touch-scroll", "overscroll-behavior-y")).toEqual(["auto"]);
  });
});
