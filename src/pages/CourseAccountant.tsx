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
import { CourseBenefits } from "@/components/course/CourseBenefits";
export default function CourseAccountant() {
  return (
    <div className="min-h-screen bg-background">
      <CourseHeader />
      
      <main>
        <CourseHero />
        <CourseAudience />
        <CourseExpert />
        <CourseBenefits />
        <CourseLearningProcess />
        <CourseProgram />
        <CourseIndustries />
        <CourseResults />
        <CoursePricing />
      </main>

      <CourseFooter />

    </div>
  );
}
