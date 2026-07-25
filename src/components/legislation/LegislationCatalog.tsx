import { Link } from "react-router-dom";
import { BookOpen, FileText, Scale } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { usePublishedLegislation } from "@/hooks/useLegislation";
import type { LegalCategory, LegalDocument } from "@/types/legislation";

const CATEGORY_LABELS: Record<LegalCategory, string> = {
  codes: "Кодексы Республики Беларусь",
  acts: "Нормативные правовые акты",
  other: "Другие правовые документы",
};

const CATEGORY_ICONS: Record<LegalCategory, typeof Scale> = {
  codes: BookOpen,
  acts: Scale,
  other: FileText,
};

function DocumentCard({ document }: { document: LegalDocument }) {
  return (
    <Link to={`/knowledge/laws/${document.slug}`} className="block">
      <GlassCard className="h-full transition-colors hover:border-primary/40">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h3 className="font-semibold leading-snug text-foreground">
              {document.title}
            </h3>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {document.doc_date && <span>{document.doc_date}</span>}
              {document.doc_number && <span>№ {document.doc_number}</span>}
            </div>
          </div>
          <Badge variant="outline">
            {document.status === "active" ? "Действует" : document.status}
          </Badge>
        </div>
        {document.last_synced_at && (
          <p className="mt-4 text-xs text-muted-foreground">
            Актуализировано:{" "}
            {new Date(document.last_synced_at).toLocaleDateString("ru-RU")}
          </p>
        )}
      </GlassCard>
    </Link>
  );
}

export function LegislationCatalog() {
  const { data = [], isLoading, isError } = usePublishedLegislation();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-36 rounded-2xl" />
        ))}
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

  if (data.length === 0) {
    return (
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
    );
  }

  return (
    <div className="space-y-10">
      {(Object.keys(CATEGORY_LABELS) as LegalCategory[]).map((category) => {
        const documents = data.filter((document) => document.category === category);
        if (documents.length === 0) return null;
        const Icon = CATEGORY_ICONS[category];

        return (
          <section key={category} className="space-y-4">
            <div className="flex items-center gap-3">
              <Icon className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">{CATEGORY_LABELS[category]}</h2>
              <Badge variant="secondary">{documents.length}</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((document) => (
                <DocumentCard key={document.id} document={document} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
