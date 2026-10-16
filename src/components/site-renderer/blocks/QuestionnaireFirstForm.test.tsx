import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), verify: vi.fn(), invoke: vi.fn(), changeEmail: vi.fn(),
  user: null as null | { id?: string; email: string; email_confirmed_at?: string }, linked: true,
  profile: null as null | { full_name: string; first_name: string; last_name: string; phone: string; instagram_url: string },
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.profile, isLoading: false, isError: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("./QuestionnaireTelegramStep", () => ({ QuestionnaireTelegramStep: ({ onLinkedChange }: { onLinkedChange: (linked: boolean) => void }) => {
  useEffect(() => { onLinkedChange(mocks.linked); }, [onLinkedChange]);
  return <button onClick={() => onLinkedChange(true)}>Подключить support-бота</button>;
} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("@/hooks/useInlineEmailOtp", () => ({ useInlineEmailOtp: () => ({
  requestQuestionnaireCode: mocks.request, verifyCode: mocks.verify, email: "test@example.com",
  changeEmail: mocks.changeEmail, resend: vi.fn(), resendIn: 0, error: null, isSending: false, isVerifying: false,
}) }));

import { QuestionnaireFirstForm } from "./QuestionnaireFirstForm";
const content = {
  fields: [
    { label: "Имя", type: "text", mapping: "full_name", required: true },
    { label: "Email", type: "email", mapping: "email", required: true },
    { label: "Комментарий", type: "textarea", required: true },
  ],
  buttonText: "Отправить анкету",
};
const show = () => render(<QuestionnaireFirstForm content={content} pageId="page" blockId="block" />);
function fillAnswers() {
  fireEvent.change(screen.getByLabelText("Имя*"), { target: { value: "Тест" } });
  fireEvent.change(screen.getByLabelText("Email*"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("Комментарий*"), { target: { value: "Тестовый комментарий" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("questionnaire-first journey", () => {
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks(); mocks.user = null; mocks.linked = true; mocks.profile = null;
    mocks.request.mockResolvedValue(true);
    mocks.verify.mockResolvedValue({ userId: "verified-user" });
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
  });
  afterEach(cleanup);

  it("webinar registration reuses OTP and bot but never displays a questionnaire step", async () => {
    const registration = { contact_first: true, webinar_registration: true, fields: [
      { label: "Имя", type: "text", mapping: "first_name", required: true },
      { label: "Фамилия", type: "text", mapping: "last_name", required: true },
      { label: "Email", type: "email", mapping: "email", required: true },
      { label: "Телефон", type: "phone", mapping: "phone", required: true },
    ] };
    render(<QuestionnaireFirstForm content={registration} pageId="page" blockId="block" initialContactValues={{ first_name: "Анна", last_name: "Иванова", email: "test@example.com", phone: "+375291234567" }} />);
    expect(screen.getByLabelText("Имя*")).toHaveValue("Анна");
    expect(screen.getByLabelText("Фамилия*")).toHaveAttribute("autocomplete", "family-name");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    fireEvent.change(await screen.findByLabelText("Код из письма"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить почту" }));
    const finish = await screen.findByRole("button", { name: "Завершить регистрацию" });
    expect(mocks.invoke.mock.calls[0][1].body.action).toBe("questionnaire_contact");
    expect(screen.queryByText("Анкета предзаписи")).not.toBeInTheDocument();
    fireEvent.click(finish);
    await screen.findByText("Вы зарегистрированы на вебинар");
    const body = mocks.invoke.mock.calls[1][1].body;
    expect(body.action).toBe("webinar_registration");
    expect(body.fields).toHaveLength(4);
  });
  it("shows answers before auth, restores them after reload and never submits on mount", () => {
    const view = show(); fillAnswers(); view.unmount(); show();
    expect(screen.getByLabelText("Комментарий*")).toHaveValue("Тестовый комментарий");
    expect(screen.queryByLabelText("Код из письма")).not.toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
    // Consent is an explicit action for this attempt; it is not restored from a draft.
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("asks for a code at the end and submits once only after successful verification", async () => {
    show(); fillAnswers();
    fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
    await screen.findByLabelText("Код из письма");
    expect(mocks.request).toHaveBeenCalledWith("test@example.com", "site-questionnaire:page:block", null);
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Код из письма"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить почту" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сохранить анкету и получить бонусы" }));
    await screen.findByText("Анкета сохранена");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const body = mocks.invoke.mock.calls[0][1].body;
    expect(body.fields).toHaveLength(3);
    expect(body.fields[2].value).toBe("Тестовый комментарий");
    expect(body.submission_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem("site-questionnaire:v1:page:block")).toBeNull();
  });
  it("failed verification never creates a submission and preserves the draft", async () => {
    mocks.verify.mockResolvedValue(null);
    show(); fillAnswers(); fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
    await screen.findByLabelText("Код из письма");
    fireEvent.change(screen.getByLabelText("Код из письма"), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Подтвердить почту" })); });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem("site-questionnaire:v1:page:block")).toContain("Тестовый комментарий");
  });
  it("rejects a one-digit phone before requesting a code, then accepts a corrected phone", async () => {
    render(<QuestionnaireFirstForm content={{ ...content, fields: [...content.fields, { label: "Телефон", type: "phone", mapping: "phone", required: true }] }} pageId="page" blockId="block" />);
    fillAnswers();
    fireEvent.change(screen.getByLabelText("Телефон*"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("от 8 до 15 цифр");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Телефон*"), { target: { value: "+375291234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
    await screen.findByLabelText("Код из письма");
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("a failed request can be retried with the same key and double-click does not create concurrent requests", async () => {
    mocks.user = { email: "test@example.com" };
    let fail: (v: unknown) => void = () => {};
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { fail = resolve; }));
    show(); fillAnswers();
    const button = screen.getByRole("button", { name: "Отправить анкету" });
    fireEvent.click(button);
    const save = await screen.findByRole("button", { name: "Сохранить анкету и получить бонусы" });
    fireEvent.click(save); fireEvent.click(save);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    const key = mocks.invoke.mock.calls[0][1].body.submission_key;
    await act(async () => { fail({ data: null, error: new Error("network") }); });
    expect(localStorage.getItem("site-questionnaire:v1:page:block")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить анкету и получить бонусы" }));
    await screen.findByText("Анкета сохранена");
    expect(mocks.invoke.mock.calls[1][1].body.submission_key).toBe(key);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not attach another email's answers to an open account", async () => {
    mocks.user = { email: "other@example.com" };
    show(); fillAnswers(); fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Укажите email аккаунта"));
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not save or redirect before the support bot is connected", async () => {
    mocks.user = { email: "test@example.com" }; mocks.linked = false;
    show(); fillAnswers(); fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
    const save = await screen.findByRole("button", { name: "Сохранить анкету и получить бонусы" });
    expect(save).toBeDisabled(); expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Подключить support-бота" }));
    expect(save).toBeEnabled(); fireEvent.click(save);
    await screen.findByText("Анкета сохранена");
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

});

const contactContent = { ...content, contact_first: true, fields: [
  ...content.fields.slice(0, 2),
  { label: "Телефон", type: "phone", mapping: "phone", required: true },
  { label: "Instagram", type: "text", mapping: "instagram_url", required: true },
  content.fields[2],
] };
function contacts() {
  fireEvent.change(screen.getByLabelText("Имя*"), { target: { value: "Тест" } });
  fireEvent.change(screen.getByLabelText("Email*"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("Телефон*"), { target: { value: "+375291234567" } });
  fireEvent.change(screen.getByLabelText("Instagram*"), { target: { value: "test.client" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
describe("contact-first opt-in journey", () => {
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks(); mocks.user = null; mocks.profile = null; mocks.linked = false;
    mocks.request.mockResolvedValue(true); mocks.verify.mockResolvedValue({ userId: "verified-user" });
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
  });
  afterEach(cleanup);
  it("verifies anonymous email before saving contacts, retains them on abandonment and hides questions until bot linking", async () => {
    const view = render(<QuestionnaireFirstForm content={contactContent} pageId="page" blockId="block" />);
    expect(screen.queryByLabelText("Комментарий*")).not.toBeInTheDocument();
    expect(screen.queryByText(/ник.*Telegram/i)).not.toBeInTheDocument();
    contacts(); fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByLabelText("Код из письма"); expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Код из письма"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить почту" }));
    await screen.findByRole("button", { name: "Подключить support-бота" });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({ action: "questionnaire_contact", privacy_consent: { accepted: true } });
    expect(mocks.invoke.mock.calls[0][1].body.fields).toHaveLength(4);
    expect(screen.queryByLabelText("Комментарий*")).not.toBeInTheDocument();
    view.unmount(); // A successful contact save is independent of finishing the questionnaire.
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(localStorage.getItem("site-questionnaire:v1:page:block")).toContain("test.client");
  });
  it("prefills only the signed-in profile and skips repeated OTP and an already linked bot", async () => {
    mocks.user = { id: "owner", email: "test@example.com", email_confirmed_at: "2026-01-01" }; mocks.linked = true;
    mocks.profile = { full_name: "Своя карточка", first_name: "Своя", last_name: "Карточка", phone: "+375291234567", instagram_url: "own.profile" };
    render(<QuestionnaireFirstForm content={contactContent} pageId="page" blockId="block" />);
    expect(await screen.findByLabelText("Имя*")).toHaveValue("Своя карточка");
    expect(screen.getByLabelText("Email*")).toHaveValue("test@example.com");
    expect(screen.getByLabelText("Instagram*")).toHaveValue("own.profile");
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByLabelText("Комментарий*");
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
    const key = mocks.invoke.mock.calls[0][1].body.submission_key;
    fireEvent.change(screen.getByLabelText("Комментарий*"), { target: { value: "Полный ответ" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
    await screen.findByText("Анкета сохранена");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls[1][1].body).toMatchObject({ submission_key: key });
    expect(mocks.invoke.mock.calls[1][1].body.action).toBeUndefined();
    expect(mocks.invoke.mock.calls[1][1].body.fields[4].value).toBe("Полный ответ");
  });
  it("failed OTP or failed contact save never exposes survey questions", async () => {
    mocks.verify.mockResolvedValue(null);
    render(<QuestionnaireFirstForm content={contactContent} pageId="page" blockId="block" />);
    contacts(); fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByLabelText("Код из письма");
    fireEvent.change(screen.getByLabelText("Код из письма"), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Подтвердить почту" })); });
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.verify.mockResolvedValue({ userId: "verified-user" }); mocks.invoke.mockResolvedValueOnce({ error: new Error("network") });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить почту" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("контакты не удалось сохранить");
    expect(screen.getByLabelText("Email*")).toHaveValue("test@example.com");
    expect(screen.queryByLabelText("Комментарий*")).not.toBeInTheDocument();
  });
  it("does not treat an unconfirmed browser session as verified email", async () => {
    mocks.user = { id: "unconfirmed", email: "test@example.com" };
    render(<QuestionnaireFirstForm content={contactContent} pageId="page" blockId="block" />);
    contacts(); fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByLabelText("Код из письма"); expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
