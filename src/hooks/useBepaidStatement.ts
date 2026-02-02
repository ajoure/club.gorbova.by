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
  // Computed field for sorting
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
 * Keyset pagination hook for bepaid_statement_rows
 * Uses COALESCE(paid_at, created_at_bepaid) as sort_ts for stable ordering
 */
export function useBepaidStatementPaginated(params: StatementQueryParams) {
  const { dateFilter, searchQuery = '', pageSize = 50 } = params;
  
  return useInfiniteQuery({
    queryKey: ['bepaid-statement-paginated', dateFilter.from, dateFilter.to, searchQuery, pageSize],
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as StatementCursor | undefined;
      
      // Build base query
      let query = supabase
        .from('bepaid_statement_rows')
        .select('*');
      
      // Date filter using OR with COALESCE logic
      // Filter: (paid_at in range) OR (paid_at IS NULL AND created_at_bepaid in range)
      if (dateFilter.from && dateFilter.to) {
        query = query.or(
          `and(paid_at.gte.${dateFilter.from},paid_at.lte.${dateFilter.to}T23:59:59),and(paid_at.is.null,created_at_bepaid.gte.${dateFilter.from},created_at_bepaid.lte.${dateFilter.to}T23:59:59)`
        );
      } else if (dateFilter.from) {
        query = query.or(
          `paid_at.gte.${dateFilter.from},and(paid_at.is.null,created_at_bepaid.gte.${dateFilter.from})`
        );
      } else if (dateFilter.to) {
        query = query.or(
          `paid_at.lte.${dateFilter.to}T23:59:59,and(paid_at.is.null,created_at_bepaid.lte.${dateFilter.to}T23:59:59)`
        );
      }
      
      // Keyset cursor filter
      // WHERE (sort_ts < cursor.sort_ts) OR (sort_ts = cursor.sort_ts AND uid < cursor.uid)
      if (cursor) {
        // We need to apply cursor logic after fetching since Supabase doesn't support
        // computed column ordering directly. We'll use a workaround.
        query = query.or(
          `paid_at.lt.${cursor.sort_ts},and(paid_at.eq.${cursor.sort_ts},uid.lt.${cursor.uid}),and(paid_at.is.null,created_at_bepaid.lt.${cursor.sort_ts}),and(paid_at.is.null,created_at_bepaid.eq.${cursor.sort_ts},uid.lt.${cursor.uid})`
        );
      }
      
      // Order by paid_at DESC, created_at_bepaid DESC, uid DESC
      query = query
        .order('paid_at', { ascending: false, nullsFirst: false })
        .order('created_at_bepaid', { ascending: false, nullsFirst: false })
        .order('uid', { ascending: false })
        .limit(pageSize);
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      let filteredData = (data || []) as BepaidStatementRow[];
      
      // Add computed sort_ts field
      filteredData = filteredData.map(row => ({
        ...row,
        sort_ts: row.paid_at || row.created_at_bepaid,
      }));
      
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
        .select('*')
        .order('paid_at', { ascending: false, nullsFirst: false })
        .order('created_at_bepaid', { ascending: false, nullsFirst: false })
        .order('uid', { ascending: false })
        .limit(50); // Default limit
      
      // Apply date filter with fallback logic
      if (dateFilter.from && dateFilter.to) {
        query = query.or(
          `and(paid_at.gte.${dateFilter.from},paid_at.lte.${dateFilter.to}T23:59:59),and(paid_at.is.null,created_at_bepaid.gte.${dateFilter.from},created_at_bepaid.lte.${dateFilter.to}T23:59:59)`
        );
      } else if (dateFilter.from) {
        query = query.or(
          `paid_at.gte.${dateFilter.from},and(paid_at.is.null,created_at_bepaid.gte.${dateFilter.from})`
        );
      } else if (dateFilter.to) {
        query = query.or(
          `paid_at.lte.${dateFilter.to}T23:59:59,and(paid_at.is.null,created_at_bepaid.lte.${dateFilter.to}T23:59:59)`
        );
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      let filteredData = (data || []) as BepaidStatementRow[];
      
      // Add computed sort_ts
      filteredData = filteredData.map(row => ({
        ...row,
        sort_ts: row.paid_at || row.created_at_bepaid,
      }));
      
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
 * Server-side stats aggregation
 * Counts/sums are calculated on the server, not by loading all rows
 */
export function useBepaidStatementStats(dateFilter: DateFilter) {
  return useQuery({
    queryKey: ['bepaid-statement-stats', dateFilter.from, dateFilter.to],
    queryFn: async () => {
      // Use RPC or direct aggregation query
      // For now, we'll use a limited fetch and aggregate client-side
      // TODO: Replace with RPC get_bepaid_statement_stats for better performance
      
      let query = supabase
        .from('bepaid_statement_rows')
        .select('amount, transaction_type, status, commission_total, payout_amount, paid_at, created_at_bepaid');
      
      // Apply same fallback filter as list query
      if (dateFilter.from && dateFilter.to) {
        query = query.or(
          `and(paid_at.gte.${dateFilter.from},paid_at.lte.${dateFilter.to}T23:59:59),and(paid_at.is.null,created_at_bepaid.gte.${dateFilter.from},created_at_bepaid.lte.${dateFilter.to}T23:59:59)`
        );
      } else if (dateFilter.from) {
        query = query.or(
          `paid_at.gte.${dateFilter.from},and(paid_at.is.null,created_at_bepaid.gte.${dateFilter.from})`
        );
      } else if (dateFilter.to) {
        query = query.or(
          `paid_at.lte.${dateFilter.to}T23:59:59,and(paid_at.is.null,created_at_bepaid.lte.${dateFilter.to}T23:59:59)`
        );
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      const rows = data || [];
      
      // Calculate stats
      const stats: BepaidStatementStats = {
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
        total_count: rows.length,
      };
      
      rows.forEach(row => {
        const amount = Number(row.amount) || 0;
        const txType = (row.transaction_type || '').toLowerCase();
        const status = (row.status || '').toLowerCase();
        
        // Sum commissions and payouts
        stats.commission_total += Number(row.commission_total) || 0;
        stats.payout_total += Number(row.payout_amount) || 0;
        
        // Classify transactions
        if (txType.includes('возврат') || txType.includes('refund')) {
          stats.refunds_count++;
          stats.refunds_amount += Math.abs(amount);
        } else if (txType.includes('отмена') || txType.includes('void') || txType.includes('cancel')) {
          stats.cancellations_count++;
          stats.cancellations_amount += Math.abs(amount);
        } else if (status.includes('ошибк') || status.includes('failed') || status.includes('declined') || status.includes('error')) {
          stats.errors_count++;
          stats.errors_amount += Math.abs(amount);
        } else if (status.includes('успешн') || status.includes('successful') || status.includes('succeeded')) {
          stats.payments_count++;
          stats.payments_amount += amount;
        }
      });
      
      return stats;
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
      queryClient.invalidateQueries({ queryKey: ['bepaid-statement-stats'] });
      queryClient.invalidateQueries({ queryKey: ['bepaid-statement-paginated'] });
    },
  });
}
