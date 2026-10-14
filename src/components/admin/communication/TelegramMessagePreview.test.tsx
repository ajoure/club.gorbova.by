import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TelegramMessagePreview } from "./TelegramMessagePreview";

describe("TelegramMessagePreview", () => {
  it("shows two separate buttons below the short questionnaire receipt", () => {
    const text="Спасибо! Ваша анкета предзаписи получена ✅.";
    const { container }=render(<TelegramMessagePreview text={text} showButton buttonText="Ваш бонус" additionalButtonText="Получить бонус от Катерины" />);
    expect(screen.getByText(text)).toBeInTheDocument();
    const first=screen.getByText("Ваш бонус");
    const second=screen.getByText("Получить бонус от Катерины");
    expect(first.parentElement).toBe(second.parentElement);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/https?:|подготовлен|Отправить/);
  });
  it("shows GIF, text and button as one Telegram message", () => {
    render(
      <TelegramMessagePreview
        text="Короткое уведомление"
        mediaType="animation"
        mediaUrl="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
        fileName="test.gif"
        showButton
        buttonText="Открыть"
        deliveryHint="Медиа, короткий текст и кнопка будут отправлены одним сообщением."
        willSplit={false}
      />,
    );

    expect(screen.getByAltText("GIF в рассылке")).toBeInTheDocument();
    expect(screen.getByText("Короткое уведомление")).toBeInTheDocument();
    expect(screen.getByText("Открыть")).toBeInTheDocument();
    expect(screen.getByText(/Будет отправлено вместе/)).toBeInTheDocument();
  });

  it("warns when a video circle and text require two messages", () => {
    render(
      <TelegramMessagePreview
        text="Текст после кружка"
        mediaType="video_note"
        fileName="circle.mp4"
        deliveryHint="Telegram не поддерживает подпись у кружка."
        willSplit
      />,
    );

    expect(screen.getByText(/Видеокружок/)).toBeInTheDocument();
    expect(screen.getByText(/Будет разделено/)).toBeInTheDocument();
  });
});
