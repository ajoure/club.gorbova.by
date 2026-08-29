import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideRoomEntryIdentity } from "./roomEntryIdentity";

describe("room entry identity", () => {
  it("asks for confirmation on a new room entry even when a saved name exists", () => {
    expect(decideRoomEntryIdentity({
      nameRequired: true,
      savedDisplayName: "Тест Тестовый",
      hadSessionOnLoad: false,
      isReload: false,
      roomActive: true,
    })).toBe("prompt");
  });

  it("silently reuses the saved name only when this tab already has a room session", () => {
    expect(decideRoomEntryIdentity({
      nameRequired: true,
      savedDisplayName: "Тест Тестовый",
      hadSessionOnLoad: true,
      isReload: true,
      roomActive: true,
    })).toBe("reuse");
  });

  it("does not block rooms where the name is optional", () => {
    expect(decideRoomEntryIdentity({
      nameRequired: false,
      savedDisplayName: null,
      hadSessionOnLoad: false,
      isReload: false,
      roomActive: true,
    })).toBe("skip");
  });

  it("asks again when a direct navigation happens in a tab with a stale session key", () => {
    expect(decideRoomEntryIdentity({
      nameRequired: true,
      savedDisplayName: "Тест Тестовый",
      hadSessionOnLoad: true,
      isReload: false,
      roomActive: true,
    })).toBe("prompt");
  });

  it("starts participant tracking only after identity confirmation", () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), "src/pages/LiveEvent.tsx"),
      "utf8",
    );
    const dialogSource = readFileSync(
      resolve(process.cwd(), "src/components/live/RoomEntryDialog.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("roomActive && entrySatisfied && data?.event_id");
    expect(pageSource).toContain("hadSessionOnLoad: hadRoomSessionOnLoadRef.current");
    expect(pageSource).toContain("isReload: isReloadRef.current");
    expect(dialogSource).toContain("showCloseButton={false}");
    expect(dialogSource).toContain("onEscapeKeyDown={(event) => event.preventDefault()}");
    expect(dialogSource).toContain("onPointerDownOutside={(event) => event.preventDefault()}");
  });
});
