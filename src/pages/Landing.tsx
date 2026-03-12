import { useEffect } from "react";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingProblems } from "@/components/landing/LandingProblems";
import { LandingConsequences } from "@/components/landing/LandingConsequences";
import { LandingAudience } from "@/components/landing/LandingAudience";
import { LandingBenefits } from "@/components/landing/LandingBenefits";
import { LandingContent } from "@/components/landing/LandingContent";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { LandingAbout } from "@/components/landing/LandingAbout";
import { LandingFAQ } from "@/components/landing/LandingFAQ";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";

const Landing = () => {
  useEffect(() => {
    // Analytics: landing_view
    console.log("[Analytics] landing_view");
  }, []);

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <LandingHeader />
      <main>
        <LandingHero />
        <LandingProblems />
        <LandingConsequences />
        <LandingAudience />
        <LandingBenefits />
        <LandingContent />
        <LandingPricing />
        <LandingAbout />
        <LandingFAQ />
        <LandingCTA />
      </main>
      <LandingFooter />
    </div>
  );
};

export default Landing;
