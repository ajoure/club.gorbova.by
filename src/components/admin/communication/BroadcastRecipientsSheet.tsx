import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Mail, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const PAGE_SIZE = 50;

interface Recipient {
  id: string;
  full_name: string | null;
  email: string | null;
  telegram_username: string | null;
  has_telegram: boolean;
  has_email: boolean;
}

interface RecipientPage {
  users: Recipient[];
  total_count: number;
  page_offset: number;
  page_limit: number;
}

// The parent keys this component by filters: a changed audience starts at page 1.
export function BroadcastRecipientsSheet({ filters }: { filters: object }) {
  const [offset, setOffset] = useState(0);
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["broadcast-recipient-page", filters, offset],
    queryFn: async (): Promise<RecipientPage> => {
      const { data, error } = await supabase.functions.invoke("broadcast-audience-preview", {
        body: { filters, page_offset: offset, page_limit: PAGE_SIZE },
      });
      if (error || data?.error) throw new Error("Не удалось загрузить получателей. Повторите попытку.");
      // Fail visibly if the server still returns the old first-page-only contract.
      if (data?.page_offset !== offset || data?.page_limit !== PAGE_SIZE
        || !Array.isArray(data?.users) || !Number.isSafeInteger(data?.total_count) || data.total_count < 0
        || data.users.length !== Math.min(PAGE_SIZE, Math.max(0, data.total_count - offset))) {
        throw new Error("Полный список получателей пока недоступен. Обновите страницу или повторите позже.");
      }
      return data as RecipientPage;
    },
    retry: 1,
  });
  const hasNext = !!data && offset + data.users.length < data.total_count;

  return (
    <SheetContent className="flex h-[100dvh] w-full flex-col gap-4 sm:max-w-md pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
      <SheetHeader className="shrink-0 pr-8 text-left">
        <SheetTitle>Получатели рассылки</SheetTitle>
        <SheetDescription aria-live="polite">
          {isFetching ? "Загрузка получателей…" : error ? "Список не загружен" : data?.users.length
            ? `Получатели ${offset + 1}–${offset + data.users.length} из ${data.total_count}`
            : `Получателей на странице: 0. Всего: ${data?.total_count ?? 0}`}
        </SheetDescription>
      </SheetHeader>
      <div key={offset} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-busy={isFetching}>
        {isFetching ? (
          <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </div>
        ) : error ? (
          <div role="alert" className="space-y-3 py-4 text-sm">
            <p>{error.message}</p>
            <Button variant="outline" onClick={() => refetch()}>Повторить</Button>
          </div>
        ) : data?.users.length ? (
          <ol start={offset + 1} aria-label="Получатели рассылки" className="space-y-2">
            {data.users.map((user, index) => (
              <li key={user.id} className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                <span className="shrink-0 text-xs text-muted-foreground">{offset + index + 1}.</span>
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <p className="text-sm font-medium">{user.full_name || "Без имени"}</p>
                  {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                  {user.telegram_username && <p className="text-xs text-muted-foreground">@{user.telegram_username.replace(/^@/, "")}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {user.has_telegram && <MessageCircle aria-label="Telegram" className="h-4 w-4 text-blue-500" />}
                  {user.has_email && <Mail aria-label="Email" className="h-4 w-4 text-orange-500" />}
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="py-4 text-sm text-muted-foreground">{offset ? "Список изменился. Вернитесь на первую страницу." : "По выбранным фильтрам получателей нет."}</p>}
      </div>
      <nav aria-label="Страницы получателей" className="flex shrink-0 items-center justify-between gap-2 border-t pt-4">
        <Button variant="outline" disabled={offset === 0 || isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Назад</Button>
        <span className="text-xs text-muted-foreground">Стр. {offset / PAGE_SIZE + 1}</span>
        <Button variant="outline" disabled={!hasNext || isFetching || !!error} onClick={() => setOffset(offset + PAGE_SIZE)}>Далее</Button>
      </nav>
    </SheetContent>
  );
}
