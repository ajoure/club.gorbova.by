import { AdminLayout } from "@/components/layout/AdminLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /admin/documents — единый админский домен «Документы».
 * Подвкладки: Плейсхолдеры, Шаблоны документов, Пакеты документов
 * (с Идеологией), История, Исполнители.
 *
 * Скрыты: Gorbova AI (живёт в /admin/ai), отдельная секция «Документы пакеты»
 * (пакеты теперь внутри «Документов»), Реквизиты (клиентские реквизиты —
 * в пользовательском домене /document-generation).
 */
export default function AdminDocuments() {
  return (
    <AdminLayout>
      <AiPageContent
        mode="admin"
        initialSection="documents"
        hiddenSections={["ai", "doc-packages", "requisites"]}
      />
    </AdminLayout>
  );
}
