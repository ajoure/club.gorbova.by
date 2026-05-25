import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

const AI = () => {
  return (
    <DashboardLayout>
      {/* На /ai остаётся только Gorbova AI. Реквизиты переехали в /document-generation. */}
      <AiPageContent mode="user" hiddenSections={["requisites"]} />
    </DashboardLayout>
  );
};

export default AI;
