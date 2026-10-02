import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromptRunFlow } from "./PromptRunFlow";

describe("regulations launcher", () => {
  it("explains limits, has no file upload, validates and sends a text brief", () => {
    const onSubmit = vi.fn();
    render(<PromptRunFlow scenario={{ id: 'prompt', code: 'accounting_regulations', type: 'chat', launcher_title: 'Регламенты бухгалтерии', launcher_description: null, input_hint: null, icon: null, launcher_order: 33 }} onSubmit={onSubmit} onCancel={() => {}} isLoading={false} />);
    expect(screen.getByText(/Файлы не нужны/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Начать регламент' });
    expect(button).toBeDisabled();
    expect(document.querySelector('input[type=file]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Закрытие месяца' }));
    expect(screen.getByLabelText('Описание бухгалтерского процесса')).toHaveValue('Нужен регламент: закрытие месяца. ');
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledWith([], 'Нужен регламент: закрытие месяца. ');
  });
});
