// ============================================================================
// canonical-document-send
// ----------------------------------------------------------------------------
// Канонический отправитель уже сгенерированных документов (ai_generated_documents).
//
// КОНТРАКТ:
//   - Вход: { document_id, send_email?: boolean, send_telegram?: boolean }
//   - Никаких bucket/file_path от клиента — только document_id из БД.
//   - JWT-only: пользователь может работать только со своими документами.
//     super_admin / admin / accountant — со всеми (через has_role_v2).
//   - НЕ создаёт новые документы и НЕ расходует номер. Если документа нет —
//     возвращает 404 (клиент должен сначала вызвать canonical-document-generate-strict).
//   - Email: через send-email с PDF attachment (multipart/mixed).
//   - Telegram: sendDocument (multipart/form-data, PDF файлом), НЕ sendMessage.
//   - Audit: пишет document.sent.email / document.sent.telegram / document.send_failed.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { renderBrandedEmail, type BrandedEmailSection } from "../_shared/branded-email-shell.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SendRequest {
  document_id: string;
  send_email?: boolean;
  send_telegram?: boolean;
  /** Опциональный override email-получателя — иначе берём из profile.email */
  to_email?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getCallerUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  try {
    const { data, error } = await (client.auth as any).getClaims(token);
    if (!error && data?.claims?.sub) return data.claims.sub as string;
  } catch (_) {
    // fall through to getUser
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

async function isElevated(supabase: any, userId: string): Promise<boolean> {
  const elevatedRoles = ["super_admin", "admin", "accountant"];
  for (const role of elevatedRoles) {
    const { data } = await supabase.rpc("has_role_v2", {
      _user_id: userId,
      _role: role,
    });
    if (data === true) return true;
  }
  return false;
}

// ============================================================================
// Telegram sendDocument (multipart/form-data)
// ============================================================================
async function tgGetBotToken(supabase: any): Promise<string | null> {
  const { data: club } = await supabase
    .from("telegram_clubs")
    .select("bot_id, telegram_bots(bot_token_encrypted)")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (club?.telegram_bots?.bot_token_encrypted) {
    return club.telegram_bots.bot_token_encrypted;
  }
  const { data: bot } = await supabase
    .from("telegram_bots")
    .select("bot_token_encrypted")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return bot?.bot_token_encrypted || null;
}

async function tgSendDocument(
  botToken: string,
  chatId: string | number,
  pdfBytes: Uint8Array,
  filename: string,
  caption: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append(
      "document",
      new Blob([pdfBytes], { type: "application/pdf" }),
      filename,
    );
    const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
    const resp = await fetch(url, { method: "POST", body: form });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// Audit helper
// ============================================================================
async function writeAudit(
  supabase: any,
  event_type: string,
  document_id: string,
  user_id: string | null,
  meta: Record<string, unknown>,
) {
  try {
    await supabase.from("audit_logs").insert({
      event_type,
      entity_type: "ai_generated_document",
      entity_id: document_id,
      user_id,
      payload: meta,
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}

// ============================================================================
// Main
// ============================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const userId = await getCallerUserId(req);
    if (!userId) return json(401, { error: "unauthorized" });

    const body = (await req.json().catch(() => null)) as SendRequest | null;
    if (!body?.document_id || typeof body.document_id !== "string") {
      return json(400, { error: "invalid_document_id" });
    }
    if (!body.send_email && !body.send_telegram) {
      return json(400, { error: "no_action_requested" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ---- Load document + verify ownership -----------------------------------
    const { data: doc, error: docErr } = await admin
      .from("ai_generated_documents")
      .select(
        "id, profile_id, file_path, file_name, file_mime, storage_bucket, status, deleted_at, document_number, context_type, context_id, title, snapshot, meta",
      )
      .eq("id", body.document_id)
      .maybeSingle();

    if (docErr) return json(500, { error: "db_error", detail: docErr.message });
    if (!doc || doc.deleted_at) return json(404, { error: "document_not_found" });
    const isReadyStatus = doc.status === "generated" || doc.status === "success";
    if (!isReadyStatus || !doc.file_path) {
      return json(409, { error: "document_not_ready" });
    }

    // Owner check (or elevated role)
    const elevated = await isElevated(admin, userId);
    if (!elevated) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id, user_id, email, telegram_user_id, full_name")
        .eq("id", doc.profile_id)
        .maybeSingle();
      if (!profile || profile.user_id !== userId) {
        return json(403, { error: "forbidden" });
      }
    }

    // Reload profile data (always — нужен email и tg_id, кем бы ни был caller)
    const { data: docProfile } = await admin
      .from("profiles")
      .select("id, email, telegram_user_id, full_name")
      .eq("id", doc.profile_id)
      .maybeSingle();

    // ---- Payment guard ------------------------------------------------------
    // По умолчанию: документы доступны только по оплаченным order'ам.
    // Исключение — invoice-only счёт ЮЛ/ИП (checkout_kind='invoice',
    // awaits_payment=true, payer_type in legal_entity/entrepreneur):
    // сам счёт на оплату по определению выписывается ДО оплаты, и его
    // разрешено отправить на email/telegram плательщика.
    // Физлица без оплаты — по-прежнему заблокированы.
    let isPrePaymentInvoice = false;
    let orderCreatedAt: string | null = null;
    let orderInfo: {
      final_price: number | null;
      currency: string | null;
      product_name: string | null;
      tariff_name: string | null;
    } = { final_price: null, currency: null, product_name: null, tariff_name: null };
    if (doc.context_type === "order" && doc.context_id) {
      const { data: order } = await admin
        .from("orders_v2")
        .select(
          "id, status, customer_email, payer_type, meta, created_at, final_price, currency, product_id, tariff_id, payments_v2(status)",
        )
        .eq("id", doc.context_id)
        .maybeSingle();
      const hasPayment =
        order?.status === "paid" &&
        Array.isArray(order?.payments_v2) &&
        order.payments_v2.some((p: any) => String(p.status).toLowerCase() === "succeeded");
      const orderMeta = (order?.meta ?? {}) as Record<string, unknown>;
      isPrePaymentInvoice =
        !hasPayment &&
        orderMeta?.checkout_kind === "invoice" &&
        orderMeta?.awaits_payment === true &&
        (order?.payer_type === "legal_entity" || order?.payer_type === "entrepreneur");
      orderCreatedAt = (order?.created_at as string) ?? null;
      orderInfo.final_price = order?.final_price ?? null;
      orderInfo.currency = order?.currency ?? null;
      if (order?.product_id) {
        const { data: prod } = await admin
          .from("products_v2")
          .select("public_title, name")
          .eq("id", order.product_id)
          .maybeSingle();
        orderInfo.product_name = prod?.public_title || prod?.name || null;
      }
      if (order?.tariff_id) {
        const { data: tar } = await admin
          .from("tariffs")
          .select("name, public_title")
          .eq("id", order.tariff_id)
          .maybeSingle();
        orderInfo.tariff_name = (tar as any)?.public_title || tar?.name || null;
      }
      if (!hasPayment && !isPrePaymentInvoice) {
        await writeAudit(admin, "document.send_blocked_no_payment", doc.id, userId, {
          context_id: doc.context_id,
          payer_type: order?.payer_type ?? null,
        });
        return json(422, { error: "no_paid_payment" });
      }
      if (isPrePaymentInvoice) {
        await writeAudit(admin, "document.send_pre_payment_invoice", doc.id, userId, {
          context_id: doc.context_id,
          payer_type: order?.payer_type,
        });
      }
    }

    /** «Оплата по счёту №X от DD.MM.YYYY» — только для pre-payment invoice.
     *  Ту же строку возвращаем в JSON (payment_purpose), чтобы UI/Telegram/email
     *  использовали ОДИН источник, без расхождений в дате. */
    const paymentPurposeText: string | null = (() => {
      if (!isPrePaymentInvoice || !doc.document_number) return null;
      const d = orderCreatedAt ? new Date(orderCreatedAt) : new Date();
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = d.getFullYear();
      return `Оплата по счёту №${doc.document_number} от ${dd}.${mm}.${yy}`;
    })();


    // ---- Download PDF from storage -----------------------------------------
    const bucket = doc.storage_bucket || "documents";
    const { data: blob, error: dlErr } = await admin.storage
      .from(bucket)
      .download(doc.file_path);
    if (dlErr || !blob) {
      return json(500, { error: "file_download_failed", detail: dlErr?.message });
    }
    const pdfBytes = new Uint8Array(await blob.arrayBuffer());
    // PATCH-B: filename берём из ai_generated_documents.file_name; всегда .pdf
    // (email + Telegram отправляют только PDF). Кириллица допустима — MIME header
    // RFC 2047 в send-email; Telegram sendDocument multipart принимает UTF-8.
    const baseName = (doc.file_name || `${doc.document_number || "document"}.pdf`).replace(/\.docx$/i, "");
    const filename = baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;

    // ---- Send Email ---------------------------------------------------------
    const results: {
      email_sent: boolean;
      email_error: string | null;
      telegram_sent: boolean;
      telegram_error: string | null;
    } = {
      email_sent: false,
      email_error: null,
      telegram_sent: false,
      telegram_error: null,
    };

    if (body.send_email) {
      const recipientEmail =
        body.to_email?.trim() || docProfile?.email?.trim() || null;
      if (!recipientEmail) {
        results.email_error = "no_recipient_email";
      } else {
        try {
          // Заголовок письма = имя файла без .pdf (например
          // «Счет-акт- АЖУР инкам - АЖУР инкам № 0407/4 от 04.07.2026»).
          const displayTitle = filename.replace(/\.pdf$/i, "");
          const subj = displayTitle;

          const greetingName = docProfile?.full_name?.trim();
          const greeting = greetingName
            ? `Здравствуйте, ${escapeHtml(greetingName)}!`
            : "Здравствуйте!";

          const productLine = orderInfo.product_name
            ? `Продукт: <b>${escapeHtml(orderInfo.product_name)}</b>${
                orderInfo.tariff_name ? ` · тариф «${escapeHtml(orderInfo.tariff_name)}»` : ""
              }`
            : null;
          const amountLine =
            orderInfo.final_price != null
              ? `Сумма к оплате: <b>${formatAmount(orderInfo.final_price)} ${escapeHtml(orderInfo.currency || "BYN")}</b>`
              : null;
          const numberLine = doc.document_number
            ? `Номер счёта: <b>${escapeHtml(doc.document_number)}</b>`
            : null;

          const sections: BrandedEmailSection[] = [
            {
              paragraphs: [
                "Счёт сформирован и прикреплён к письму в формате PDF. Оплатить его можно любым удобным способом через ваш банк.",
              ],
            },
          ];
          const summaryParas = [numberLine, productLine, amountLine].filter(Boolean) as string[];
          if (summaryParas.length) {
            sections.push({ heading: "Детали счёта", paragraphs: summaryParas });
          }
          if (paymentPurposeText) {
            sections.push({
              callout: {
                label: "При оплате укажите назначение платежа",
                text: escapeHtml(paymentPurposeText),
                note: "Скопируйте эту строку в поле «Назначение платежа» вашего банка — так платёж будет автоматически сопоставлен со счётом.",
              },
            });
          }

          const html = renderBrandedEmail({
            preheader: paymentPurposeText
              ? escapeHtml(paymentPurposeText)
              : escapeHtml(displayTitle),
            title: escapeHtml(displayTitle),
            greeting,
            sections,
            signature:
              "С уважением,<br/>команда Gorbova Club<br/><span style=\"color:#94a3b8\">Это письмо отправлено автоматически. Если у вас есть вопросы — просто ответьте на него.</span>",
          });

          const textParts = [
            displayTitle,
            greetingName ? `Здравствуйте, ${greetingName}!` : "Здравствуйте!",
            "Счёт сформирован и прикреплён во вложении (PDF).",
          ];
          if (doc.document_number) textParts.push(`Номер счёта: ${doc.document_number}`);
          if (orderInfo.product_name) {
            textParts.push(
              `Продукт: ${orderInfo.product_name}${orderInfo.tariff_name ? ` — тариф «${orderInfo.tariff_name}»` : ""}`,
            );
          }
          if (orderInfo.final_price != null) {
            textParts.push(`Сумма: ${formatAmount(orderInfo.final_price)} ${orderInfo.currency || "BYN"}`);
          }
          if (paymentPurposeText) {
            textParts.push("");
            textParts.push("При оплате в назначении платежа укажите:");
            textParts.push(paymentPurposeText);
          }
          const text = textParts.join("\n");

          const base64Pdf = uint8ToBase64(pdfBytes);
          const { error: emailErr } = await admin.functions.invoke("send-email", {
            body: {
              to: recipientEmail,
              subject: subj,
              html,
              text,
              attachments: [
                {
                  filename,
                  content_base64: base64Pdf,
                  mime: "application/pdf",
                },
              ],
              context: {
                profile_id: doc.profile_id,
                event_type: "document_sent",
                meta: { document_id: doc.id, document_number: doc.document_number },
              },
            },
          });
          if (emailErr) {
            results.email_error = emailErr.message || "email_send_failed";
          } else {
            results.email_sent = true;
            await admin
              .from("ai_generated_documents")
              .update({
                meta: {
                  ...(doc.meta || {}),
                  sent_to_email: recipientEmail,
                  sent_at: new Date().toISOString(),
                },
              })
              .eq("id", doc.id);
          }
        } catch (e) {
          results.email_error = e instanceof Error ? e.message : "email_exception";
        }
      }
      await writeAudit(
        admin,
        results.email_sent ? "document.sent.email" : "document.send_failed",
        doc.id,
        userId,
        { channel: "email", error: results.email_error },
      );
    }


    // ---- Send Telegram ------------------------------------------------------
    if (body.send_telegram) {
      const chatId = docProfile?.telegram_user_id;
      if (!chatId) {
        results.telegram_error = "telegram_not_linked";
      } else {
        try {
          const botToken = await tgGetBotToken(admin);
          if (!botToken) {
            results.telegram_error = "bot_not_configured";
          } else {
            const captionTitle = escapeHtml(filename.replace(/\.pdf$/i, ""));
            const captionLines: string[] = [`📄 <b>${captionTitle}</b>`];
            if (orderInfo.product_name) {
              captionLines.push(
                `Продукт: ${escapeHtml(orderInfo.product_name)}${orderInfo.tariff_name ? ` · ${escapeHtml(orderInfo.tariff_name)}` : ""}`,
              );
            }
            if (orderInfo.final_price != null) {
              captionLines.push(
                `Сумма: <b>${formatAmount(orderInfo.final_price)} ${escapeHtml(orderInfo.currency || "BYN")}</b>`,
              );
            }
            if (paymentPurposeText) {
              captionLines.push("");
              captionLines.push("<b>При оплате укажите назначение платежа:</b>");
              captionLines.push(`<code>${escapeHtml(paymentPurposeText)}</code>`);
            }
            const caption = captionLines.join("\n");

            const r = await tgSendDocument(botToken, chatId, pdfBytes, filename, caption);
            if (!r.ok) {
              results.telegram_error = r.error || "telegram_send_failed";
            } else {
              results.telegram_sent = true;
              await admin
                .from("ai_generated_documents")
                .update({
                  meta: {
                    ...(doc.meta || {}),
                    sent_to_telegram: String(chatId),
                    sent_at: new Date().toISOString(),
                  },
                })
                .eq("id", doc.id);
            }
          }
        } catch (e) {
          results.telegram_error = e instanceof Error ? e.message : "telegram_exception";
        }
      }
      await writeAudit(
        admin,
        results.telegram_sent ? "document.sent.telegram" : "document.send_failed",
        doc.id,
        userId,
        { channel: "telegram", error: results.telegram_error },
      );
    }

    return json(200, {
      success: results.email_sent || results.telegram_sent,
      results,
      document_id: doc.id,
      document_number: doc.document_number,
      payment_purpose: paymentPurposeText,
    });

  } catch (e) {
    console.error("[canonical-document-send] fatal", e);
    return json(500, { error: "internal_error", detail: e instanceof Error ? e.message : String(e) });
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAmount(v: number | string): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function uint8ToBase64(bytes: Uint8Array): string {
  // chunk-friendly conversion (avoid stack overflows on large PDFs)
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

