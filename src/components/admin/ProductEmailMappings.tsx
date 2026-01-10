import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Package,
  Mail,
  Link2,
  Loader2,
  Trash2,
  Plus,
  Star,
} from "lucide-react";

interface EmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  from_name: string | null;
  is_default: boolean;
  is_active: boolean;
}

interface Product {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface ProductEmailMapping {
  id: string;
  product_id: string;
  email_account_id: string;
  is_active: boolean;
  created_at: string;
  product?: Product;
  email_account?: EmailAccount;
}

interface ProductEmailMappingsProps {
  accounts: EmailAccount[];
}

export function ProductEmailMappings({ accounts }: ProductEmailMappingsProps) {
  const queryClient = useQueryClient();
  const [newMapping, setNewMapping] = useState<{
    product_id: string;
    email_account_id: string;
  }>({ product_id: "", email_account_id: "" });

  // Fetch products
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["products-for-email-mapping"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, code, is_active")
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  // Fetch existing mappings
  const { data: mappings = [], isLoading: loadingMappings } = useQuery({
    queryKey: ["product-email-mappings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_email_mappings")
        .select(
          `
          id,
          product_id,
          email_account_id,
          is_active,
          created_at
        `
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProductEmailMapping[];
    },
  });

  // Get default account
  const defaultAccount = accounts.find((a) => a.is_default);

  // Get products without mappings
  const mappedProductIds = new Set(mappings.map((m) => m.product_id));
  const unmappedProducts = products.filter((p) => !mappedProductIds.has(p.id));

  // Save mapping mutation
  const saveMappingMutation = useMutation({
    mutationFn: async (mapping: { product_id: string; email_account_id: string }) => {
      const { error } = await supabase
        .from("product_email_mappings")
        .upsert({
          product_id: mapping.product_id,
          email_account_id: mapping.email_account_id,
          is_active: true,
        }, {
          onConflict: "product_id",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-email-mappings"] });
      setNewMapping({ product_id: "", email_account_id: "" });
      toast.success("Привязка сохранена");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Delete mapping mutation
  const deleteMappingMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase
        .from("product_email_mappings")
        .delete()
        .eq("id", mappingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-email-mappings"] });
      toast.success("Привязка удалена");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  const getProductName = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    return product?.name || "Неизвестный продукт";
  };

  const getAccountEmail = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    return account?.email || "Неизвестный ящик";
  };

  const getAccountName = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    return account?.from_name || account?.display_name || null;
  };

  const isLoading = loadingProducts || loadingMappings;

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-4">
        <Link2 className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Привязка почты к продуктам</h2>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Назначьте конкретный почтовый ящик для каждого продукта. Если привязка не указана, 
        будет использоваться ящик по умолчанию
        {defaultAccount && (
          <span className="font-medium"> ({defaultAccount.email})</span>
        )}
        .
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* Add new mapping */}
          {unmappedProducts.length > 0 && accounts.length > 0 && (
            <div className="flex items-end gap-3 p-4 bg-muted/30 rounded-lg mb-4">
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">Продукт</label>
                <Select
                  value={newMapping.product_id}
                  onValueChange={(value) =>
                    setNewMapping((prev) => ({ ...prev, product_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите продукт" />
                  </SelectTrigger>
                  <SelectContent>
                    {unmappedProducts.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4" />
                          <span>{product.name}</span>
                          {!product.is_active && (
                            <Badge variant="secondary" className="text-xs">
                              Неактивен
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium">Почтовый ящик</label>
                <Select
                  value={newMapping.email_account_id}
                  onValueChange={(value) =>
                    setNewMapping((prev) => ({ ...prev, email_account_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите ящик" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => a.is_active)
                      .map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            <span>{account.email}</span>
                            {account.is_default && (
                              <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                            )}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => saveMappingMutation.mutate(newMapping)}
                disabled={
                  !newMapping.product_id ||
                  !newMapping.email_account_id ||
                  saveMappingMutation.isPending
                }
              >
                {saveMappingMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </div>
          )}

          {/* Existing mappings */}
          {mappings.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Link2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>Нет привязок. Все продукты используют ящик по умолчанию.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Продукт</TableHead>
                  <TableHead>Почтовый ящик</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">
                          {getProductName(mapping.product_id)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div>{getAccountEmail(mapping.email_account_id)}</div>
                          {getAccountName(mapping.email_account_id) && (
                            <div className="text-xs text-muted-foreground">
                              {getAccountName(mapping.email_account_id)}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMappingMutation.mutate(mapping.id)}
                        disabled={deleteMappingMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}</TableBody>
            </Table>
          )}

          {/* Info about unmapped products */}
          {unmappedProducts.length > 0 && mappings.length > 0 && (
            <p className="text-xs text-muted-foreground mt-4">
              Ещё {unmappedProducts.length} продукт(ов) без привязки — используют ящик по умолчанию
            </p>
          )}
        </>
      )}
    </GlassCard>
  );
}
