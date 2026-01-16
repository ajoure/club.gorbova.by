import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Cpu } from "lucide-react";

const AI = () => {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Cpu className="h-16 w-16 text-muted-foreground/50 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Нейросеть</h1>
        <p className="text-muted-foreground">Раздел в разработке</p>
      </div>
    </DashboardLayout>
  );
};

export default AI;
