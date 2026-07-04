// ============================================================================
// branded-email-shell.ts
// ----------------------------------------------------------------------------
// Единый HTML-каркас писем в стиле бренда Gorbova Club для plain-Deno
// edge-функций (не React Email). Используется в canonical-document-send.
// Не влияет на auth-письма (_shared/email-templates/*.tsx) — те остаются
// на React Email.
//
// Основные соображения:
//   • Body всегда белый (#ffffff) — совместимость с почтовыми клиентами.
//   • Стеклянная карточка: rgba-background + border + shadow. backdrop-filter
//     НЕ используем: в Gmail/Outlook он игнорируется — визуал полагается на
//     обычные inline-стили (полупрозрачный фон + мягкая тень).
//   • Все стили inline; вложенные <style>/классы не работают в Gmail.
//   • Все динамические строки должны быть уже безопасно экранированы вызывающим.
// ============================================================================

export interface BrandedEmailSection {
  /** Заголовок секции (опционально). Уже безопасно эскейпленный HTML или plain-текст. */
  heading?: string;
  /** Абзацы (уже эскейпленные). Каждый рендерится как <p>. */
  paragraphs?: string[];
  /**
   * Callout — выделенный блок для назначения платежа и подобного.
   *   label   — подпись сверху (uppercase),
   *   text    — основной текст (селектируемый, user-select:all),
   *   note    — подсказка снизу (например «Нажмите, чтобы выделить»).
   * Всё уже эскейплено.
   */
  callout?: {
    label?: string;
    text: string;
    note?: string;
  };
}

export interface RenderBrandedEmailInput {
  /** Preheader — короткий текст, который клиент показывает под темой (уже эскейплен). */
  preheader?: string;
  /** Название бренда в шапке. */
  brand?: string;
  /** Заголовок H1 карточки (уже эскейплен). */
  title: string;
  /** Приветствие (уже эскейплено), например «Добрый день, Иван!». */
  greeting?: string;
  /** Основные секции контента. */
  sections: BrandedEmailSection[];
  /** Подпись внизу (уже эскейплена). */
  signature?: string;
}

const COLORS = {
  bodyBg: '#f4f6fb',
  cardBg: 'rgba(255,255,255,0.92)',
  cardBorder: 'rgba(15,23,42,0.08)',
  cardShadow: '0 24px 60px -30px rgba(15,23,42,0.35)',
  brandAccent: '#2563eb',
  headingText: '#0f172a',
  bodyText: '#334155',
  mutedText: '#64748b',
  calloutBg: 'rgba(37,99,235,0.08)',
  calloutBorder: 'rgba(37,99,235,0.25)',
  calloutText: '#1e3a8a',
  divider: 'rgba(15,23,42,0.08)',
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function renderSection(sec: BrandedEmailSection): string {
  const parts: string[] = [];
  if (sec.heading) {
    parts.push(
      `<h2 style="margin:0 0 12px 0;font-size:18px;font-weight:600;color:${COLORS.headingText};letter-spacing:-0.01em;">${sec.heading}</h2>`,
    );
  }
  if (sec.paragraphs?.length) {
    for (const p of sec.paragraphs) {
      parts.push(
        `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:${COLORS.bodyText};">${p}</p>`,
      );
    }
  }
  if (sec.callout) {
    const { label, text, note } = sec.callout;
    parts.push(
      `<div style="margin:20px 0;padding:16px 18px;background:${COLORS.calloutBg};border:1px solid ${COLORS.calloutBorder};border-radius:14px;">
        ${label ? `<div style="font-size:11px;color:${COLORS.mutedText};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:8px;">${label}</div>` : ''}
        <div style="font-size:16px;font-weight:600;color:${COLORS.calloutText};font-family:${FONT_STACK};user-select:all;-webkit-user-select:all;word-break:break-word;">${text}</div>
        ${note ? `<div style="margin-top:8px;font-size:12px;color:${COLORS.mutedText};line-height:1.5;">${note}</div>` : ''}
      </div>`,
    );
  }
  return parts.join('');
}

export function renderBrandedEmail(input: RenderBrandedEmailInput): string {
  const brand = input.brand || 'Gorbova Club';
  const sections = input.sections.map(renderSection).join('');
  const greetingBlock = input.greeting
    ? `<p style="margin:0 0 16px 0;font-size:16px;color:${COLORS.headingText};font-weight:500;">${input.greeting}</p>`
    : '';
  const signatureBlock = input.signature
    ? `<div style="margin-top:28px;padding-top:20px;border-top:1px solid ${COLORS.divider};font-size:13px;color:${COLORS.mutedText};line-height:1.55;">${input.signature}</div>`
    : '';
  const preheader = input.preheader
    ? `<div style="display:none;font-size:1px;color:${COLORS.bodyBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${input.preheader}</div>`
    : '';

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${input.title}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.bodyBg};font-family:${FONT_STACK};color:${COLORS.bodyText};-webkit-font-smoothing:antialiased;">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.bodyBg};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="padding:0 4px 16px 4px;font-size:13px;color:${COLORS.mutedText};letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">
                ${brand}
              </td>
            </tr>
            <tr>
              <td style="background:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:20px;box-shadow:${COLORS.cardShadow};padding:32px 32px 28px 32px;">
                <h1 style="margin:0 0 20px 0;font-size:22px;font-weight:700;color:${COLORS.headingText};letter-spacing:-0.015em;line-height:1.3;">${input.title}</h1>
                ${greetingBlock}
                ${sections}
                ${signatureBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 8px 0 8px;font-size:12px;color:${COLORS.mutedText};line-height:1.5;">
                Это письмо отправлено автоматически платформой ${brand}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
