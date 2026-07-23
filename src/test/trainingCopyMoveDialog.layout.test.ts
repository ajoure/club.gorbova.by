import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/admin/trainings/CopyMoveDialog.tsx"),
  "utf8",
);

describe("training copy/move dialog layout", () => {
  it("keeps the action footer outside the independently scrollable module tree", () => {
    const scrollArea = source.indexOf('data-testid="copy-move-scroll-area"');
    const actions = source.indexOf('data-testid="copy-move-actions"');

    expect(scrollArea).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(scrollArea);
    expect(source).toContain(
      'className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-2"',
    );
    expect(source).toContain(
      'className="shrink-0 border-t bg-background px-6 py-4"',
    );
    expect(source).toContain("max-h-[min(90dvh,48rem)]");
    expect(source).not.toContain('max-h-[90vh] overflow-y-auto');
  });

  it("shows the server-provided copy error instead of only the generic SDK error", () => {
    expect(source).toContain("const payload = await error.context?.json()");
    expect(source).toContain("if (payload?.error) message = payload.error");
  });
});
