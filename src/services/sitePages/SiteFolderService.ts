import { supabase } from "@/integrations/supabase/client";
import type { SitePageFolder, CreateSiteFolderData, UpdateSiteFolderData } from "./types";

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data?.user?.id) throw new Error("Not authenticated");
  return data.user.id;
}

export class SiteFolderService {
  static async listFolders(): Promise<SitePageFolder[]> {
    const { data, error } = await (supabase
      .from("site_page_folders") as any)
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw new Error(`Failed to list folders: ${error.message}`);
    return (data || []) as SitePageFolder[];
  }

  static async createFolder(input: CreateSiteFolderData): Promise<SitePageFolder> {
    const userId = await getCurrentUserId();

    const { data, error } = await (supabase
      .from("site_page_folders") as any)
      .insert({
        name: input.name,
        parent_id: input.parent_id || null,
        created_by: userId,
      })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create folder: ${error.message}`);
    return data as SitePageFolder;
  }

  static async updateFolder(id: string, input: UpdateSiteFolderData): Promise<SitePageFolder> {
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.parent_id !== undefined) updateData.parent_id = input.parent_id;
    if (input.sort_order !== undefined) updateData.sort_order = input.sort_order;

    const { data, error } = await (supabase
      .from("site_page_folders") as any)
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to update folder: ${error.message}`);
    return data as SitePageFolder;
  }

  static async deleteFolder(id: string): Promise<void> {
    const { error } = await (supabase
      .from("site_page_folders") as any)
      .delete()
      .eq("id", id);

    if (error) throw new Error(`Failed to delete folder: ${error.message}`);
  }
}
