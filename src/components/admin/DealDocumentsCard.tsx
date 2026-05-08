// ============================================================================
// DealDocumentsCard — Sprint 11 C3.
//
// Тонкая обёртка над `DealDocumentsPanel` (strict ID-first pipeline).
// Старая Sprint 10 реализация удалена: legacy generated_documents,
// auto-generation flags и старые placeholders больше не используются.
// ============================================================================

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { DealDocumentsPanel } from "@/components/ai-documents/DealDocumentsPanel";

interface DealDocumentsCardProps {
  orderId: string;
  /** Legacy prop, ignored — snapshot читается из orders_v2.meta.document_data.fields. */
  documentData?: unknown;
}

export function DealDocumentsCard({ orderId }: DealDocumentsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-orange-500" />
          Документы (strict ID-first)
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <DealDocumentsPanel orderId={orderId} />
      </CardContent>
    </Card>
  );
}
