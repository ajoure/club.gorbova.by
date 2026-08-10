import { describe, expect, it } from "vitest";
import rolloutSource from "../hooks/useContactCenterFeatureFlag.ts?raw";
import settingsSource from "../components/admin/communication/CommunicationSettingsTabContent.tsx?raw";
import communicationPageSource from "../pages/admin/AdminCommunication.tsx?raw";

describe("contact center global rollout", () => {
  it("does not depend on browser-local opt-in state", () => {
    expect(rolloutSource).toContain('enabled: true');
    expect(rolloutSource).toContain('source: "global-rollout"');
    expect(rolloutSource).not.toContain("localStorage.getItem");
    expect(rolloutSource).not.toContain("contact_center_unified_inbox_optin");
  });

  it("keeps the unified inbox as the contact-center implementation", () => {
    expect(communicationPageSource).toContain("unifiedEnabled && inboxChannel !== \"email\"");
    expect(communicationPageSource).toContain("<UnifiedInboxView");
    expect(communicationPageSource).toContain('deepLinkTelegramUserId={searchParams.get("chat")}');
  });

  it("shows employees that rollout is centralized", () => {
    expect(settingsSource).toContain("Включена для всех");
    expect(settingsSource).toContain("не зависит от браузера, устройства или localStorage");
    expect(settingsSource).toContain("flex flex-col items-start gap-3 sm:flex-row");
    expect(settingsSource).toContain("w-[calc(100vw-2rem)] min-w-0 max-w-full");
    expect(settingsSource).toContain("w-full max-w-full overflow-hidden");
    expect(settingsSource).not.toContain("UnifiedInboxToggleCard");
  });
});
