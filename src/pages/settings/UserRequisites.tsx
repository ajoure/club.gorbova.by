/**
 * UserRequisites — page for personal user requisites (scope=user_requisites).
 *
 * Reachable when REQUISITES_V2_UI_ENABLED. Always renders the V2 manager.
 * No artificial-intelligence wording in route, file, or labels.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RequisitesV2Manager } from "@/components/requisites-v2/RequisitesV2Manager";
import { REQUISITES_V2_UI_ENABLED } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";

export default function UserRequisitesSettings() {
  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        {REQUISITES_V2_UI_ENABLED ? (
          <RequisitesV2Manager
            scope="user_requisites"
            title="Пользовательские реквизиты"
            description="Реквизиты ЮЛ / ИП / ФЛ, которые вы используете в своих документах"
          />
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Раздел временно недоступен. Включите feature flag REQUISITES_V2_UI.
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
