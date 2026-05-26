import { AdminLayout } from "@/components/layout/AdminLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /admin/ai — админский домен «Нейросеть»: только Gorbova AI
 * (Чат / История анализа / Туториалы / Промпты).
 * Документы и пакеты живут в /admin/documents.
 */
export default function AdminAI() {
  return (
    <AdminLayout>
      <AiPageContent
        mode="admin"
        hiddenSections={["documents", "doc-packages", "requisites"]}
      />
    </AdminLayout>
  );
}
