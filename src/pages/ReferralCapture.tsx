import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { REFERRAL_STORAGE_KEY } from "@/lib/referrals";

export default function ReferralCapture() {
  const { partnerCode } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const code = partnerCode?.trim();
    if (code) localStorage.setItem(REFERRAL_STORAGE_KEY, code);
    navigate(`/auth${code ? `?ref=${encodeURIComponent(code)}` : ""}`, { replace: true });
  }, [navigate, partnerCode]);

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Переходим к регистрации…
      </div>
    </div>
  );
}
