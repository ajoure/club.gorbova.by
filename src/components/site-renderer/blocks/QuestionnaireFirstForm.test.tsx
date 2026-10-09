import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), verify: vi.fn(), invoke: vi.fn(), changeEmail: vi.fn(),
  user: null as null | { email: string },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
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
    localStorage.clear(); vi.clearAllMocks(); mocks.user = null;
    mocks.request.mockResolvedValue(true);
    mocks.verify.mockResolvedValue({ userId: "verified-user" });
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
  });
  afterEach(cleanup);

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
    expect(mocks.request).toHaveBeenCalledWith("test@example.com");
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Код из письма"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить и отправить" }));
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
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Подтвердить и отправить" })); });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem("site-questionnaire:v1:page:block")).toContain("Тестовый комментарий");
  });
  it("a failed request can be retried with the same key and double-click does not create concurrent requests", async () => {
    mocks.user = { email: "test@example.com" };
    let fail: (v: unknown) => void = () => {};
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { fail = resolve; }));
    show(); fillAnswers();
    const button = screen.getByRole("button", { name: "Отправить анкету" });
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const key = mocks.invoke.mock.calls[0][1].body.submission_key;
    await act(async () => { fail({ data: null, error: new Error("network") }); });
    expect(localStorage.getItem("site-questionnaire:v1:page:block")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Отправить анкету" }));
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
});
