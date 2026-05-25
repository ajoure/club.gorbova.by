import { AdminLayout } from "@/components/layout/AdminLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /admin/documents — админский домен «Документы» + «Реквизиты».
 * Скрываем только Gorbova AI (он живёт на /admin/ai).
 */
export default function AdminDocuments() {
  return (
    <AdminLayout>
      <AiPageContent
        mode="admin"
        initialSection="documents"
        hiddenSections={["ai"]}
      />
    </AdminLayout>
  );
}
