import { EntityCustomFields } from "@/components/shared/EntityCustomFields";
import { GlassCard } from "@/components/ui/GlassCard";
import { FileText } from "lucide-react";

interface Props {
  entityId: string;
  entityType?: string;
}

export function ProductCustomFields({ entityId, entityType = "product" }: Props) {
  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
            <FileText className="h-4.5 w-4.5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Поля для документов</h3>
            <p className="text-sm text-muted-foreground">
              Эти поля можно использовать в шаблонах документов и передавать в сделки.
              Технические <code className="text-[11px]">field_id</code> и токены доступны в каталоге плейсхолдеров (раздел «Документы → Плейсхолдеры»).
            </p>
          </div>
        </div>
      </GlassCard>

      <EntityCustomFields
        entityId={entityId}
        entityType={entityType}
        entityLabel="продукта"
      />
    </div>
  );
}
