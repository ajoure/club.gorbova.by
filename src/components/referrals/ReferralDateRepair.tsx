import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ReferralDateRepair() {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const running = useRef(false);
  async function run(dry: boolean) {
    if (running.current || (!dry && (preview !== text || submitted))) return;
    running.current = true; setBusy(true); setPreview("");
    let sent = false;
    try {
      const body = JSON.parse(text);
      if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Некорректный пакет");
      // Lock apply before dispatch, including uncertain network outcomes. Never retry automatically.
      if (!dry) setSubmitted(true);
      sent = true;
      const { data, error } = await supabase.functions.invoke("referral-sale-date-repair", { body: { ...body, p_dry_run: dry } });
      if (error) throw new Error("Ответ операции не подтверждён. Проверьте журнал и начисления перед повтором.");
      setResult(JSON.stringify(data, null, 2));
      if (dry && data?.result?.dry_run === true && data.result.no_writes === true) setPreview(text);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Ошибка проверки");
      if (!dry && sent) setSubmitted(true);
    } finally { running.current = false; setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border p-4">
    <h3 className="font-medium">Исправление дат исторических начислений</h3>
    <p className="text-sm text-muted-foreground">Проверьте согласованный пакет исправлений. Старые даты сохраняются в журнале; сначала выполняется проверка без записи.</p>
    <Textarea aria-label="Пакет исправления дат" value={text} disabled={busy || submitted} onChange={e => {setText(e.target.value); setPreview("");}} className="min-h-40" />
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || submitted || !text.trim()} onClick={() => run(true)}>Проверить без записи</Button>
      <Button disabled={busy || submitted || preview !== text || !preview} onClick={() => run(false)}>Применить проверенные изменения</Button>
    </div>
    {submitted && <p role="status" className="text-sm">Применение отправлено. Повтор заблокирован; проверьте результат в журнале.</p>}
    {result && <pre role="status" className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{result}</pre>}
  </section>;
}
