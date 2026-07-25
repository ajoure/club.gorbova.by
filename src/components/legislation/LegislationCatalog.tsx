import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileSearch,
  FileText,
  Loader2,
  Scale,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useLegislationSearch,
  usePublishedLegislation,
} from "@/hooks/useLegislation";
import type {
  LegalCategory,
  LegalDocument,
  LegalSearchResult,
} from "@/types/legislation";

const CATEGORY_LABELS: Record<LegalCategory, string> = {
  codes: "Кодексы Республики Беларусь",
  acts: "Нормативные правовые акты",
  other: "Другие правовые документы",
};

const CATEGORY_DESCRIPTIONS: Record<LegalCategory, string> = {
  codes: "Действующие кодексы в актуальной редакции",
  acts: "Законы, указы, постановления и иные акты",
  other: "Международные и справочные правовые документы",
};

const CATEGORY_ICONS: Record<LegalCategory, typeof Scale> = {
  codes: BookOpen,
  acts: Scale,
  other: FileText,
};

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T00:00:00`))
    : null;
}

function HighlightedSnippet({ text }: { text: string }) {
  const parts = text.split(/(<mark>.*?<\/mark>)/gi);

  return (
    <>
      {parts.map((part, index) => {
        const marked = /^<mark>.*<\/mark>$/i.test(part);
        const clean = marked ? part.replace(/<\/?mark>/gi, "") : part;
        return marked ? (
          <mark
            key={`${clean}-${index}`}
            className="rounded bg-amber-200/80 px-0.5 text-foreground dark:bg-amber-400/25"
          >
            {clean}
          </mark>
        ) : (
          <Fragment key={`${clean}-${index}`}>{clean}</Fragment>
        );
      })}
    </>
  );
}

function DocumentRow({ document }: { document: LegalDocument }) {
  return (
    <Link
      to={`/knowledge/laws/${document.slug}`}
      className="group flex items-center gap-3 border-t border-border/50 px-4 py-4 transition-colors first:border-t-0 hover:bg-primary/[0.045] sm:px-5"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 font-medium leading-snug text-foreground">
            {document.title}
          </h3>
          {document.status === "active" && (
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              Действует
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {document.doc_date && <span>от {formatDate(document.doc_date)}</span>}
          {document.doc_number && <span>№ {document.doc_number}</span>}
          {document.last_synced_at && (
            <span className="hidden sm:inline">
              Обновлено{" "}
              {new Date(document.last_synced_at).toLocaleDateString("ru-RU")}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

function SearchResultRow({ result }: { result: LegalSearchResult }) {
  return (
    <Link
      to={`/knowledge/laws/${result.slug}#${encodeURIComponent(result.anchor)}`}
      className="group block border-t border-border/50 px-4 py-4 transition-colors first:border-t-0 hover:bg-primary/[0.045] sm:px-5"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileSearch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-medium leading-snug text-foreground">
              {result.title}
            </h3>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            <HighlightedSnippet text={result.snippet} />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{CATEGORY_LABELS[result.category]}</span>
            {result.doc_number && <span>· № {result.doc_number}</span>}
            <span className="rounded-md bg-muted px-1.5 py-0.5">
              Перейти к найденному фрагменту
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function LegislationCatalog() {
  const navigate = useNavigate();
  const { data = [], isLoading, isError } = usePublishedLegislation();
  const [input, setInput] = useState("");
  const [debouncedInput, setDebouncedInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedInput(input.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [input]);

  const suggestions = useLegislationSearch(
    debouncedInput,
    6,
    isFocused && !submittedQuery,
  );
  const results = useLegislationSearch(submittedQuery, 60, Boolean(submittedQuery));

  const categories = useMemo(
    () =>
      (Object.keys(CATEGORY_LABELS) as LegalCategory[])
        .map((category) => ({
          category,
          documents: data.filter((document) => document.category === category),
        }))
        .filter(({ documents }) => documents.length > 0),
    [data],
  );

  const submitSearch = () => {
    const query = input.trim();
    if (query.length < 2) return;
    setSubmittedQuery(query);
    setIsFocused(false);
  };

  const clearSearch = () => {
    setInput("");
    setDebouncedInput("");
    setSubmittedQuery("");
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-52 rounded-3xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <GlassCard className="py-12 text-center">
        <Scale className="mx-auto mb-4 h-12 w-12 text-destructive/60" />
        <p className="font-medium">Не удалось загрузить законодательство</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Попробуйте обновить страницу.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="relative space-y-6 pb-4">
      <section className="relative overflow-visible rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/[0.14] via-background to-violet-500/[0.08] px-5 py-8 shadow-sm sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <Scale className="absolute -bottom-12 right-8 h-48 w-48 rotate-[-8deg] text-primary/[0.045]" />
        </div>

        <div className="relative mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-background/70 px-3 py-1 text-xs font-medium text-primary backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Актуальное законодательство Республики Беларусь
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Найдите нужную норму права
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Поиск по названиям, статьям и тексту нормативных правовых актов
          </p>

          <form
            className="relative mx-auto mt-6 max-w-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <Search className="absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (submittedQuery) setSubmittedQuery("");
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => window.setTimeout(() => setIsFocused(false), 150)}
              placeholder="Например: отпуск, подоходный налог, статья 107..."
              className="h-14 rounded-2xl border-primary/20 bg-background/95 pl-12 pr-28 text-base shadow-lg shadow-primary/5 focus-visible:ring-primary/30"
              aria-label="Поиск по законодательству"
            />
            {input && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-[5.6rem] top-1/2 z-10 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Очистить поиск"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <Button
              type="submit"
              className="absolute right-1.5 top-1.5 h-11 rounded-xl px-5"
              disabled={input.trim().length < 2}
            >
              Найти
            </Button>

            {isFocused && debouncedInput.length >= 2 && !submittedQuery && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border bg-popover text-left shadow-xl">
                {suggestions.isLoading ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ищем совпадения…
                  </div>
                ) : suggestions.data?.length ? (
                  <>
                    {suggestions.data.map((result) => (
                      <button
                        key={`${result.document_id}-${result.anchor}`}
                        type="button"
                        className="flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/60"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          navigate(
                            `/knowledge/laws/${result.slug}#${encodeURIComponent(result.anchor)}`,
                          )
                        }
                      >
                        <Search className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {result.title}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            <HighlightedSnippet text={result.snippet} />
                          </span>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-2 bg-muted/40 px-4 py-3 text-sm font-medium text-primary hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={submitSearch}
                    >
                      Показать все результаты
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Совпадений пока не найдено
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      </section>

      {submittedQuery ? (
        <section className="overflow-hidden rounded-2xl border bg-card/80 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 border-b bg-muted/25 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Результаты поиска
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                «{submittedQuery}»
                {!results.isLoading && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {results.data?.length ?? 0}
                  </span>
                )}
              </h2>
            </div>
            <Button variant="outline" size="sm" onClick={clearSearch}>
              Вернуться к списку
            </Button>
          </div>
          {results.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Ищем по текстам документов…
            </div>
          ) : results.isError ? (
            <div className="py-14 text-center text-sm text-destructive">
              Поиск временно недоступен. Попробуйте еще раз.
            </div>
          ) : results.data?.length ? (
            results.data.map((result) => (
              <SearchResultRow
                key={`${result.document_id}-${result.anchor}`}
                result={result}
              />
            ))
          ) : (
            <div className="px-5 py-14 text-center">
              <FileSearch className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 font-medium">Ничего не найдено</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Попробуйте изменить форму слова или сократить запрос.
              </p>
            </div>
          )}
        </section>
      ) : data.length === 0 ? (
        <GlassCard className="py-16 text-center">
          <Scale className="mx-auto mb-6 h-16 w-16 text-muted-foreground/30" />
          <h3 className="mb-2 text-xl font-semibold">
            Раздел наполняется нормативными актами
          </h3>
          <p className="mx-auto max-w-md text-muted-foreground">
            Здесь появятся актуальные кодексы и другие нормативные правовые акты
            Республики Беларусь.
          </p>
        </GlassCard>
      ) : (
        <Accordion
          type="multiple"
          defaultValue={categories.map(({ category }) => category)}
          className="space-y-3"
        >
          {categories.map(({ category, documents }) => {
            const Icon = CATEGORY_ICONS[category];
            return (
              <AccordionItem
                key={category}
                value={category}
                className="overflow-hidden rounded-2xl border bg-card/80 shadow-sm backdrop-blur"
              >
                <AccordionTrigger className="px-4 py-4 hover:no-underline sm:px-5">
                  <div className="flex min-w-0 items-center gap-3 text-left">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold sm:text-lg">
                          {CATEGORY_LABELS[category]}
                        </h2>
                        <Badge variant="secondary">{documents.length}</Badge>
                      </div>
                      <p className="mt-0.5 hidden text-xs font-normal text-muted-foreground sm:block">
                        {CATEGORY_DESCRIPTIONS[category]}
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="border-t">
                    {documents.map((document) => (
                      <DocumentRow key={document.id} document={document} />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
