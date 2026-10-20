import { useState } from 'react';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Health = { ready: boolean; probes: { function: string; status: number | null; matches: boolean }[] };
const labels: Record<string, string> = {
  'sales-runtime-worker': 'Обработка сообщений',
  'sales-runtime-control': 'Управление сообщениями',
  'telegram-webhook': 'Входящие сообщения Telegram',
  'telegram-media-worker': 'Медиа Telegram',
  'send-email:service': 'Почта: сервисный вызов',
  'send-email:staff': 'Почта: вызов сотрудника',
};

/** Fixed authenticated diagnostics only: no SMTP, broadcasts or queue processing. */
export function ReleaseHealthCheck() {
  const { data: isSuperAdmin } = useSuperAdmin();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  if (!isSuperAdmin) return null;
  async function check() {
    setBusy(true); setFailed(false); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('instagram-monitor', { body: { action: 'release_health' } });
      const health = data?.result;
      if (error || data?.ok !== true || !Array.isArray(health?.probes)
        || health.probes.length !== 6 || new Set(health.probes.map((p: Health['probes'][number]) => p.function)).size !== 6
        || !health.probes.every((p: Health['probes'][number]) =>
          typeof p.function === 'string' && Object.prototype.hasOwnProperty.call(labels, p.function)
          && (p.status === null || (Number.isInteger(p.status) && p.status! >= 100 && p.status! <= 599))
          && typeof p.matches === 'boolean')) throw new Error('invalid_health');
      setResult({ ready: health.ready === true && health.probes.every((p: Health['probes'][number]) => p.status === 200 && p.matches), probes: health.probes });
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <Card data-testid="release-health-check" className="min-w-0">
    <CardHeader><CardTitle className="text-base">Проверка релиза и почты</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Проверяет версии функций и авторизацию почты. Письма не отправляются, очереди не запускаются.</p>
      <Button onClick={check} disabled={busy} className="h-auto min-h-10 whitespace-normal text-left">{busy ? 'Проверка…' : 'Проверить без отправки'}</Button>
      {failed && <p role="alert" className="text-sm text-destructive">Не удалось выполнить проверку. Попробуйте ещё раз.</p>}
      {result && <div role="status" className="space-y-2 text-sm">
        <p className={result.ready ? 'font-medium text-green-700 dark:text-green-400' : 'font-medium text-destructive'}>{result.ready ? 'Все проверки пройдены' : 'Проверка не пройдена'}</p>
        <ul className="space-y-1">{result.probes.map(p => <li key={p.function} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <span>{labels[p.function]}</span><span>{p.status === 200 && p.matches ? 'Готово' : `Ошибка${p.status ? ` (${p.status})` : ''}`}</span>
        </li>)}</ul>
      </div>}
    </CardContent>
  </Card>;
}
