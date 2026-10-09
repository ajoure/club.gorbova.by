import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInlineEmailOtp } from "@/hooks/useInlineEmailOtp";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { clearQuestionnaireDraft, questionnaireDraftKey, readQuestionnaireDraft, saveQuestionnaireDraft } from "@/lib/siteQuestionnaireDraft";
import { parseQuestionnaireSource } from "../../../../supabase/functions/site-form-submit/questionnaire-source";
import { CONSENT_POLICY_VERSION } from "@/lib/legalVersions";
import { QuestionnaireTelegramStep } from "./QuestionnaireTelegramStep";
import { SafeHtml } from "@/components/ui/SafeHtml";
import { trackQuestionnaireJourney, type QuestionnaireJourney } from "@/lib/siteQuestionnaireJourney";
import { questionnaireThankYouUrl } from "@/lib/questionnaireThankYouUrl";

interface Field { label: string; type: string; required: boolean; mapping?: string }
interface Props {
  content: Record<string, unknown>;
  pageId?: string;
  blockId?: string;
  isPreview?: boolean;
}

/** Explicitly enabled on a published form; the existing login-first forms stay unchanged. */
export function QuestionnaireFirstForm({ content, pageId, blockId, isPreview }: Props) {
  const fields = (content.fields as Field[]) || [];
  const { user } = useAuth();
  const otp = useInlineEmailOtp();
  const schema = JSON.stringify(fields.map(f => [f.label, f.type, f.mapping, f.required]));
  const key = questionnaireDraftKey(pageId || "preview", blockId || "preview");
  const [initial] = useState(() => {
    if (isPreview) return null;
    try { return readQuestionnaireDraft(window.localStorage, key, schema, fields.length); } catch { return null; }
  });
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers || {});
  const [visitId] = useState(() => crypto.randomUUID());
  const journeyRequest = useRef<Promise<QuestionnaireJourney | null> | null>(null);
  useEffect(() => {
    if (isPreview || !pageId) return;
    journeyRequest.current = trackQuestionnaireJourney(pageId, visitId, window.location.search);
  }, [isPreview, pageId, visitId]);
  const [submissionKey] = useState(() => initial?.submissionKey || crypto.randomUUID());
  const [source] = useState(() => initial?.source || parseQuestionnaireSource(new URLSearchParams(window.location.search).get("src")));
  const [step, setStep] = useState<"answers" | "otp" | "telegram" | "success">("answers");
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const working = useRef(false);
  const submitted = useRef(false);

  useEffect(() => {
    if (isPreview || submitted.current) return;
    try {
      setDraftSaved(saveQuestionnaireDraft(window.localStorage, key, {
        version: 1, schema, savedAt: Date.now(), submissionKey, source, answers,
      }));
    } catch { setDraftSaved(false); }
  }, [answers, isPreview, key, schema, source, submissionKey]);

  const emailIndex = fields.findIndex(f => f.mapping === "email" || f.type === "email");
  const email = (answers[String(emailIndex)] || "").trim().toLowerCase();

  function validate() {
    if (!privacyConsent && !isPreview) {
      setError("Подтвердите согласие на обработку персональных данных.");
      return false;
    }
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].required && !(answers[String(i)] || "").trim()) {
        setError(`Заполните поле «${fields[i].label}».`);
        return false;
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Введите корректный email.");
      return false;
    }
    return true;
  }

  async function submit() {
    if (submitted.current) return;
    if (isPreview) { setStep("success"); return; }
    if (!pageId || !blockId) throw new Error("missing_form_config");
    const journey = await journeyRequest.current;
    const { data, error: submitError } = await supabase.functions.invoke("site-form-submit", {
      body: {
        page_id: pageId, block_id: blockId, submission_key: submissionKey,
        source_code: source, ...(journey || {}),
        privacy_consent: { accepted: privacyConsent, version: CONSENT_POLICY_VERSION },
        fields: fields.map((f, i) => ({ label: f.label, type: f.type, mapping: f.mapping || "none", value: (answers[String(i)] || "").trim() })),
      },
    });
    if (submitError || !data?.success) throw new Error("submission_failed");
    submitted.current = true;
    try { clearQuestionnaireDraft(window.localStorage, key); } catch { /* Storage may be disabled. */ }
    setStep("success");
    const thankYouUrl = questionnaireThankYouUrl(content.redirectUrl, window.location.origin);
    if (thankYouUrl && thankYouUrl !== window.location.pathname + window.location.search + window.location.hash) window.location.assign(thankYouUrl);
  }

  async function sendAnswers() {
    if (working.current || !validate()) return;
    setError("");
    if (isPreview) { setStep("success"); return; }
    working.current = true; setBusy(true);
    try {
      // Do not attach a questionnaire for a different email to an already-open account.
      if (user) {
        if (user.email?.toLowerCase() !== email) {
          setError("Укажите email аккаунта, в который вы вошли. Для другого email выйдите из аккаунта; черновик сохранится.");
          return;
        }
        setStep("telegram");
      } else if (await otp.requestQuestionnaireCode(email, `site-questionnaire:${pageId}:${blockId}`)) {
        setStep("otp");
      }
    } catch { setError("Не удалось сохранить анкету. Ответы сохранены в черновике, попробуйте ещё раз."); }
    finally { working.current = false; setBusy(false); }
  }

  async function verifyAndSubmit() {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (await otp.verifyCode(code)) setStep("telegram");
    } catch {
      setStep("answers");
      setError("Почта подтверждена, но анкету не удалось сохранить. Нажмите «Отправить анкету» ещё раз — ответы сохранены.");
    } finally { working.current = false; setBusy(false); }
  }

  const pending = busy || otp.isSending || otp.isVerifying;
  return (
    <section className="py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {typeof content.title === "string" && content.title && <SafeHtml html={content.title} as="h2" className="text-2xl font-bold" />}
        {typeof content.subtitle === "string" && content.subtitle && <SafeHtml html={content.subtitle} as="p" />}
        {step === "success" ? (
          <div className="space-y-4">
            <div role="status"><h2 className="text-xl font-semibold">Анкета сохранена</h2><p>Спасибо за ваши ответы.</p></div>
          </div>
        ) : step === "telegram" ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Подключите Telegram</h2>
            <p>Почта подтверждена. Подключите support-бота, чтобы мы могли общаться с вами лично. Ответы сохранены в черновике.</p>
            {pageId && <QuestionnaireTelegramStep pageId={pageId} onLinkedChange={setTelegramLinked} />}
            <Button type="button" className="w-full" disabled={pending || !telegramLinked} onClick={() => {
              if (working.current || !telegramLinked) return;
              working.current = true; setBusy(true); setError("");
              void submit().catch(() => setError("Не удалось сохранить анкету. Проверьте подключение бота и попробуйте ещё раз — ответы сохранены."))
                .finally(() => { working.current = false; setBusy(false); });
            }}>Сохранить анкету и получить бонусы</Button>
          </div>
        ) : step === "otp" ? (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); void verifyAndSubmit(); }}>
            <h2 className="text-xl font-semibold">Подтвердите почту</h2>
            <p>Отправили шестизначный код на {otp.email}. Введите его здесь — переходить по ссылкам не нужно.</p>
            <p className="text-sm text-muted-foreground">Ваши ответы сохранены. После подтверждения проверим подключение support-бота.</p>
            <Label htmlFor={`questionnaire-code-${blockId}`}>Код из письма</Label>
            <Input id={`questionnaire-code-${blockId}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} disabled={pending} />
            <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Подтвердить почту</Button>
            <Button type="button" variant="outline" className="w-full" disabled={pending || otp.resendIn > 0} onClick={() => { void otp.resend(); }}>{otp.resendIn > 0 ? `Повторить через ${otp.resendIn} с` : "Отправить код ещё раз"}</Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => { otp.changeEmail(); setCode(""); setStep("answers"); }}>Изменить email или ответы</Button>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={e => { e.preventDefault(); void sendAnswers(); }}>
            {fields.map((field, i) => {
              const id = `questionnaire-${blockId}-${i}`;
              return <div className="space-y-2" key={id}>
                <Label htmlFor={id} className="leading-relaxed">{field.label}{field.required ? "*" : ""}</Label>
                {field.type === "textarea" ? <Textarea id={id} value={answers[String(i)] || ""} rows={4} maxLength={10_000} required={field.required} disabled={pending} onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))} />
                  : <Input id={id} type={field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text"} value={answers[String(i)] || ""} maxLength={1000} required={field.required} disabled={pending} onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))} />}
              </div>;
            })}
            {draftSaved && <p className="text-sm text-muted-foreground" role="status">Черновик сохранён на этом устройстве. Можно вернуться к заполнению в течение 7 дней.</p>}
            <div className="flex items-start gap-2 text-sm">
              <input id={`questionnaire-consent-${blockId}`} type="checkbox" checked={privacyConsent} disabled={pending} onChange={e => setPrivacyConsent(e.target.checked)} className="mt-1" />
              <label htmlFor={`questionnaire-consent-${blockId}`}>Я согласен с <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">политикой конфиденциальности</a> и даю <a href="/consent" target="_blank" rel="noopener noreferrer" className="underline">согласие на обработку персональных данных</a>.</label>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<SafeHtml html={typeof content.buttonText === "string" ? content.buttonText : "Отправить анкету"} /></Button>
          </form>
        )}
        {(error || otp.error) && <p role="alert" className="text-sm text-destructive">{error || otp.error}</p>}
      </div>
    </section>
  );
}
