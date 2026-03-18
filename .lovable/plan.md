

# Plan: Tags, Move Page, Copy Page — Final

## Corrections Applied (this revision)

1. **RLS for `site_page_tag_links`**: Policy now checks workspace on BOTH sides — via `site_page_tags` AND `site_pages`.
2. **Service-level invariant in `addTagToPage`**: Validates page and tag belong to same `workspace_id` before insert.
3. **`updated_at` trigger**: Added for `site_page_tags` (auto-update on row modification).
4. **Index on `tag_id`**: Added for `site_page_tag_links` to support `getTagPages(tagId)` efficiently.

## Database Migration

```sql
-- 1. Register public_id sequence
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('site_page_tag', 'TAG', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- 2. Tags table (full entity standard)
CREATE TABLE public.site_page_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT '',
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

-- 3. public_id trigger
CREATE OR REPLACE FUNCTION public.set_site_page_tag_public_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('site_page_tag');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_site_page_tags_public_id
  BEFORE INSERT ON public.site_page_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_site_page_tag_public_id();

-- 4. updated_at trigger
CREATE OR REPLACE FUNCTION public.set_site_page_tag_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_site_page_tags_updated_at
  BEFORE UPDATE ON public.site_page_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_site_page_tag_updated_at();

-- 5. Link table (EXCEPTION: junction only, no entity fields)
CREATE TABLE public.site_page_tag_links (
  page_id uuid NOT NULL REFERENCES public.site_pages(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.site_page_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, tag_id)
);

-- 6. Index for getTagPages(tagId) lookups
CREATE INDEX idx_site_page_tag_links_tag_id ON public.site_page_tag_links(tag_id);

-- 7. RLS
ALTER TABLE public.site_page_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_page_tag_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage workspace tags"
  ON public.site_page_tags FOR ALL TO authenticated
  USING (
    workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  )
  WITH CHECK (
    workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  );

-- Tag links: workspace isolation via BOTH tag and page
CREATE POLICY "Admins manage tag links in workspace"
  ON public.site_page_tag_links FOR ALL TO authenticated
  USING (
    (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    AND EXISTS (
      SELECT 1 FROM public.site_page_tags t
      WHERE t.id = tag_id
      AND t.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
    AND EXISTS (
      SELECT 1 FROM public.site_pages p
      WHERE p.id = page_id
      AND p.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    AND EXISTS (
      SELECT 1 FROM public.site_page_tags t
      WHERE t.id = tag_id
      AND t.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
    AND EXISTS (
      SELECT 1 FROM public.site_pages p
      WHERE p.id = page_id
      AND p.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
```

### Architecture Decision: `site_page_tag_links`

Link-table exception to global entity structure. No `public_id`, `metadata`, `created_by/updated_by`. Stores only `(page_id, tag_id)` relationship. Dedicated `tag_id` index for reverse lookups. Business events written by `SiteTagService`.

## Service Layer

### New: `src/services/sitePages/SiteTagService.ts`

All 4 state-changing operations: `emitEvent()` → DB → `recordExecution(eventId, step, status)` → `writeAudit()`.

| Method | Event Type | Execution Step |
|---|---|---|
| `createTag(name)` | `site.tag.created` | `create_tag` |
| `deleteTag(id)` | `site.tag.deleted` | `delete_tag` |
| `addTagToPage(pageId, tagId)` | `site.tag.linked` | `link_tag` |
| `removeTagFromPage(pageId, tagId)` | `site.tag.unlinked` | `unlink_tag` |
| `listTags()` | — | — |
| `getPageTags(pageId)` | — | — |

**`addTagToPage` invariant check** (before insert):
```typescript
async addTagToPage(pageId: string, tagId: string) {
  // 1. Fetch page.workspace_id and tag.workspace_id
  const [{ data: page }, { data: tag }] = await Promise.all([
    supabase.from("site_pages").select("workspace_id").eq("id", pageId).single(),
    supabase.from("site_page_tags").select("workspace_id").eq("id", tagId).single(),
  ]);
  if (!page || !tag) throw new Error("Page or tag not found");
  if (page.workspace_id !== tag.workspace_id) {
    throw new Error("Cannot link page and tag from different workspaces");
  }
  // 2. Proceed with insert + event + execution + audit
}
```

### Modified: `src/services/sitePages/SitePageService.ts`

| Method | Event Type | Execution Step |
|---|---|---|
| `copyPage(id)` | `site.page.copied` | `copy_page` |
| `movePage(id, folderId)` | `site.page.moved` | `move_page` |

`copyPage`: clones page + tag links, unique slug (`-copy`, `-copy-2`…`-copy-10`, UUID fallback), new UUID, `created_by`/`updated_by` = current user.

`movePage`: updates only `folder_id`. `null` = move to root.

**Total: 6 state-changing operations.**

## Types: `src/services/sitePages/types.ts`

Add `SitePageTag` (full entity) and `SitePageTagLink` (junction).

## Hooks

- **New `src/hooks/useSiteTags.tsx`**: `tags`, `createTag`, `deleteTag`, `addTagToPage`, `removeTagFromPage`, `getPageTags`
- **Modified `src/hooks/useSitePages.tsx`**: `copyPage`, `movePage` mutations

## UI: `src/pages/admin/AdminSiteBuilder.tsx`

- Page card dropdown (⋮): Переместить (folder dialog), Копировать, Удалить
- Tag filter chips above grid
- Tag badges on cards + assignment popover + inline "Создать тег"

## Files

| Action | File |
|---|---|
| Create | `src/services/sitePages/SiteTagService.ts` |
| Create | `src/hooks/useSiteTags.tsx` |
| Modify | `src/services/sitePages/SitePageService.ts` |
| Modify | `src/services/sitePages/types.ts` |
| Modify | `src/services/sitePages/index.ts` |
| Modify | `src/hooks/useSitePages.tsx` |
| Modify | `src/pages/admin/AdminSiteBuilder.tsx` |

## VERIFY

- [ ] `site_page_tags.workspace_id` is `uuid NOT NULL`
- [ ] `updated_at` trigger auto-updates on row modification
- [ ] RLS on `site_page_tags` isolates by `workspace_id` + admin/super_admin
- [ ] RLS on `site_page_tag_links` checks workspace via BOTH `site_page_tags` AND `site_pages`
- [ ] `addTagToPage` validates same `workspace_id` before insert
- [ ] `created_by`/`updated_by` NOT NULL, set by service layer
- [ ] `idx_site_page_tag_links_tag_id` index exists
- [ ] `site_page_tag_links` documented as link-table exception
- [ ] Tag operations use `tag_id` + `page_id` (UUID only)
- [ ] `copyPage` creates new UUID + unique slug (collision-safe)
- [ ] `copyPage` copies tag links from source page
- [ ] `movePage` changes only `folder_id`
- [ ] All 6 state-changing operations: `emitEvent()` → DB → `recordExecution()` → `writeAudit()`
- [ ] Existing page/folder/publish CRUD unchanged

