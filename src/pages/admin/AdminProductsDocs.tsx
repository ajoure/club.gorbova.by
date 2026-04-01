import AdminSystemDocs from "./AdminSystemDocs";

export default function AdminProductsDocs() {
  return (
    <AdminSystemDocs
      presetDomain="products_sales"
      backRoute="/admin/products-v2"
      backLabel="Продукты"
    />
  );
}
