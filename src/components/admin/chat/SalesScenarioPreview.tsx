import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const scenarios = [
  ["new_client", "Новый клиент"],
  ["graduate", "Выпускник"],
  ["club_consultation", "Вопрос о клубе"],
] as const;

type Preview = {
  ok: boolean;
  steps?: Array<{ incoming: string; expected: string; actual: string; pass: boolean; candidate?: { text?: string } }>;
  error?: string;
};

export function SalesScenarioPreview() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function run(scenario: string) {
    setBusy(true);
    setSelected(scenario);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("sales-runtime-worker", {
        body: { action: "preview_scenario", scenario },
      });
      if (error || !data || data.error) {
        setResult({ ok: false, error: data?.error || "Проверка недоступна" });
      } else {
        setResult(data as Preview);
      }
    } catch {
      setResult({ ok: false, error: "Проверка недоступна" });
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-2 border-t pt-2" data-testid="sales-scenario-preview">
    <p className="text-xs font-medium">Проверка диалога без отправки клиенту</p>
    <p className="text-xs text-muted-foreground">Только вымышленные клиенты. Проверка обращается к текущей модели и читает публичные условия продукта; кампания остаётся выключенной.</p>
    <div className="flex flex-wrap gap-2">
      {scenarios.map(([code, label]) => <Button key={code} size="sm" variant="outline" disabled={busy} onClick={() => run(code)}>{label}</Button>)}
    </div>
    {busy && <p role="status" className="text-xs">Проверяем сценарий…</p>}
    {result && <div role="status" className="space-y-2 text-xs" aria-live="polite">
      <p>{selected}: {result.ok ? "Все шаги прошли" : `Проверка не прошла${result.error ? `: ${result.error}` : ""}`}</p>
      {result.steps?.map((step, index) => <div key={index} className="rounded border p-2 space-y-1 break-words">
        <p>{index + 1}. Клиент: {step.incoming}</p>
        <p>Ответ: {step.candidate?.text || step.actual}</p>
        <p className={step.pass ? "text-muted-foreground" : "text-destructive"}>{step.pass ? "Шаг пройден" : `Ожидалось: ${step.expected}; получено: ${step.actual}`}</p>
      </div>)}
    </div>}
  </div>;
}
