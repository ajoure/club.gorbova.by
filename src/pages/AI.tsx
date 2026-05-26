import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

/**
 * /ai — пользовательский домен «Нейросеть»: только Gorbova AI.
 * Документы и пакеты документов живут в /document-generation.
 * Реквизиты — в /settings/requisites и /document-generation.
 */
const AI = () => {
  return (
    <DashboardLayout>
      <AiPageContent
        mode="user"
        hiddenSections={["requisites", "doc-packages", "documents"]}
      />
    </DashboardLayout>
  );
};

export default AI;
