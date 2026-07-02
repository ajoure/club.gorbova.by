UPDATE site_pages
SET blocks = jsonb_set(
  blocks,
  '{0,content,code}',
  to_jsonb(
    replace(
      blocks->0->'content'->>'code',
      E'function scrollToSection(sectionId) {\n            const el = document.getElementById(sectionId);\n            if (!el) return false;\n            const header = document.querySelector(''header'');\n            const offset = header ? header.offsetHeight + 12 : 90;\n            const top = el.getBoundingClientRect().top + window.pageYOffset - offset;\n            window.scrollTo({ top: top, behavior: ''smooth'' });\n            return false;\n        }',
      E'function scrollToSection(sectionId) {\n            const el = document.getElementById(sectionId);\n            if (!el) return false;\n            try { el.scrollIntoView({ behavior: ''smooth'', block: ''start'' }); } catch (e) { el.scrollIntoView(); }\n            return false;\n        }'
    )
  )
),
updated_at = now()
WHERE id = '7e672fed-13f1-4ff1-8786-71a228a0c011';

SELECT (blocks->0->'content'->>'code') LIKE '%scrollIntoView%' AS ok
FROM site_pages WHERE id = '7e672fed-13f1-4ff1-8786-71a228a0c011';