import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useActiveTrainingContentRules, resolveTrainingContentFilter, isLessonVisible as isLessonAllowed } from "@/hooks/useTrainingContentRules";
import { LessonCardData } from "@/components/training/LessonCard";
import { useMonthGate, type MonthGateLessonInput } from "@/hooks/useMonthGate";

interface ContainerModule {
  id: string;
  slug: string;
  menu_section_key: string;
  product_id?: string | null;
}

interface LessonsBySectionResult {
  lessonsBySection: Record<string, { lessons: LessonCardData[]; moduleSlug: string }>;
  containerModules: ContainerModule[];
  restrictedTariffs: string[];
  isLoading: boolean;
}

/**
 * Fetches lessons from container modules (is_container = true)
 * These lessons display as standalone cards in their sections
 */
export function useContainerLessons(): LessonsBySectionResult & { isAdminUser: boolean } {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const isAdminUser = isAdmin();
  const { data: tcRawData, isLoading: tcLoading } = useActiveTrainingContentRules();
  const tcData = tcRawData && !Array.isArray(tcRawData) ? tcRawData : null;

  const { data, isLoading } = useQuery({
    queryKey: ["container-lessons", user?.id, isAdminUser],
    queryFn: async () => {
      // 1. Get all container modules
      const { data: containers, error: containerError } = await supabase
        .from("training_modules")
        .select("id, slug, menu_section_key, product_id, is_active")
        .eq("is_active", true)
        .eq("is_container", true);

      if (containerError) throw containerError;
      if (!containers?.length) return { containers: [], childModules: [], lessons: [], accessByContainer: {}, tariffNames: {} };

      const containerIds = containers.map((c) => c.id);

      // 1b. Get child modules of containers (non-container children only)
      // PATCH K4: Only fetch active child modules — inactive parent chain = invisible content
      const { data: childModules } = await supabase
        .from("training_modules")
        .select("id, slug, menu_section_key, parent_module_id, product_id, is_active")
        .in("parent_module_id", containerIds)
        .eq("is_active", true)
        .eq("is_container", false);

      const childModuleIds = childModules?.map((c) => c.id) || [];
      const allModuleIds = [...containerIds, ...childModuleIds];

      // 2. Get lessons from container modules AND their children
      const { data: lessons, error: lessonError } = await supabase
        .from("training_lessons")
        .select(`
          id,
          title,
          slug,
          description,
          thumbnail_url,
          duration_minutes,
          created_at,
          published_at,
          sort_order,
          module_id,
          content_month
        `)
        .in("module_id", allModuleIds)
        .eq("is_active", true)
        .order("sort_order", { ascending: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (lessonError) throw lessonError;

      // 3. Get module_access for containers AND children with tariff names
      const { data: containerAccess } = await supabase
        .from("module_access")
        .select("module_id, tariff_id, tariffs(name)")
        .in("module_id", allModuleIds);

      const accessByContainer: Record<string, string[]> = {};
      const tariffNames: Record<string, string> = {};
      
      containerAccess?.forEach((a) => {
        if (!accessByContainer[a.module_id]) {
          accessByContainer[a.module_id] = [];
        }
        accessByContainer[a.module_id].push(a.tariff_id);
        const name = (a.tariffs as any)?.name;
        if (name) {
          tariffNames[a.tariff_id] = name;
        }
      });

      // 4. Get user's active tariff IDs if logged in
      let userTariffIds: string[] = [];
      if (user) {
        const { data: subs } = await supabase
          .from("subscriptions_v2")
          .select("tariff_id")
          .eq("user_id", user.id)
          .in("status", ["active", "trial"]);

        userTariffIds = subs?.map((s) => s.tariff_id).filter(Boolean) || [];
      }

      // PATCH v23.1.5: bulk-query entitlements for product-based access
      let userEntitlementProductIds: string[] = [];
      if (user) {
        const { data: entsData } = await supabase
          .from("entitlements")
          .select("product_id, expires_at")
          .eq("user_id", user.id)
          .eq("status", "active");

        const now = new Date();
        userEntitlementProductIds = (entsData || [])
          .filter(e => e.product_id && (!e.expires_at || new Date(e.expires_at) > now))
          .map(e => e.product_id!);
      }

      return { containers, childModules: childModules || [], lessons: lessons || [], accessByContainer, tariffNames, userTariffIds, userEntitlementProductIds };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Group lessons by section key
  const lessonsBySection: Record<string, { lessons: LessonCardData[]; moduleSlug: string }> = {};
  const containerModules: ContainerModule[] = data?.containers || [];
  const restrictedTariffIds = new Set<string>();

  if (data?.containers && data?.lessons) {
    const containerMap = new Map<string, { slug: string; sectionKey: string; productId: string | null; isActive: boolean }>();
    for (const c of data.containers) {
      containerMap.set(c.id, { slug: c.slug, sectionKey: c.menu_section_key, productId: (c as any).product_id ?? null, isActive: (c as any).is_active ?? true });
    }

    // Map child modules: use own menu_section_key, fallback to parent's; product_id fallback to parent
    if (data.childModules) {
      for (const child of data.childModules) {
        const parent = containerMap.get(child.parent_module_id);
        // PATCH K4: effective active = child is_active AND parent is_active
        const childIsActive = (child as any).is_active ?? true;
        const parentIsActive = parent?.isActive ?? true;
        const effectiveActive = childIsActive && parentIsActive;
        
        containerMap.set(child.id, {
          slug: child.slug || parent?.slug || '',
          sectionKey: child.menu_section_key || parent?.sectionKey || '',
          productId: (child as any).product_id ?? parent?.productId ?? null,
          isActive: effectiveActive,
        });
      }
    }

    const accessByContainer = data.accessByContainer || {};
    const userTariffIds = data.userTariffIds || [];
    const tariffNames = data.tariffNames || {};
    const entitlementProductIds = new Set(data.userEntitlementProductIds || []);

    for (const lesson of data.lessons) {
      const container = containerMap.get(lesson.module_id);
      if (!container) continue;

      // PATCH K4: Effective active guard — lesson invisible if parent module chain inactive
      if (!container.isActive) continue;

      // Filter out scheduled lessons for non-admins
      if (!isAdminUser && lesson.published_at) {
        const publishDate = new Date(lesson.published_at);
        if (publishDate > new Date()) {
          continue; // Skip scheduled lessons for regular users
        }
      }

      const sectionKey = container.sectionKey;
      if (!lessonsBySection[sectionKey]) {
        lessonsBySection[sectionKey] = {
          lessons: [],
          moduleSlug: container.slug,
        };
      }

      // Access check: admin OR no restrictions OR user has required tariff
      // Fallback: if child has no access entries, use parent container's access
      let moduleTariffs = accessByContainer[lesson.module_id] || [];
      if (moduleTariffs.length === 0) {
        // Check if this is a child module — fallback to parent container access
        const childMod = data.childModules?.find(c => c.id === lesson.module_id);
        if (childMod) {
          moduleTariffs = accessByContainer[childMod.parent_module_id] || [];
        }
      }
      // Access precedence: admin → public → tariff → entitlement
      const hasAccess = isAdminUser || 
        moduleTariffs.length === 0 || 
        moduleTariffs.some((tid: string) => userTariffIds.includes(tid)) ||
        (container.productId != null && entitlementProductIds.has(container.productId));

      // PATCH B: training_content filter (only for users with confirmed access, non-admin)
      // Guard: skip tc-filter while rules are still loading (prevents stale filter on refresh)
      let filteredOut = false;
      if (hasAccess && !isAdminUser && !tcLoading && container.productId && tcData) {
        // Find root training for this container
        const rootContainer = data.containers.find(c => c.id === lesson.module_id) || 
          (() => {
            const child = data.childModules?.find(c => c.id === lesson.module_id);
            return child ? data.containers.find(c => c.id === child.parent_module_id) : null;
          })();
        
        if (rootContainer) {
          const filter = resolveTrainingContentFilter(
            tcData.rules, rootContainer.id, container.productId, tcData.userTariffIds, tcData.entitlementTariffsByProduct || {}
          );
          if (filter && filter.mode === "partial") {
            if (!isLessonAllowed(filter, lesson.id, lesson.module_id)) {
              filteredOut = true;
            }
          }
        }
      }

      if (filteredOut) continue;

      // Collect restricted tariff names for banner
      if (!hasAccess && moduleTariffs.length > 0) {
        moduleTariffs.forEach((tid: string) => {
          if (tariffNames[tid]) {
            restrictedTariffIds.add(tariffNames[tid]);
          }
        });
      }

      lessonsBySection[sectionKey].lessons.push({
        id: lesson.id,
        title: lesson.title,
        slug: lesson.slug,
        description: lesson.description,
        cover_image: lesson.thumbnail_url,
        video_duration: lesson.duration_minutes ? lesson.duration_minutes * 60 : null,
        created_at: lesson.created_at,
        published_at: lesson.published_at,
        sort_order: lesson.sort_order ?? 0,
        has_access: hasAccess,
        // Carry through content_month/module_id for month-gate post-processing.
        // (LessonCardData has lock_reason/locked_month; module_id/content_month are extra meta.)
        ...( { module_id: lesson.module_id, content_month: (lesson as any).content_month ?? null } as any),
      });
    }

    // PATCH B: Remove empty sections after filtering
    for (const key of Object.keys(lessonsBySection)) {
      if (lessonsBySection[key].lessons.length === 0) {
        delete lessonsBySection[key];
      }
    }
  }

  return {
    lessonsBySection,
    containerModules,
    restrictedTariffs: Array.from(restrictedTariffIds),
    isLoading,
    isAdminUser,
  };
}
