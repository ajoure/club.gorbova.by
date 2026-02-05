 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 
 export interface ServerPaymentsStats {
   total_count: number;
   successful_count: number;
   successful_amount: number;
   refunded_count: number;
   refunded_amount: number;
   cancelled_count: number;
   cancelled_amount: number;
   failed_count: number;
   failed_amount: number;
   processing_count: number;
   processing_amount: number;
   commission_total: number;
 }
 
 export function usePaymentsServerStats(dateFilter: { from: string; to?: string }) {
   return useQuery({
     queryKey: ['payments-server-stats', dateFilter.from, dateFilter.to],
     queryFn: async () => {
       const fromDate = `${dateFilter.from}T00:00:00+03:00`;
       const toDate = `${dateFilter.to || dateFilter.from}T23:59:59+03:00`;
       
       const { data, error } = await supabase.rpc('admin_get_payments_stats_v1', {
         p_from: fromDate,
         p_to: toDate,
         p_provider: 'bepaid',
       });
       
       if (error) {
         console.error('[usePaymentsServerStats] RPC error:', error);
         throw error;
       }
       
       // Parse the JSONB result
       const result = data as unknown as ServerPaymentsStats;
       return {
         total_count: Number(result?.total_count ?? 0),
         successful_count: Number(result?.successful_count ?? 0),
         successful_amount: Number(result?.successful_amount ?? 0),
         refunded_count: Number(result?.refunded_count ?? 0),
         refunded_amount: Number(result?.refunded_amount ?? 0),
         cancelled_count: Number(result?.cancelled_count ?? 0),
         cancelled_amount: Number(result?.cancelled_amount ?? 0),
         failed_count: Number(result?.failed_count ?? 0),
         failed_amount: Number(result?.failed_amount ?? 0),
         processing_count: Number(result?.processing_count ?? 0),
         processing_amount: Number(result?.processing_amount ?? 0),
         commission_total: Number(result?.commission_total ?? 0),
       };
     },
     staleTime: 30000, // 30 seconds
     refetchOnWindowFocus: false,
   });
 }