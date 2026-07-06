// Plain-string HTML template for inline-OTP email.
// Sent via Yandex SMTP from noreply@gorbova.by. Keeps style close to
// existing signup/magic-link React Email templates but avoids the React
// render dependency to keep the edge function lean and fast.

export interface InlineOtpEmailParams {
  code: string;
  siteName?: string;
  ttlMinutes?: number;
}

export function renderInlineOtpEmail(params: InlineOtpEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const code = params.code;
  const siteName = params.siteName || "Gorbova Club";
  const ttl = params.ttlMinutes || 10;

  const subject = `Ваш код: ${code}`;

  const text =
    `Ваш код подтверждения: ${code}\n\n` +
    `Введите его на странице, с которой вы запросили вход. ` +
    `Код действителен ${ttl} минут.\n\n` +
    `Если вы не запрашивали код — просто проигнорируйте это письмо.\n\n` +
    `${siteName}\nhttps://gorbova.by`;

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Ваш код: ${escapeHtml(code)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:40px 32px;box-shadow:0 2px 10px rgba(0,0,0,0.04);">
          <tr>
            <td>
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;">Вход в ${escapeHtml(siteName)}</h1>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#3a3a3c;">
                Введите этот код на странице, с которой вы запросили вход —
                возвращаться на другую вкладку не нужно.
              </p>
              <div style="background:#f5f5f7;border-radius:12px;padding:24px;text-align:center;margin:0 0 20px 0;">
                <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:600;letter-spacing:12px;color:#1d1d1f;">${escapeHtml(code)}</div>
              </div>
              <p style="margin:0 0 8px 0;font-size:14px;color:#6e6e73;text-align:center;">
                Ваш код: <strong style="color:#1d1d1f;">${escapeHtml(code)}</strong>
              </p>
              <p style="margin:24px 0 0 0;font-size:13px;line-height:1.5;color:#6e6e73;">
                Код действителен ${ttl} минут. Если вы не запрашивали его — просто
                проигнорируйте это письмо, никакие изменения не произойдут.
              </p>
              <hr style="border:none;border-top:1px solid #e5e5ea;margin:32px 0 16px 0;" />
              <p style="margin:0;font-size:12px;color:#8e8e93;">
                ${escapeHtml(siteName)} · <a href="https://gorbova.by" style="color:#8e8e93;text-decoration:underline;">gorbova.by</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(v: string): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
