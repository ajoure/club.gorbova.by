import { AdminLayout } from "@/components/layout/AdminLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /admin/documents — отдельный домен «Документы».
 * Скрываем секции Gorbova AI и Реквизиты — только документная вкладка.
 */
export default function AdminDocuments() {
  return (
    <AdminLayout>
      <AiPageContent
        mode="admin"
        initialSection="documents"
        hiddenSections={["ai", "requisites"]}
      />
    </AdminLayout>
  );
}
