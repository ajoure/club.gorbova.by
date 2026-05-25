import { AdminLayout } from "@/components/layout/AdminLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /admin/ai — оставлен только Gorbova AI (Чат / История анализа / Туториалы / Промпты).
 * Документы остаются на /admin/documents, Реквизиты переехали туда же.
 */
export default function AdminAI() {
  return (
    <AdminLayout>
      <AiPageContent mode="admin" hiddenSections={["documents", "requisites"]} />
    </AdminLayout>
  );
}
