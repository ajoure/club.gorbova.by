import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BookOpen } from "lucide-react";

const Knowledge = () => {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <BookOpen className="h-16 w-16 text-muted-foreground/50 mb-4" />
        <h1 className="text-2xl font-bold mb-2">База знаний</h1>
        <p className="text-muted-foreground">Раздел в разработке</p>
      </div>
    </DashboardLayout>
  );
};

export default Knowledge;
