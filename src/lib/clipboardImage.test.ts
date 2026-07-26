import { describe, expect, it } from "vitest";
import { getClipboardFile } from "./clipboardImage";

function clipboardData(
  items: Array<{
    kind: string;
    type: string;
    getAsFile: () => File | null;
  }>,
  files: File[] = [],
): Pick<DataTransfer, "items" | "files"> {
  return { items, files } as unknown as Pick<DataTransfer, "items" | "files">;
}

describe("getClipboardFile", () => {
  it("turns a pasted PNG into a consistently named screenshot", async () => {
    const source = new File(["pixels"], "image.png", { type: "image/png" });
    const result = getClipboardFile(
      clipboardData([
        { kind: "file", type: "image/png", getAsFile: () => source },
      ]),
      1_234,
    );

    expect(result?.name).toBe("screenshot-1234.png");
    expect(result?.type).toBe("image/png");
    expect(await result?.text()).toBe("pixels");
  });

  it("uses clipboard files when the item list is unavailable", () => {
    const source = new File(["jpeg"], "", { type: "image/jpeg" });
    const result = getClipboardFile(clipboardData([], [source]), 5_678);

    expect(result?.name).toBe("screenshot-5678.jpg");
  });

  it("does not intercept text-only paste", () => {
    const result = getClipboardFile(
      clipboardData([
        { kind: "string", type: "text/plain", getAsFile: () => null },
      ]),
    );

    expect(result).toBeNull();
  });

  it("preserves the original name and type for a copied document", async () => {
    const source = new File(["report"], "Отчёт.pdf", {
      type: "application/pdf",
    });
    const result = getClipboardFile(
      clipboardData([
        {
          kind: "file",
          type: "application/pdf",
          getAsFile: () => source,
        },
      ]),
      9_999,
    );

    expect(result).toBe(source);
    expect(result?.name).toBe("Отчёт.pdf");
    expect(await result?.text()).toBe("report");
  });
});
