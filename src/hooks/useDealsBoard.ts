import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { moveDealToStage } from "@/services/pipelineService";
import { toast } from "sonner";
import type { CrmPipelineStage } from "@/services/pipelineService";
import { applyExtraDealFilters } from "@/utils/applyExtraDealFilters";
import type { DealsExtraFilters } from "@/hooks/useDealsFilters";

export interface BoardDeal {
  id: string;
  order_number: string;
  status: string;
  final_price: number | null;
  currency: string | null;
  updated_at: string;
  created_at: string;
  pipeline_stage_id: string | null;
  pipeline_id: string | null;
  product_name: string | null;
  tariff_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_avatar: string | null;
  is_trial: boolean;
}

interface UseDealsBoardOpts {
  pipelineId: string | null;
  isDefaultPipeline?: boolean;
  search?: string;
  productId?: string | null;
  tariffIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  extraFilters?: DealsExtraFilters;
}

export function useDealsBoard({ pipelineId, isDefaultPipeline, search, productId, tariffIds, dateFrom, dateTo, extraFilters }: UseDealsBoardOpts) {
  const qc = useQueryClient();
  const queryKey = ["deals-board", pipelineId, isDefaultPipeline, search, productId, tariffIds, dateFrom, dateTo, extraFilters];

  const { data: deals = [], isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<BoardDeal[]> => {
      if (!pipelineId) return [];

      let q = supabase
        .from("orders_v2")
        .select(`
          id, order_number, status, final_price, currency,
          updated_at, created_at, pipeline_stage_id, pipeline_id,
          is_trial,
          products_v2(name),
          tariffs(name),
          profiles:profile_id(full_name, email, avatar_url)
        `);

      // Default pipeline: show its own deals + unassigned (NULL) deals
      if (isDefaultPipeline) {
        q = q.or(`pipeline_id.eq.${pipelineId},pipeline_id.is.null`);
      } else {
        q = q.eq("pipeline_id", pipelineId);
      }

      if (productId) q = q.eq("product_id", productId);
      if (tariffIds && tariffIds.length > 0) {
        q = q.in("tariff_id", tariffIds);
      }
      if (search) {
        q = q.or(`order_number.ilike.%${search}%,customer_email.ilike.%${search}%`);
      }

      // Date filter — same contract as list-view buildDealsQuery
      if (dateFrom) {
        q = q.gte("deal_date", `${dateFrom}T00:00:00Z`);
      }
      if (dateTo) {
        q = q.lte("deal_date", `${dateTo}T23:59:59Z`);
      }

      // Apply canonical extra filters server-side
      if (extraFilters) {
        q = applyExtraDealFilters(q, extraFilters);
      }

      q = q.order("updated_at", { ascending: false }).order("id", { ascending: false });

      // Fetch all pages (Supabase returns max 1000 per request)
      const PAGE = 1000;
      let allData: any[] = [];
      let offset = 0;
      while (true) {
        const { data: page, error } = await q.range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!page || page.length === 0) break;
        allData = allData.concat(page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }

      return allData.map((d: any) => ({
        id: d.id,
        order_number: d.order_number,
        status: d.status,
        final_price: d.final_price,
        currency: d.currency,
        updated_at: d.updated_at,
        created_at: d.created_at,
        pipeline_stage_id: d.pipeline_stage_id,
        pipeline_id: d.pipeline_id,
        product_name: d.products_v2?.name || null,
        tariff_name: d.tariffs?.name || null,
        contact_name: d.profiles?.full_name || null,
        contact_email: d.profiles?.email || null,
        contact_avatar: d.profiles?.avatar_url || null,
        is_trial: d.is_trial || false,
      }));
    },
    enabled: !!pipelineId,
    staleTime: 15_000,
  });

  const moveMut = useMutation({
    mutationFn: async ({
      dealId,
      newStageId,
      oldStageId,
    }: {
      dealId: string;
      newStageId: string;
      oldStageId: string | null;
    }) => {
      await moveDealToStage(dealId, pipelineId!, newStageId, oldStageId);
    },
    onMutate: async ({ dealId, newStageId }) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<BoardDeal[]>(queryKey);
      qc.setQueryData<BoardDeal[]>(queryKey, (old) =>
        (old || []).map((d) =>
          d.id === dealId ? { ...d, pipeline_stage_id: newStageId } : d
        )
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      toast.error("Ошибка перемещения сделки");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  // Group deals by stage
  function groupByStage(stages: CrmPipelineStage[]) {
    const groups: Record<string, BoardDeal[]> = { __unassigned: [] };
    for (const s of stages) groups[s.id] = [];
    for (const d of deals) {
      const key = d.pipeline_stage_id && groups[d.pipeline_stage_id] ? d.pipeline_stage_id : "__unassigned";
      groups[key].push(d);
    }
    return groups;
  }

  function getStageTotals(stageDeals: BoardDeal[]) {
    let sum = 0;
    let count = 0;
    for (const d of stageDeals) {
      count++;
      sum += Number(d.final_price || 0);
    }
    return { count, sum, avg: count > 0 ? sum / count : 0 };
  }

  return {
    deals,
    isLoading,
    moveDeal: moveMut.mutate,
    groupByStage,
    getStageTotals,
  };
}
