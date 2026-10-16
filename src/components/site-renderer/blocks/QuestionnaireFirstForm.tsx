import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { trackQuestionnaireJourney, prepareQuestionnaireJourneyForEmail, type QuestionnaireJourney } from "@/lib/siteQuestionnaireJourney";
import { questionnaireThankYouUrl } from "@/lib/questionnaireThankYouUrl";
import { isValidPhoneNumber, PHONE_VALIDATION_MESSAGE } from "../../../../supabase/functions/site-form-submit/phone-validation";
import { isQuestionnaireContactField } from "../../../../supabase/functions/site-form-submit/questionnaire-contacts";

interface Field { label: string; type: string; required: boolean; mapping?: string }
interface Props {
  content: Record<string, unknown>;
  pageId?: string;
  blockId?: string;
  isPreview?: boolean;
  initialContactValues?: Record<string, string>;
}

/** Explicitly enabled on a published form; the existing login-first forms stay unchanged. */
export function QuestionnaireFirstForm({ content, pageId, blockId, isPreview, initialContactValues }: Props) {
  const fields = (content.fields as Field[]) || [];
  const contactFirst = content.contact_first === true;
  const registrationOnly = content.webinar_registration === true;
  const { user, loading: authLoading } = useAuth();
  const verifiedSession = !!user?.email_confirmed_at;
  const otp = useInlineEmailOtp();
  const schema = JSON.stringify(fields.map(f => [f.label, f.type, f.mapping, f.required]));
  const key = questionnaireDraftKey(pageId || "preview", blockId || "preview");
  const [initial] = useState(() => {
    if (isPreview) return null;
    try { return readQuestionnaireDraft(window.localStorage, key, schema, fields.length); } catch { return null; }
  });
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seeded = { ...initial?.answers };
    fields.forEach((field, i) => {
      const value = initialContactValues?.[field.mapping || ""];
      if (registrationOnly && typeof value === "string" && value.trim()) seeded[String(i)] = value.trim();
    });
    return seeded;
  });
  const [visitId] = useState(() => crypto.randomUUID());
  const journeyRequest = useRef<Promise<QuestionnaireJourney | null> | null>(null);
  useEffect(() => {
    if (isPreview || !pageId) return;
    journeyRequest.current = trackQuestionnaireJourney(pageId, visitId, window.location.search);
  }, [isPreview, pageId, visitId]);
  const [submissionKey] = useState(() => initial?.submissionKey || crypto.randomUUID());
  const [source] = useState(() => initial?.source || parseQuestionnaireSource(new URLSearchParams(window.location.search).get("src")));
  const [step, setStep] = useState<"contacts" | "answers" | "otp" | "telegram" | "success">(contactFirst ? "contacts" : "answers");
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const working = useRef(false);
  const submitted = useRef(false);
  const contactFields = fields.map((field, i) => ({ field, i })).filter(({ field }) => isQuestionnaireContactField(field));
  const profile = useQuery({
    queryKey: ["questionnaire-own-contact", user?.id], enabled: contactFirst && verifiedSession && !isPreview,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("full_name,first_name,last_name,phone,instagram_url").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!contactFirst || !verifiedSession || !user?.email || step !== "contacts") return;
    const draftEmailIndex = fields.findIndex(field => field.type === "email" || field.mapping === "email");
    const draftEmail = initial?.answers[String(draftEmailIndex)]?.trim().toLowerCase();
    if (draftEmail && draftEmail !== user.email.toLowerCase()) return; // Never mix another account's draft with this profile.
    const own = profile.data;
    const values: Record<string, string> = { email: user.email, full_name: own?.full_name || [own?.first_name, own?.last_name].filter(Boolean).join(" "),
      first_name: own?.first_name || "", last_name: own?.last_name || "", phone: own?.phone || "", instagram: own?.instagram_url || "", instagram_url: own?.instagram_url || "" };
    setAnswers(previous => {
      const next = { ...previous };
      fields.forEach((field, i) => {
        const mapping = field.mapping || (field.type === "email" ? "email" : field.type === "phone" ? "phone" : "");
        if (!next[String(i)] && values[mapping]) next[String(i)] = values[mapping];
      });
      return Object.keys(next).some(index => next[index] !== previous[index]) ? next : previous;
    });
  }, [contactFirst, verifiedSession, user?.id, user?.email, profile.data, step, schema, initial]);

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

  function validate(indexes = fields.map((_, i) => i)) {
    if (!privacyConsent && !isPreview) {
      setError("Подтвердите согласие на обработку персональных данных.");
      return false;
    }
    for (const i of indexes) {
      if (fields[i].required && !(answers[String(i)] || "").trim()) {
        setError(`Заполните поле «${fields[i].label}».`);
        return false;
      }
      if ((fields[i].type === "phone" || fields[i].mapping === "phone") &&
          answers[String(i)]?.trim() && !isValidPhoneNumber(answers[String(i)])) {
        setError(PHONE_VALIDATION_MESSAGE);
        return false;
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Введите корректный email.");
      return false;
    }
    return true;
  }

  async function saveContact() {
    if (!pageId || !blockId) throw new Error("missing_form_config");
    const journey = await journeyRequest.current;
    const { data, error } = await supabase.functions.invoke("site-form-submit", { body: {
      action: "questionnaire_contact", page_id: pageId, block_id: blockId, submission_key: submissionKey,
      source_code: source, ...(journey || {}), privacy_consent: { accepted: privacyConsent, version: CONSENT_POLICY_VERSION },
      fields: contactFields.map(({ field, i }) => ({ label: field.label, type: field.type, mapping: field.mapping || "none", value: (answers[String(i)] || "").trim() })),
    } });
    if (error || data?.success !== true) throw new Error("contact_save_failed");
  }

  const onTelegramLinked = useCallback((linked: boolean) => {
    setTelegramLinked(linked);
    if (contactFirst && linked && !registrationOnly) setStep("answers");
  }, [contactFirst, registrationOnly]);

  async function submit() {
    if (submitted.current) return;
    if (isPreview) { setStep("success"); return; }
    if (!pageId || !blockId) throw new Error("missing_form_config");
    const journey = await journeyRequest.current;
    const { data, error: submitError } = await supabase.functions.invoke("site-form-submit", {
      body: {
        ...(registrationOnly ? { action: "webinar_registration" } : {}),
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
    if (working.current || authLoading || !validate(step === "contacts" ? contactFields.map(({ i }) => i) : undefined)) return;
    setError("");
    if (isPreview) { setStep(!registrationOnly && contactFirst && step === "contacts" ? "answers" : "success"); return; }
    working.current = true; setBusy(true);
    try {
      // Do not attach a questionnaire for a different email to an already-open account.
      if (user && user.email?.toLowerCase() !== email) {
        setError("Укажите email аккаунта, в который вы вошли. Для другого email выйдите из аккаунта; черновик сохранится.");
        return;
      }
      if (pageId) {
        journeyRequest.current = prepareQuestionnaireJourneyForEmail(pageId, visitId, window.location.search, email, journeyRequest.current);
      }
      if (contactFirst && step === "answers") { await submit(); return; }
      if (user && (!contactFirst || verifiedSession)) {
        if (contactFirst) await saveContact();
        setStep("telegram");
      } else if (await otp.requestQuestionnaireCode(email, `site-questionnaire:${pageId}:${blockId}`, await journeyRequest.current)) {
        setStep("otp");
      }
    } catch { setError("Не удалось сохранить анкету. Ответы сохранены в черновике, попробуйте ещё раз."); }
    finally { working.current = false; setBusy(false); }
  }

  async function verifyAndSubmit() {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (await otp.verifyCode(code)) {
        if (contactFirst) await saveContact();
        setStep("telegram");
      }
    } catch {
      setStep(contactFirst ? "contacts" : "answers");
      setError(contactFirst ? "Почта подтверждена, но контакты не удалось сохранить. Нажмите «Продолжить» ещё раз — введённые данные сохранены." : "Почта подтверждена, но анкету не удалось сохранить. Нажмите «Отправить анкету» ещё раз — ответы сохранены.");
    } finally { working.current = false; setBusy(false); }
  }

  const pending = busy || otp.isSending || otp.isVerifying || !!authLoading;
  return (
    <section className={`questionnaire-form py-8 px-4${registrationOnly ? " webinar-registration-form" : ""}`}>
      <div className="max-w-2xl mx-auto space-y-6">
        {typeof content.title === "string" && content.title && <SafeHtml html={content.title} as="h2" className="text-2xl font-bold" />}
        {typeof content.subtitle === "string" && content.subtitle && <SafeHtml html={content.subtitle} as="p" />}
        {step === "success" ? (
          <div className="space-y-4">
            <div role="status"><h2 className="text-xl font-semibold">{registrationOnly ? "Вы зарегистрированы на вебинар" : "Анкета сохранена"}</h2><p>{registrationOnly ? "Ссылка на участие будет отправлена на почту и в support-бот." : "Спасибо за ваши ответы."}</p></div>
          </div>
        ) : step === "telegram" ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Подключите Telegram</h2>
            <p>{registrationOnly ? "Контакты сохранены. Подключите support-бота, чтобы получить ссылку на вебинар. Ник Telegram не нужен." : contactFirst ? "Контакты сохранены. Подключите support-бота и продолжайте заполнение анкеты. Ник Telegram не нужен." : "Почта подтверждена. Подключите support-бота, чтобы мы могли общаться с вами лично. Ответы сохранены в черновике."}</p>
            {pageId && <QuestionnaireTelegramStep pageId={pageId} onLinkedChange={onTelegramLinked} />}
            {(!contactFirst || registrationOnly) && <Button type="button" className="w-full" disabled={pending || !telegramLinked} onClick={() => {
              if (working.current || !telegramLinked) return;
              working.current = true; setBusy(true); setError("");
              void submit().catch(() => setError(registrationOnly ? "Не удалось завершить регистрацию. Проверьте подключение бота и попробуйте ещё раз." : "Не удалось сохранить анкету. Проверьте подключение бота и попробуйте ещё раз — ответы сохранены."))
                .finally(() => { working.current = false; setBusy(false); });
            }}>{registrationOnly ? "Завершить регистрацию" : "Сохранить анкету и получить бонусы"}</Button>}
          </div>
        ) : step === "otp" ? (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); void verifyAndSubmit(); }}>
            <h2 className="text-xl font-semibold">Подтвердите почту</h2>
            <p>Отправили шестизначный код на {otp.email}. Введите его здесь — переходить по ссылкам не нужно.</p>
            <p className="text-sm text-muted-foreground">{contactFirst ? "После подтверждения сохраним контакты и проверим подключение support-бота. Пароль создавать не нужно." : "Ваши ответы сохранены. После подтверждения проверим подключение support-бота."}</p>
            <Label htmlFor={`questionnaire-code-${blockId}`}>Код из письма</Label>
            <Input id={`questionnaire-code-${blockId}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} disabled={pending} />
            <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Подтвердить почту</Button>
            <Button type="button" variant="outline" className="w-full" disabled={pending || otp.resendIn > 0} onClick={() => { void otp.resend(); }}>{otp.resendIn > 0 ? `Повторить через ${otp.resendIn} с` : "Отправить код ещё раз"}</Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => { otp.changeEmail(); setCode(""); setStep(contactFirst ? "contacts" : "answers"); }}>Изменить email или ответы</Button>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={e => { e.preventDefault(); void sendAnswers(); }}>
            {contactFirst && <div className="space-y-2"><h2 className="text-xl font-semibold">{step === "contacts" ? "Ваши контакты" : "Анкета предзаписи"}</h2>
              <p>{step === "contacts" ? user ? "Проверьте ваши контактные данные и продолжайте." : "Укажите контакты. Затем подтвердите почту кодом здесь же — без пароля." : "Контакты сохранены. Ответьте на вопросы и получите бонусы."}</p>
              {step === "contacts" && profile.isError && <p role="alert">Не удалось подставить данные карточки. Заполните их вручную или <button type="button" className="underline" onClick={() => { void profile.refetch(); }}>повторите загрузку</button>.</p>}
            </div>}
            {fields.map((field, i) => ({ field, i })).filter(({ field }) => !contactFirst || (step === "contacts" ? isQuestionnaireContactField(field) : !isQuestionnaireContactField(field))).map(({ field, i }) => {
              const id = `questionnaire-${blockId}-${i}`;
              return <div className="space-y-2" key={id}>
                <Label htmlFor={id} className="leading-relaxed">{field.label}{field.required ? "*" : ""}</Label>
                {field.type === "phone" && <p className="text-sm text-muted-foreground">С кодом страны, например +375291234567.</p>}
                {field.type === "textarea" ? <Textarea id={id} value={answers[String(i)] || ""} rows={4} maxLength={10_000} required={field.required} disabled={pending} onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))} />
                  : <Input id={id} autoComplete={!registrationOnly ? undefined : field.mapping === "first_name" ? "given-name" : field.mapping === "last_name" ? "family-name" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : undefined} type={field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text"} value={answers[String(i)] || ""} maxLength={1000} required={field.required} disabled={pending} onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))} />}
              </div>;
            })}
            {draftSaved && <p className="text-sm text-muted-foreground" role="status">Черновик сохранён на этом устройстве. Можно вернуться к заполнению в течение 7 дней.</p>}
            {(!contactFirst || step === "contacts") && <div className="flex items-start gap-2 text-sm">
              <input id={`questionnaire-consent-${blockId}`} type="checkbox" checked={privacyConsent} disabled={pending} onChange={e => setPrivacyConsent(e.target.checked)} className="mt-1" />
              <label htmlFor={`questionnaire-consent-${blockId}`}>Я согласен с <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">политикой конфиденциальности</a> и даю <a href="/consent" target="_blank" rel="noopener noreferrer" className="underline">согласие на обработку персональных данных</a>.</label>
            </div>}
            <Button type="submit" className="w-full" disabled={pending || (contactFirst && step === "contacts" && !!user && profile.isLoading)}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{contactFirst && step === "contacts" ? "Продолжить" : <SafeHtml html={typeof content.buttonText === "string" ? content.buttonText : "Отправить анкету"} />}</Button>
          </form>
        )}
        {(error || otp.error) && <p role="alert" className="text-sm text-destructive">{error || otp.error}</p>}
      </div>
    </section>
  );
}
