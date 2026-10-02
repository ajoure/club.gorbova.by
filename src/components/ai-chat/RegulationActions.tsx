import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Local edits are deliberately not presented as saved history. The conversation
 * remains the canonical version; a downloaded Word document contains the edits. */
export function RegulationActions({ content }: { content: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const { exportRegulation } = await import("@/utils/exportRegulation");
      await exportRegulation(draft);
    } catch {
      setError("Не удалось скачать Word. Повторите скачивание или скопируйте текст. Ваш проект остался в чате.");
    } finally { setBusy(false); }
  };
  return <div className="mt-2 space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>{editing ? "Скрыть редактор" : "Редактировать для Word"}</Button>
      <Button size="sm" disabled={busy || !draft.trim()} onClick={download}>{busy ? "Готовлю Word..." : "Скачать Word"}</Button>
    </div>
    {editing && <>
      <Textarea aria-label="Редактор проекта регламента" className="min-h-[240px] text-base sm:text-sm" value={draft} onChange={event => setDraft(event.target.value)} maxLength={30000} />
      <p className="text-xs text-muted-foreground">Эти правки попадут только в Word. Для сохранения новой версии в истории попросите ИИ внести правки в чате. Не закрывайте страницу до скачивания.</p>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
