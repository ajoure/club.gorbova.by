// ============================================================================
// AdminProductsDocs — Documents Hub for products_sales domain.
// PATCH E.2: mounts ResolverV2DiagnosticsCard as additional admin-only sub-tab.
// Production DealDocumentsPanel and canonical-document-generate-strict are NOT
// touched. This is a shadow diagnostics surface only.
// ============================================================================

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AdminSystemDocs from "./AdminSystemDocs";
import { ResolverV2DiagnosticsCard } from "@/components/admin/resolver-v2/ResolverV2DiagnosticsCard";

export default function AdminProductsDocs() {
  return (
    <Tabs defaultValue="docs" className="w-full">
      <TabsList className="mx-4 mt-4">
        <TabsTrigger value="docs">Документы</TabsTrigger>
        <TabsTrigger value="resolver-v2">Resolver v2 (диагностика)</TabsTrigger>
      </TabsList>
      <TabsContent value="docs" className="mt-0">
        <AdminSystemDocs
          presetDomain="products_sales"
          backRoute="/admin/products-v2"
          backLabel="Продукты"
        />
      </TabsContent>
      <TabsContent value="resolver-v2" className="mt-0 px-4 pb-8">
        <div className="max-w-5xl mx-auto pt-4">
          <ResolverV2DiagnosticsCard />
        </div>
      </TabsContent>
    </Tabs>
  );
}
