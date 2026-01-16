import { useState } from "react";
import { CourseHeader } from "@/components/course/CourseHeader";
import { CourseFooter } from "@/components/course/CourseFooter";
import { CourseHero } from "@/components/course/CourseHero";
import { CourseAudience } from "@/components/course/CourseAudience";
import { CourseExpert } from "@/components/course/CourseExpert";
import { CourseProgram } from "@/components/course/CourseProgram";
import { CourseResults } from "@/components/course/CourseResults";
import { CoursePricing } from "@/components/course/CoursePricing";
import { CourseIndustries } from "@/components/course/CourseIndustries";
import { CourseLearningProcess } from "@/components/course/CourseLearningProcess";
import { PreregistrationDialog } from "@/components/course/PreregistrationDialog";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface CourseTariff {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  subtitle: string;
  features: string[];
  isPopular?: boolean;
}

export default function CourseAccountant() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [preregOpen, setPreregOpen] = useState(false);
  const [selectedTariff, setSelectedTariff] = useState<CourseTariff | null>(null);

  const handlePreregister = (tariff: CourseTariff) => {
    setSelectedTariff(tariff);
    setPreregOpen(true);
  };

  const handlePurchase = (tariff: CourseTariff) => {
    if (!user) {
      navigate("/auth", { state: { returnTo: "/course-accountant" } });
      return;
    }
    // Navigate to checkout with tariff info
    toast.success(`Выбран тариф "${tariff.name}". Переходим к оплате...`);
    // TODO: Integrate with PaymentDialog after payment system is configured
  };

  return (
    <div className="min-h-screen bg-background">
      <CourseHeader />
      
      <main>
        <CourseHero />
        <CourseAudience />
        <CourseExpert />
        <CourseLearningProcess />
        <CourseProgram />
        <CourseIndustries />
        <CourseResults />
        <CoursePricing 
          onPreregister={handlePreregister}
          onPurchase={handlePurchase}
        />
      </main>

      <CourseFooter />

      <PreregistrationDialog
        open={preregOpen}
        onOpenChange={setPreregOpen}
        tariffName={selectedTariff?.name}
      />
    </div>
  );
}
