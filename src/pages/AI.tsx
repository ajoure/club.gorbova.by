import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AiPageContent } from "@/components/ai-chat/AiPageContent";

const AI = () => {
  return (
    <DashboardLayout>
      <AiPageContent mode="user" />
    </DashboardLayout>
  );
};

export default AI;
