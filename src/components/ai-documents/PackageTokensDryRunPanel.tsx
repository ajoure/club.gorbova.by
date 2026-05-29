/**
 * PackageTokensDryRunPanel — Sprint 3C dev-only.
 *
 * Collapsible dev-блок ВНУТРИ страницы пакета «Идеология».
 * Видим ТОЛЬКО для super_admin. Скрыт у обычных admin/editor/user.
 *
 * Вызывает edge-функцию `package-tokens-dry-run`, которая:
 *   • super_admin gated на сервере;
 *   • НЕ пишет в snapshot/ai_generated_documents/storage;
 *   • НЕ запускает генерацию документов;
 *   • пишет audit без значений токенов;
 *   • rate-limited (1 запрос / 5 секунд).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, PlayCircle, ShieldAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Badge } from "@/components/ui/badge";

// Sprint 3H: устаревшие alias-токены {{package.roles.<role>.*}} архивированы
// в БД (document_package_token_aliases.archived_at NOT NULL). Этот dev-блок
// сохранён для проверки legacy-резолвера: ожидаемый результат для всех 4 строк —
// resolved=false / code=alias_missing. Канонический токен роли пакета —
// {{ln-XXXXXX}}, его dry-run будет подключён вместе с edge-резолвером ln-ветки.
const KNOWN_ALIASES = [
  "package.roles.company_head.full_name",
  "package.roles.company_head.position",
  "package.roles.responsible_person.full_name",
  "package.roles.responsible_person.position",
];

interface DryRunResult {
  alias_token: string;
  resolved: boolean;
  value?: string;
  code?: string;
  warning?: string;
  alias_id?: string;
  canonical_field_public_id?: string;
  role_key?: string;
  context_kind?: string;
}

interface Props {
  packageSessionId: string | null;
}

export function PackageTokensDryRunPanel({ packageSessionId }: Props) {
  const { data: isSuperAdmin } = useSuperAdmin();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(KNOWN_ALIASES));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DryRunResult[] | null>(null);

  if (!isSuperAdmin) return null;

  const toggle = (token: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  };

  const run = async () => {
    if (!packageSessionId) {
      setError("Сначала сохраните анкету (нет package_session_id).");
      return;
    }
    if (selected.size === 0) {
      setError("Выберите хотя бы один токен.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        "package-tokens-dry-run",
        {
          body: {
            package_session_id: packageSessionId,
            alias_tokens: Array.from(selected),
          },
        },
      );
      if (invokeErr) throw invokeErr;
      if (!data || !data.ok) {
        throw new Error(data?.error ?? "dry_run_failed");
      }
      setResults(data.results as DryRunResult[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 border border-amber-300/60 rounded-lg bg-amber-50/40 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <ShieldAlert className="h-3.5 w-3.5" />
          Dev: Dry-run пакетных alias-токенов
          <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300">
            super_admin only
          </Badge>
        </span>
        <span className="text-[10px] opacity-70">no DB writes · no generation</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
            Прогоняет резолвер изолированно через <code>package-tokens-dry-run</code>.
            HARDCODED_ENABLED resolver-а остаётся <code>false</code>; production-генерация
            не задействована. Результат не сохраняется в snapshot.
          </p>

          <div className="space-y-1.5">
            {KNOWN_ALIASES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-[11px] cursor-pointer">
                <Checkbox
                  checked={selected.has(t)}
                  onCheckedChange={() => toggle(t)}
                  className="h-3.5 w-3.5"
                />
                <code>{t}</code>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={run}
              disabled={loading || !packageSessionId}
              className="h-7 text-[11px]"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <PlayCircle className="h-3 w-3 mr-1" />
              )}
              Прогнать
            </Button>
            {!packageSessionId && (
              <span className="text-[10px] text-muted-foreground">
                нет session_id — сохраните анкету
              </span>
            )}
          </div>

          {error && (
            <div className="text-[11px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1">
              {error}
            </div>
          )}

          {results && (
            <div className="border rounded bg-background">
              <table className="w-full text-[10px]">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">alias_token</th>
                    <th className="px-2 py-1 text-left font-medium">resolved</th>
                    <th className="px-2 py-1 text-left font-medium">value / code</th>
                    <th className="px-2 py-1 text-left font-medium">FLD</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.alias_token} className="border-t">
                      <td className="px-2 py-1 font-mono">{r.alias_token}</td>
                      <td className="px-2 py-1">
                        {r.resolved ? (
                          <span className="text-emerald-700">true</span>
                        ) : (
                          <span className="text-amber-700">false</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {r.resolved ? (
                          <span>{r.value}</span>
                        ) : (
                          <span className="text-amber-700">
                            {r.code}
                            {r.warning ? ` · ${r.warning}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono">{r.canonical_field_public_id ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
