WITH target AS (
  SELECT id, blocks->0->>'content' AS content
  FROM public.site_pages
  WHERE slug = 'cb'
  LIMIT 1
), checked AS (
  SELECT
    id,
    content,
    '    rec.parentNode.insertBefore(wrap, rec.nextSibling);'::text AS insert_needle,
    '  var attempts=0, lastStatus=''pending'';'::text AS vars_needle,
    '    if(lastStatus===''built''||lastStatus===''exists'') return;'::text AS return_needle
  FROM target
), guarded AS (
  SELECT *
  FROM checked
  WHERE position('function syncRecVisibility' in content) = 0
    AND ((length(content)-length(replace(content, insert_needle, ''))) / length(insert_needle)) = 1
    AND ((length(content)-length(replace(content, vars_needle, ''))) / length(vars_needle)) = 1
    AND ((length(content)-length(replace(content, return_needle, ''))) / length(return_needle)) = 1
), patched AS (
  SELECT
    id,
    replace(
      replace(
        replace(
          content,
          insert_needle,
          '    rec.parentNode.insertBefore(wrap, rec.nextSibling);' || E'\n    syncRecVisibility();'
        ),
        vars_needle,
        '  var attempts=0, lastStatus=''pending'';' || E'\n  function isMobile(){ return window.matchMedia ? window.matchMedia(''(max-width: 767px)'').matches : window.innerWidth <= 767; }\n  function syncRecVisibility(){\n    var rec=document.getElementById(''rec1219722591'');\n    var clone=document.querySelector(''.lv-mobile-tariffs-v4[data-lv-marker="''+MARKER+''"][data-lv-status="ok"]'');\n    if(!rec) return;\n    if(clone && isMobile()){ rec.style.display=''none''; clone.style.display=''block''; }\n    else { rec.style.display=''''; if(clone){ clone.style.display=''''; } }\n  }'
      ),
      return_needle,
      '    if(lastStatus===''built''||lastStatus===''exists''){ syncRecVisibility(); return; }'
    ) AS new_content
  FROM guarded
), updated AS (
  UPDATE public.site_pages sp
  SET blocks = jsonb_set(sp.blocks, '{0,content}', to_jsonb(patched.new_content)),
      updated_at = now()
  FROM patched
  WHERE sp.id = patched.id
  RETURNING sp.id
)
SELECT CASE WHEN count(*) = 1 THEN 'ok' ELSE 'abort_guard_no_update' END AS result, count(*) AS updated_rows
FROM updated;