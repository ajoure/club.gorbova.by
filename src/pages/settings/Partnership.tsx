import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ReferralDashboardCard } from "@/components/referrals/ReferralDashboardCard";

export default function PartnershipSettings() {
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto w-full space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Партнёрство</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ваша персональная ссылка, условия программы, приглашённые и выплаты.
          </p>
        </div>
        <ReferralDashboardCard />
      </div>
    </DashboardLayout>
  );
}
