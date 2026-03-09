import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CourseHeader } from "@/components/course/CourseHeader";
import { CourseFooter } from "@/components/course/CourseFooter";
import { CloseYearHero } from "@/components/close-year/CloseYearHero";
import { CloseYearResults } from "@/components/close-year/CloseYearResults";
import { CloseYearProgram } from "@/components/close-year/CloseYearProgram";
import { CloseYearPricing, CLOSE_YEAR_PRODUCT_ID } from "@/components/close-year/CloseYearPricing";
import { PreregistrationDialog } from "@/components/course/PreregistrationDialog";
import { useAuth } from "@/contexts/AuthContext";

export default function CloseYear() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [preregOpen, setPreregOpen] = useState(false);

  const scrollToProgram = () => {
    document.getElementById("program")?.scrollIntoView({ behavior: "smooth" });
  };

  const handlePurchase = () => {
    if (!user) {
      navigate("/auth", { state: { returnTo: "/close-year" } });
      return;
    }
    // Canonical payment flow via /pay with product_id
    navigate(`/pay?product=${CLOSE_YEAR_PRODUCT_ID}`);
  };

  const handlePreregister = () => {
    setPreregOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <CourseHeader />

      <main>
        <CloseYearHero onScrollToProgram={scrollToProgram} />
        <CloseYearResults />
        <CloseYearProgram />
        <CloseYearPricing
          onPurchase={handlePurchase}
          onPreregister={handlePreregister}
        />
      </main>

      <CourseFooter />

      <PreregistrationDialog
        open={preregOpen}
        onOpenChange={setPreregOpen}
        tariffName="Стандартный"
        productCode="close_year_2025"
      />
    </div>
  );
}
