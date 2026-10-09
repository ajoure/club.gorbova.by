import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: null as null | { id: string }, telegram: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("./QuestionnaireTelegramStep", () => ({ QuestionnaireTelegramStep: (props: unknown) => {
  mocks.telegram(props); return <p>Персональные приглашения</p>;
} }));
import { QuestionnaireBonusesSection } from "./QuestionnaireBonusesSection";
const content = { source_page_id: "c8c5c19a-a10d-4f6b-8049-449f37230ed0", source_block_id: "7f144dcc-1a71-4225-8399-efd4d91502cd" };
describe("thank-you page personal Telegram bonuses", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: "owner" }; });
  afterEach(cleanup);
  it("uses the original questionnaire identity, without lessons or shared invitation URLs", () => {
    render(<QuestionnaireBonusesSection content={content} />);
    expect(mocks.telegram).toHaveBeenCalledWith({ pageId: content.source_page_id, blockId: content.source_block_id });
    expect(screen.getByText(/бесплатные Telegram-каналы/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/урок|тренинг/i)).toBeNull();
  });
  it("does not request personal links in a public unauthenticated session or preview", () => {
    mocks.user = null;
    const view = render(<QuestionnaireBonusesSection content={content} />);
    expect(screen.getByRole("status")).toHaveTextContent("вашем аккаунте");
    expect(mocks.telegram).not.toHaveBeenCalled();
    view.rerender(<QuestionnaireBonusesSection content={content} isPreview />);
    expect(mocks.telegram).not.toHaveBeenCalled();
  });
  it("fails closed for a missing source form instead of showing a generic channel link", () => {
    render(<QuestionnaireBonusesSection content={{}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("не настроены");
    expect(mocks.telegram).not.toHaveBeenCalled();
  });
});
