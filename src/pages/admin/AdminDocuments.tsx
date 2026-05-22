import { AdminLayout } from "@/components/layout/AdminLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /admin/documents — визуальный shortcut на секцию «Документы»
 * из /admin/ai. Никакой новой логики: переиспользует AiPageContent
 * с initialSection="documents". Старый путь /admin/ai сохранён.
 */
export default function AdminDocuments() {
  return (
    <AdminLayout>
      <AiPageContent mode="admin" initialSection="documents" />
    </AdminLayout>
  );
}
