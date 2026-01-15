import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  User,
  ShieldCheck,
  ShieldX,
  Clock,
  FileText,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface ProfileWithConsent {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  consent_version: string | null;
  consent_given_at: string | null;
  marketing_consent: boolean | null;
  created_at: string;
}

interface ConsentLog {
  id: string;
  user_id: string | null;
  email: string | null;
  consent_type: string;
  policy_version: string;
  granted: boolean;
  source: string;
  created_at: string;
}

interface ConsentDetailSheetProps {
  profile: ProfileWithConsent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConsentDetailSheet({ profile, open, onOpenChange }: ConsentDetailSheetProps) {
  // Fetch consent history for this user
  const { data: consentHistory, isLoading } = useQuery({
    queryKey: ["consent-history", profile?.user_id],
    queryFn: async () => {
      if (!profile?.user_id) return [];
      const { data, error } = await supabase
        .from("consent_logs")
        .select("*")
        .eq("user_id", profile.user_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ConsentLog[];
    },
    enabled: !!profile?.user_id && open,
  });

  const getDisplayName = () => {
    if (!profile) return "";
    if (profile.full_name) return profile.full_name;
    const parts = [profile.first_name, profile.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : "Без имени";
  };

  const formatConsentType = (type: string) => {
    const types: Record<string, string> = {
      privacy_policy: "Политика конфиденциальности",
      marketing: "Маркетинговые рассылки",
    };
    return types[type] || type;
  };

  const formatSource = (source: string) => {
    const sources: Record<string, string> = {
      modal: "Всплывающее окно",
      settings: "Настройки профиля",
      registration: "При регистрации",
      signup: "При регистрации",
    };
    return sources[source] || source;
  };

  if (!profile) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
              <User className="w-6 h-6 text-primary" />
            </div>
            <div>
              <SheetTitle className="text-lg">{getDisplayName()}</SheetTitle>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-140px)]">
          <div className="space-y-4 pr-4">
            {/* Current status */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Текущий статус</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Privacy Policy */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Политика конфиденциальности</p>
                      {profile.consent_version ? (
                        <p className="text-xs text-muted-foreground">
                          Версия: {profile.consent_version}
                          {profile.consent_given_at && (
                            <> • {format(new Date(profile.consent_given_at), "dd MMM yyyy, HH:mm:ss", { locale: ru })}</>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Согласие не дано</p>
                      )}
                    </div>
                  </div>
                  {profile.consent_version ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 shrink-0">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Дано
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 shrink-0">
                      <XCircle className="h-3 w-3 mr-1" />
                      Нет
                    </Badge>
                  )}
                </div>

              </CardContent>
            </Card>

            {/* Consent history */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">История изменений</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : !consentHistory || consentHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    История изменений пуста
                  </p>
                ) : (
                  <div className="space-y-3">
                    {consentHistory.map((log) => (
                      <div key={log.id} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(log.created_at), "dd MMM yyyy, HH:mm:ss", { locale: ru })}
                            </span>
                          </div>
                          {log.granted ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                              <ShieldCheck className="h-3 w-3 mr-1" />
                              Дано
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-xs">
                              <ShieldX className="h-3 w-3 mr-1" />
                              Отозвано
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium">{formatConsentType(log.consent_type)}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Источник: {formatSource(log.source)}</span>
                          <span>•</span>
                          <span>Версия: {log.policy_version}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
