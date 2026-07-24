import { describe, expect, it } from "vitest";
import {
  toDownloadTelegramDocumentUrl,
  toInlineTelegramDocumentUrl,
} from "./telegramDocumentUrl";

const signed =
  "https://example.supabase.co/storage/v1/object/sign/telegram-media/file.docx?token=abc&download=%D1%84%D0%B0%D0%B9%D0%BB.docx";

describe("Telegram document URLs", () => {
  it("removes forced download mode before handing a signed URL to Office Viewer", () => {
    const result = new URL(toInlineTelegramDocumentUrl(signed));
    expect(result.searchParams.get("token")).toBe("abc");
    expect(result.searchParams.has("download")).toBe(false);
  });

  it("creates a dedicated download URL and preserves the signed token", () => {
    const result = new URL(
      toDownloadTelegramDocumentUrl(
        toInlineTelegramDocumentUrl(signed),
        "101-Рублевый платеж.docx",
      ),
    );
    expect(result.searchParams.get("token")).toBe("abc");
    expect(result.searchParams.get("download")).toBe("101-Рублевый платеж.docx");
  });

  it("does not rewrite third-party URLs", () => {
    const url = "https://files.example.com/document.docx?download=1";
    expect(toInlineTelegramDocumentUrl(url)).toBe(url);
    expect(toDownloadTelegramDocumentUrl(url, "document.docx")).toBe(url);
  });
});
