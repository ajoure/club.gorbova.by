import { AdminLayout } from "@/components/layout/AdminLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

export default function AdminAI() {
  return (
    <AdminLayout>
      <AiPageContent mode="admin" hiddenSections={["documents"]} />
    </AdminLayout>
  );
}
