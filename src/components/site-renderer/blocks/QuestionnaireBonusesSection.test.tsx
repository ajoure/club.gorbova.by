import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: null as null | { id: string }, telegram: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("./QuestionnaireTelegramStep", () => ({ QuestionnaireTelegramStep: () => {
  mocks.telegram(); return <p>Подключение support-бота</p>;
} }));
import { QuestionnaireBonusesSection } from "./QuestionnaireBonusesSection";
const content = { channel_url: "https://t.me/+thanks-fixture", channel_title: "Канал из настроек", personal_chat_url: "https://t.me/m/configuredSlug" };
describe("thank-you page shared Telegram links", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: "owner" }; });
  afterEach(cleanup);
  it("uses configured shared channel and business links without lessons or recipient-bound invitations", () => {
    render(<QuestionnaireBonusesSection content={content} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Вступить в бесплатный канал" })).toHaveAttribute("href", content.channel_url);
    expect(screen.getByRole("link", { name: "Написать Катерине в Telegram" })).toHaveAttribute("href", content.personal_chat_url);
    expect(screen.getByText(content.channel_title)).toBeInTheDocument();
    expect(screen.queryByText(/урок|тренинг|персональн/i)).toBeNull();
  });
  it("allows a forwarded thank-you page to show the shared links without requiring an account", () => {
    mocks.user = null;
    render(<QuestionnaireBonusesSection content={content} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(mocks.telegram).not.toHaveBeenCalled();
  });
  it("never prepares bot linking in preview", () => {
    render(<QuestionnaireBonusesSection content={content} isPreview />);
    expect(mocks.telegram).not.toHaveBeenCalled();
  });
  it("does not expose an unsafe configured channel address", () => {
    render(<QuestionnaireBonusesSection content={{ channel_url: "https://wrong.example/invite" }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
