import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ManyChatPage {
  id: string;
  name: string;
  username?: string;
  is_pro?: boolean;
  timezone?: string;
}

interface Props {
  /** Текущий api_key из формы (может быть пустым в edit-flow при PATCH-MIT). */
  apiKey: string;
  /** Существующий instance_id (только в edit-flow). */
  instanceId?: string;
  /** Текущий выбранный page_id (из formData.manychat_page_id). */
  currentPageId: string;
  /** Текущее закешированное имя страницы (formData.manychat_page_name). */
  currentPageName: string;
  /** Колбек на изменение page_id + page_name. */
  onChange: (pageId: string, pageName: string) => void;
  /** Лейбл основного поля. */
  label: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; pages: ManyChatPage[] }
  | { kind: "invalid_key" }
  | { kind: "fallback"; reason: string };

export function ManyChatPageSelector({
  apiKey,
  instanceId,
  currentPageId,
  currentPageName,
  onChange,
  label,
}: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const canDiscover = apiKey.trim().length > 0 || Boolean(instanceId);

  const runDiscover = async () => {
    setState({ kind: "loading" });
    try {
      const body: Record<string, string> = {};
      if (apiKey.trim()) body.api_key = apiKey.trim();
      else if (instanceId) body.instance_id = instanceId;

      const { data, error } = await supabase.functions.invoke(
        "manychat-discover-pages",
        { body },
      );

      if (error) {
        setState({ kind: "fallback", reason: error.message || "network_error" });
        return;
      }

      const res = data as
        | { success: true; pages: ManyChatPage[] }
        | { success: false; error_code: string; error_message: string };

      if (res.success === false) {
        if (res.error_code === "invalid_api_key") {
          setState({ kind: "invalid_key" });
        } else {
          // network_error / non_json / unexpected_response / timeout / прочее
          setState({ kind: "fallback", reason: res.error_message });
        }
        return;
      }

      // success
      if (res.pages.length === 1) {
        const p = res.pages[0];
        onChange(p.id, p.name);
      }
      setState({ kind: "ok", pages: res.pages });
    } catch (e) {
      const err = e as Error;
      setState({ kind: "fallback", reason: err.message });
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {/* Текущая выбранная страница (если есть) */}
      {currentPageId && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">
              {currentPageName || "Страница ManyChat"}
            </div>
            <div className="text-xs text-muted-foreground font-mono truncate">
              ID: {currentPageId}
            </div>
          </div>
        </div>
      )}

      {/* Кнопка discover */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canDiscover || state.kind === "loading"}
          onClick={runDiscover}
        >
          {state.kind === "loading" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : currentPageId ? (
            <RefreshCw className="h-4 w-4 mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {currentPageId ? "Перепроверить страницу" : "Получить страницу"}
        </Button>
      </div>

      {!canDiscover && (
        <p className="text-xs text-muted-foreground">
          Сначала введите API Key выше.
        </p>
      )}

      {/* Множественный выбор (теоретический случай) */}
      {state.kind === "ok" && state.pages.length > 1 && (
        <Select
          value={currentPageId}
          onValueChange={(value) => {
            const p = state.pages.find((x) => x.id === value);
            if (p) onChange(p.id, p.name);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Выберите страницу..." />
          </SelectTrigger>
          <SelectContent>
            {state.pages.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  {p.name}
                  {p.is_pro && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      PRO
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">
                    {p.id}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Single page success — показываем подтверждение */}
      {state.kind === "ok" && state.pages.length === 1 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-primary" />
          Страница получена автоматически
          {state.pages[0].is_pro && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
              PRO
            </Badge>
          )}
        </p>
      )}

      {/* Invalid API key — никакого fallback на ручной ввод */}
      {state.kind === "invalid_key" && (
        <p
          className={cn(
            "text-xs flex items-center gap-1 text-destructive",
          )}
        >
          <AlertCircle className="h-3 w-3" />
          Неверный API Key. Проверьте значение и повторите.
        </p>
      )}

      {/* Network/non_json — fallback на ручной ввод page_id */}
      {state.kind === "fallback" && (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs flex items-start gap-1 text-destructive">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Не удалось автоматически получить страницу: {state.reason}.
              Введите Page ID вручную (debug mode).
            </span>
          </p>
          <Input
            placeholder="ID Facebook Page в ManyChat"
            value={currentPageId}
            onChange={(e) => onChange(e.target.value, currentPageName)}
          />
        </div>
      )}
    </div>
  );
}
