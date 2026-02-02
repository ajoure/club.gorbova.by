import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateFilter } from "@/components/ui/period-selector";
import { Json } from "@/integrations/supabase/types";

// Type for bepaid_statement_rows table
export interface BepaidStatementRow {
  id: string;
  uid: string;
  order_id_bepaid: string | null;
  status: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  commission_percent: number | null;
  commission_per_op: number | null;
  commission_total: number | null;
  payout_amount: number | null;
  transaction_type: string | null;
  tracking_id: string | null;
  created_at_bepaid: string | null;
  paid_at: string | null;
  payout_date: string | null;
  expires_at: string | null;
  message: string | null;
  shop_id: string | null;
  shop_name: string | null;
  business_category: string | null;
  bank_id: string | null;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  country: string | null;
  city: string | null;
  zip: string | null;
  region: string | null;
  phone: string | null;
  ip: string | null;
  email: string | null;
  payment_method: string | null;
  product_code: string | null;
  card_masked: string | null;
  card_holder: string | null;
  card_expires: string | null;
  card_bin: string | null;
  bank_name: string | null;
  bank_country: string | null;
  secure_3d: string | null;
  avs_result: string | null;
  fraud: string | null;
  auth_code: string | null;
  rrn: string | null;
  reason: string | null;
  payment_identifier: string | null;
  token_provider: string | null;
  merchant_id: string | null;
  merchant_country: string | null;
  merchant_company: string | null;
  converted_amount: number | null;
  converted_currency: string | null;
  gateway_id: string | null;
  recurring_type: string | null;
  card_bin_8: string | null;
  bank_code: string | null;
  response_code: string | null;
  conversion_rate: number | null;
  converted_payout: number | null;
  converted_commission: number | null;
  raw_data: Json | null;
  import_batch_id: string | null;
  imported_at: string | null;
  updated_at: string | null;
  // Computed field for sorting (generated column in DB)
  sort_ts?: string | null;
}

export interface BepaidStatementStats {
  payments_count: number;
  payments_amount: number;
  refunds_count: number;
  refunds_amount: number;
  cancellations_count: number;
  cancellations_amount: number;
  errors_count: number;
  errors_amount: number;
  commission_total: number;
  payout_total: number;
  total_count: number;
}

export interface StatementCursor {
  sort_ts: string;
  uid: string;
}

export interface StatementQueryParams {
  dateFilter: DateFilter;
  searchQuery?: string;
  pageSize?: number;
}

/**
 * Convert date filter to offset ISO format (+03:00)
 */
function toOffsetISO(dateStr: string, endOfDay = false): string {
  if (endOfDay) {
    return `${dateStr}T23:59:59+03:00`;
  }
  return `${dateStr}T00:00:00+03:00`;
}

/**
 * Keyset pagination hook for bepaid_statement_rows
 * Uses generated column sort_ts = COALESCE(paid_at, created_at_bepaid) for stable ordering
 */
export function useBepaidStatementPaginated(params: StatementQueryParams) {
  const { dateFilter, searchQuery = '', pageSize = 50 } = params;
  
  return useInfiniteQuery({
    queryKey: ['bepaid-statement-paginated', dateFilter.from, dateFilter.to, searchQuery, pageSize],
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as StatementCursor | undefined;
      
      // Build base query - select including sort_ts
      let query = supabase
        .from('bepaid_statement_rows')
        .select('*, sort_ts');
      
      // Date filter using sort_ts (generated column)
      if (dateFilter.from && dateFilter.to) {
        query = query
          .gte('sort_ts', toOffsetISO(dateFilter.from))
          .lte('sort_ts', toOffsetISO(dateFilter.to, true));
      } else if (dateFilter.from) {
        query = query.gte('sort_ts', toOffsetISO(dateFilter.from));
      } else if (dateFilter.to) {
        query = query.lte('sort_ts', toOffsetISO(dateFilter.to, true));
      }
      
      // Keyset cursor filter: (sort_ts, uid) < (cursor.sort_ts, cursor.uid)
      if (cursor && cursor.sort_ts) {
        query = query.or(
          `sort_ts.lt.${cursor.sort_ts},and(sort_ts.eq.${cursor.sort_ts},uid.lt.${cursor.uid})`
        );
      }
      
      // Order by sort_ts DESC, uid DESC (matches index)
      query = query
        .order('sort_ts', { ascending: false, nullsFirst: false })
        .order('uid', { ascending: false })
        .limit(pageSize);
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      let filteredData = (data || []) as BepaidStatementRow[];
      
      // Client-side search filtering (if needed)
      if (searchQuery.trim()) {
        const lowerSearch = searchQuery.toLowerCase().trim();
        filteredData = filteredData.filter(row => {
          const searchableFields = [
            row.uid,
            row.order_id_bepaid,
            row.email,
            row.phone,
            row.card_masked,
            row.card_holder,
            row.tracking_id,
            row.description,
            row.first_name,
            row.last_name,
            row.shop_name,
            row.bank_name,
            row.ip,
            row.status,
            row.transaction_type,
            row.amount?.toString(),
          ];
          return searchableFields.some(field => 
            field?.toLowerCase().includes(lowerSearch)
          );
        });
      }
      
      // Determine next cursor
      const lastRow = filteredData[filteredData.length - 1];
      const nextCursor: StatementCursor | undefined = lastRow && filteredData.length === pageSize
        ? { sort_ts: lastRow.sort_ts || '', uid: lastRow.uid }
        : undefined;
      
      return {
        rows: filteredData,
        nextCursor,
        hasMore: filteredData.length === pageSize,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as StatementCursor | undefined,
  });
}

/**
 * Simple non-paginated query for backward compatibility
 * Limited to first page only
 */
export function useBepaidStatement(dateFilter: DateFilter, searchQuery: string = '') {
  return useQuery({
    queryKey: ['bepaid-statement', dateFilter.from, dateFilter.to, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('bepaid_statement_rows')
        .select('*, sort_ts')
        .order('sort_ts', { ascending: false, nullsFirst: false })
        .order('uid', { ascending: false })
        .limit(50); // Default limit
      
      // Apply date filter on sort_ts
      if (dateFilter.from && dateFilter.to) {
        query = query
          .gte('sort_ts', toOffsetISO(dateFilter.from))
          .lte('sort_ts', toOffsetISO(dateFilter.to, true));
      } else if (dateFilter.from) {
        query = query.gte('sort_ts', toOffsetISO(dateFilter.from));
      } else if (dateFilter.to) {
        query = query.lte('sort_ts', toOffsetISO(dateFilter.to, true));
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      let filteredData = (data || []) as BepaidStatementRow[];
      
      // Client-side search filtering
      if (searchQuery.trim()) {
        const lowerSearch = searchQuery.toLowerCase().trim();
        filteredData = filteredData.filter(row => {
          const searchableFields = [
            row.uid,
            row.order_id_bepaid,
            row.email,
            row.phone,
            row.card_masked,
            row.card_holder,
            row.tracking_id,
            row.description,
            row.first_name,
            row.last_name,
            row.shop_name,
            row.bank_name,
            row.ip,
            row.status,
            row.transaction_type,
            row.amount?.toString(),
          ];
          return searchableFields.some(field => 
            field?.toLowerCase().includes(lowerSearch)
          );
        });
      }
      
      return filteredData;
    },
  });
}

/**
 * Server-side stats aggregation using RPC
 * Counts/sums are calculated on the server, not by loading all rows
 */
export function useBepaidStatementStats(dateFilter: DateFilter) {
  return useQuery({
    queryKey: ['bepaid-statement-stats', dateFilter.from, dateFilter.to],
    queryFn: async () => {
      // Use RPC for server-side aggregation
      const { data, error } = await supabase.rpc('get_bepaid_statement_stats', {
        from_date: dateFilter.from ? toOffsetISO(dateFilter.from) : '1970-01-01T00:00:00+03:00',
        to_date: dateFilter.to ? toOffsetISO(dateFilter.to, true) : '2099-12-31T23:59:59+03:00',
      });
      
      if (error) throw error;
      
      // Parse RPC result (type cast through unknown for Json compatibility)
      const stats = data as unknown as BepaidStatementStats | null;
      
      return stats || {
        payments_count: 0,
        payments_amount: 0,
        refunds_count: 0,
        refunds_amount: 0,
        cancellations_count: 0,
        cancellations_amount: 0,
        errors_count: 0,
        errors_amount: 0,
        commission_total: 0,
        payout_total: 0,
        total_count: 0,
      };
    },
  });
}

// Type for insert/upsert operations
interface BepaidStatementInsert {
  uid: string;
  order_id_bepaid?: string | null;
  status?: string | null;
  description?: string | null;
  amount?: number | null;
  currency?: string | null;
  commission_percent?: number | null;
  commission_per_op?: number | null;
  commission_total?: number | null;
  payout_amount?: number | null;
  transaction_type?: string | null;
  tracking_id?: string | null;
  created_at_bepaid?: string | null;
  paid_at?: string | null;
  payout_date?: string | null;
  expires_at?: string | null;
  message?: string | null;
  shop_id?: string | null;
  shop_name?: string | null;
  business_category?: string | null;
  bank_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  address?: string | null;
  country?: string | null;
  city?: string | null;
  zip?: string | null;
  region?: string | null;
  phone?: string | null;
  ip?: string | null;
  email?: string | null;
  payment_method?: string | null;
  product_code?: string | null;
  card_masked?: string | null;
  card_holder?: string | null;
  card_expires?: string | null;
  card_bin?: string | null;
  bank_name?: string | null;
  bank_country?: string | null;
  secure_3d?: string | null;
  avs_result?: string | null;
  fraud?: string | null;
  auth_code?: string | null;
  rrn?: string | null;
  reason?: string | null;
  payment_identifier?: string | null;
  token_provider?: string | null;
  merchant_id?: string | null;
  merchant_country?: string | null;
  merchant_company?: string | null;
  converted_amount?: number | null;
  converted_currency?: string | null;
  gateway_id?: string | null;
  recurring_type?: string | null;
  card_bin_8?: string | null;
  bank_code?: string | null;
  response_code?: string | null;
  conversion_rate?: number | null;
  converted_payout?: number | null;
  converted_commission?: number | null;
  raw_data?: Json | null;
  import_batch_id?: string | null;
}

export function useBepaidStatementImport() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (rows: BepaidStatementInsert[]) => {
      const batchSize = 100;
      let created = 0;
      let errors = 0;
      const errorDetails: string[] = [];
      
      // PATCH: Pre-deduplicate by UID to prevent "affect row second time" error
      const uniqueRows = Array.from(
        rows.reduce((map, row) => {
          const existing = map.get(row.uid);
          if (!existing) {
            map.set(row.uid, row);
          } else {
            // Merge: keep existing values, overwrite with new non-null values
            const merged = { ...existing };
            for (const [key, value] of Object.entries(row)) {
              if (value !== null && value !== undefined && value !== '') {
                (merged as Record<string, unknown>)[key] = value;
              }
            }
            map.set(row.uid, merged as BepaidStatementInsert);
          }
          return map;
        }, new Map<string, BepaidStatementInsert>())
      ).map(([_, row]) => row);
      
      const duplicatesSkipped = rows.length - uniqueRows.length;
      if (duplicatesSkipped > 0) {
        console.log(`Import: merged ${duplicatesSkipped} duplicate UIDs`);
      }
      
      for (let i = 0; i < uniqueRows.length; i += batchSize) {
        const batch = uniqueRows.slice(i, i + batchSize);
        
        const { error } = await supabase
          .from('bepaid_statement_rows')
          .upsert(
            batch.map(row => ({
              ...row,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: 'uid' }
          );
        
        if (error) {
          console.error('Batch upsert error:', error);
          errorDetails.push(`Batch ${Math.floor(i/batchSize) + 1}: ${error.message}`);
          errors += batch.length;
        } else {
          created += batch.length;
        }
      }
      
      return { 
        created, 
        errors, 
        total: uniqueRows.length,
        duplicatesSkipped,
        errorDetails 
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bepaid-statement'] });
      queryClient.invalidateQueries({ queryKey: ['bepaid-statement-paginated'] });
      queryClient.invalidateQueries({ queryKey: ['bepaid-statement-stats'] });
    },
  });
}
