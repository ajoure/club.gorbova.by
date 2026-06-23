#!/usr/bin/env python3
"""SITE-000018: final hero layout patch.

Scope: only public.site_pages.blocks[0].content.code for page
7e672fed-13f1-4ff1-8786-71a228a0c011.

The patch replaces the accumulated conflicting hero override CSS with one
final block and moves the guarantee card out of the absolute overlay zone into
the same HTML document immediately after the hero section.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
from pathlib import Path


PAGE_ID = "7e672fed-13f1-4ff1-8786-71a228a0c011"
ARTIFACT_DIR = Path(".lovable/artifacts")
BEFORE = ARTIFACT_DIR / "site018-hero-layout-final-before.html"
AFTER = ARTIFACT_DIR / "site018-hero-layout-final-after.html"


FINAL_STYLE = r'''<style id="hero-fullbleed-override">
/* lovable-hero-layout-final-v1: one SOT override for SITE-000018 hero geometry */

@media (min-width: 1025px) {
  .ir-hero-v2 {
    box-sizing: border-box !important;
    position: relative !important;
    display: block !important;
    height: calc(100vh - 64px) !important;
    min-height: 640px !important;
    max-height: 780px !important;
    padding: 0 0 56px !important;
    margin: 0 !important;
    overflow: hidden !important;
    background: #0f172a !important;
    border-bottom: 0 !important;
    isolation: isolate !important;
  }

  .ir-hero-v2::after {
    content: "" !important;
    position: absolute !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    height: 86px !important;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, #0f172a 72%, #0f172a 100%) !important;
    pointer-events: none !important;
    z-index: 1 !important;
  }

  .ir-hero-v2 .ir-hero-v2__wrap {
    box-sizing: border-box !important;
    width: min(1280px, 100%) !important;
    height: 100% !important;
    min-height: 0 !important;
    margin: 0 auto !important;
    padding: 22px 24px 0 !important;
    display: grid !important;
    grid-template-columns: minmax(0, 54%) minmax(0, 46%) !important;
    gap: 24px !important;
    align-items: stretch !important;
    position: relative !important;
    z-index: 2 !important;
  }

  .ir-hero-v2 .ir-hero-v2__content {
    box-sizing: border-box !important;
    height: 100% !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 10px 30px 0 24px !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-start !important;
    overflow: visible !important;
    background: transparent !important;
    background-image: none !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }

  .ir-hero-v2 .ir-hero-v2__content::before,
  .ir-hero-v2 .ir-hero-v2__content::after {
    display: none !important;
  }

  .ir-hero-v2 .ir-hero-v2__badge {
    margin: 0 0 16px !important;
    min-height: 28px !important;
  }

  .ir-hero-v2 .ir-hero-v2__title {
    max-width: 640px !important;
    margin: 0 0 16px !important;
    font-size: clamp(38px, 3.65vw, 56px) !important;
    line-height: 0.97 !important;
    letter-spacing: -0.052em !important;
  }

  .ir-hero-v2 .ir-hero-v2__text {
    max-width: 620px !important;
    margin: 0 !important;
    font-size: 15.5px !important;
    line-height: 1.43 !important;
  }

  .ir-hero-v2 .ir-hero-v2__checks {
    max-width: 575px !important;
    margin: 24px 0 0 !important;
    gap: 12px 28px !important;
  }

  .ir-hero-v2 .ir-hero-v2__check {
    font-size: 13.5px !important;
    gap: 10px !important;
  }

  .ir-hero-v2 .ir-hero-v2__check-icon {
    width: 20px !important;
    height: 20px !important;
    flex-basis: 20px !important;
  }

  .ir-hero-v2 .ir-hero-v2__actions {
    box-sizing: border-box !important;
    width: 100% !important;
    max-width: 575px !important;
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: stretch !important;
    gap: 12px !important;
    margin: 26px 0 56px !important;
    padding: 0 !important;
    overflow: visible !important;
    position: relative !important;
    z-index: 4 !important;
  }

  .ir-hero-v2 .ir-hero-v2__actions .ir-hero-v2__btn {
    box-sizing: border-box !important;
    flex: 1 1 0 !important;
    width: auto !important;
    min-width: 0 !important;
    height: 54px !important;
    min-height: 54px !important;
    padding: 0 18px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    text-align: center !important;
    white-space: normal !important;
    line-height: 1.15 !important;
    font-size: 13.5px !important;
    overflow: visible !important;
  }

  .ir-hero-v2 .ir-hero-v2__visual {
    box-sizing: border-box !important;
    position: relative !important;
    z-index: 2 !important;
    height: 100% !important;
    min-height: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: transparent !important;
    border: 0 !important;
    border-radius: 0 !important;
  }

  .ir-hero-v2 .ir-hero-v2__visual::after {
    content: "" !important;
    display: block !important;
    position: absolute !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    height: 34% !important;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgba(15, 23, 42, 0.72) 74%, #0f172a 100%) !important;
    pointer-events: none !important;
    z-index: 3 !important;
  }

  .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    object-fit: contain !important;
    object-position: center bottom !important;
    transform: none !important;
    filter: drop-shadow(0 28px 35px rgba(0,0,0,.24)) !important;
    display: block !important;
  }
}

@media (min-width: 1025px) and (max-height: 820px) {
  .ir-hero-v2 {
    min-height: 620px !important;
    max-height: none !important;
    padding-bottom: 52px !important;
  }

  .ir-hero-v2 .ir-hero-v2__wrap {
    padding-top: 18px !important;
    gap: 20px !important;
  }

  .ir-hero-v2 .ir-hero-v2__content {
    padding-top: 8px !important;
    padding-left: 22px !important;
    padding-right: 24px !important;
  }

  .ir-hero-v2 .ir-hero-v2__badge {
    margin-bottom: 14px !important;
    padding-top: 7px !important;
    padding-bottom: 7px !important;
    font-size: 11px !important;
  }

  .ir-hero-v2 .ir-hero-v2__title {
    font-size: clamp(35px, 3.5vw, 48px) !important;
    line-height: 0.96 !important;
    margin-bottom: 14px !important;
  }

  .ir-hero-v2 .ir-hero-v2__text {
    font-size: 14.5px !important;
    line-height: 1.38 !important;
  }

  .ir-hero-v2 .ir-hero-v2__checks {
    margin-top: 20px !important;
    gap: 10px 24px !important;
  }

  .ir-hero-v2 .ir-hero-v2__check {
    font-size: 13px !important;
  }

  .ir-hero-v2 .ir-hero-v2__actions {
    margin-top: 22px !important;
    margin-bottom: 52px !important;
  }

  .ir-hero-v2 .ir-hero-v2__actions .ir-hero-v2__btn {
    height: 50px !important;
    min-height: 50px !important;
    font-size: 13px !important;
    border-radius: 9px !important;
  }
}

.ir-hero-guarantee-strip {
  box-sizing: border-box !important;
  background: #0f172a !important;
  padding: 0 24px 26px !important;
  margin: 0 !important;
  border: 0 !important;
}

.ir-hero-guarantee-strip__wrap {
  width: min(1180px, 100%) !important;
  margin: 0 auto !important;
}

.ir-hero-guarantee-strip .ir-hero-glass {
  position: static !important;
  inset: auto !important;
  width: 100% !important;
  max-width: none !important;
  box-sizing: border-box !important;
  display: grid !important;
  grid-template-columns: auto minmax(0, 1fr) auto !important;
  align-items: center !important;
  gap: 18px !important;
  margin: 0 !important;
  padding: 14px 18px !important;
  border-radius: 18px !important;
  background: rgba(15, 23, 34, 0.72) !important;
  border: 1px solid rgba(255,255,255,0.12) !important;
  box-shadow: 0 22px 48px -26px rgba(0,0,0,0.65) !important;
  -webkit-backdrop-filter: blur(16px) saturate(135%) !important;
  backdrop-filter: blur(16px) saturate(135%) !important;
}

.ir-hero-guarantee-strip .ir-hero-glass__label {
  margin: 0 !important;
  white-space: nowrap !important;
  align-self: center !important;
}

.ir-hero-guarantee-strip .ir-hero-glass__grid {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 14px !important;
  min-width: 0 !important;
}

.ir-hero-guarantee-strip .ir-hero-glass__item {
  display: flex !important;
  align-items: flex-start !important;
  gap: 10px !important;
  min-width: 0 !important;
}

.ir-hero-guarantee-strip .ir-hero-glass__icon {
  width: 32px !important;
  height: 32px !important;
  flex: 0 0 32px !important;
}

.ir-hero-guarantee-strip .ir-hero-glass__body h3 {
  font-size: 13.5px !important;
  line-height: 1.15 !important;
  margin: 0 0 3px !important;
}

.ir-hero-guarantee-strip .ir-hero-glass__body p {
  font-size: 11.5px !important;
  line-height: 1.3 !important;
  margin: 0 !important;
}

.ir-hero-guarantee-strip .ir-hero-glass__stats {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-end !important;
  justify-content: center !important;
  gap: 4px !important;
  min-width: 132px !important;
  padding: 0 0 0 16px !important;
  border-top: 0 !important;
  border-left: 1px solid rgba(255,255,255,0.10) !important;
  font-size: 11.5px !important;
  text-align: right !important;
}

.ir-hero-v2 + .ir-hero-guarantee-strip,
.ir-hero-guarantee-strip + * {
  margin-top: 0 !important;
}

@media (max-width: 1024px) {
  .ir-hero-v2 {
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
    padding-bottom: 0 !important;
    overflow: visible !important;
  }

  .ir-hero-v2 .ir-hero-v2__wrap {
    height: auto !important;
    min-height: auto !important;
    display: block !important;
    padding: 24px 18px 0 !important;
  }

  .ir-hero-v2 .ir-hero-v2__content {
    display: block !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  .ir-hero-v2 .ir-hero-v2__title {
    font-size: clamp(36px, 10.6vw, 48px) !important;
    line-height: 0.98 !important;
    margin: 18px 0 16px !important;
  }

  .ir-hero-v2 .ir-hero-v2__text {
    font-size: 15px !important;
    line-height: 1.45 !important;
  }

  .ir-hero-v2 .ir-hero-v2__checks {
    grid-template-columns: 1fr !important;
    gap: 12px !important;
    margin-top: 24px !important;
  }

  .ir-hero-v2 .ir-hero-v2__actions {
    display: flex !important;
    flex-direction: column !important;
    gap: 12px !important;
    margin: 28px 0 24px !important;
    max-width: none !important;
    width: 100% !important;
  }

  .ir-hero-v2 .ir-hero-v2__actions .ir-hero-v2__btn {
    width: 100% !important;
    min-height: 52px !important;
    height: auto !important;
  }

  .ir-hero-v2 .ir-hero-v2__visual {
    position: relative !important;
    height: 430px !important;
    min-height: 430px !important;
    overflow: hidden !important;
  }

  .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
    object-position: center bottom !important;
    transform: none !important;
  }

  .ir-hero-guarantee-strip {
    padding: 16px 16px 24px !important;
  }

  .ir-hero-guarantee-strip .ir-hero-glass {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    padding: 16px !important;
    gap: 14px !important;
  }

  .ir-hero-guarantee-strip .ir-hero-glass__label {
    align-self: flex-start !important;
  }

  .ir-hero-guarantee-strip .ir-hero-glass__grid {
    grid-template-columns: 1fr !important;
    gap: 12px !important;
  }

  .ir-hero-guarantee-strip .ir-hero-glass__stats {
    min-width: 0 !important;
    align-items: flex-start !important;
    text-align: left !important;
    padding: 12px 0 0 !important;
    border-left: 0 !important;
    border-top: 1px solid rgba(255,255,255,0.10) !important;
  }
}
/* /lovable-hero-layout-final-v1 */
</style>'''


def run_psql(sql: str) -> str:
    return subprocess.check_output(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-Atqc", sql],
        text=True,
    )


def locate_balanced_div(html: str, class_name: str, search_start: int = 0) -> tuple[int, int]:
    m = re.search(r'<div\b(?=[^>]*class=["\'][^"\']*\b' + re.escape(class_name) + r'\b)', html[search_start:], re.I)
    if not m:
        raise ValueError(f"div.{class_name} not found")
    start = search_start + m.start()
    token_re = re.compile(r'</?div\b[^>]*>', re.I)
    depth = 0
    for t in token_re.finditer(html, start):
        token = t.group(0)
        if token.lower().startswith('</div'):
            depth -= 1
            if depth == 0:
                return start, t.end()
        else:
            depth += 1
    raise ValueError(f"div.{class_name} is not balanced")


def remove_existing_guarantee_strip(html: str) -> str:
    marker = '<section class="ir-hero-guarantee-strip"'
    idx = html.find(marker)
    if idx == -1:
        return html
    end = html.find('</section>', idx)
    if end == -1:
        raise ValueError("existing guarantee strip section is not closed")
    return html[:idx] + html[end + len('</section>'):]


def move_glass_after_hero(html: str) -> str:
    html = remove_existing_guarantee_strip(html)
    hero_start = html.index('<section class="ir-hero-v2"')
    hero_end = html.index('</section>', hero_start) + len('</section>')

    glass_start = html.find('<div class="ir-hero-glass"', hero_start, hero_end)
    if glass_start == -1:
        raise ValueError("ir-hero-glass not found inside hero")

    glass_start, glass_end = locate_balanced_div(html, "ir-hero-glass", hero_start)
    if glass_end > hero_end:
        raise ValueError("ir-hero-glass extends beyond hero")

    glass_html = html[glass_start:glass_end]
    glass_html = glass_html.replace('class="ir-hero-glass"', 'class="ir-hero-glass ir-hero-glass--strip"', 1)

    html_without_glass = html[:glass_start] + "\n" + html[glass_end:]
    hero_end = html_without_glass.index('</section>', hero_start) + len('</section>')
    strip = (
        '\n\n<section class="ir-hero-guarantee-strip" aria-label="Гарантия безопасности">\n'
        '  <div class="ir-hero-guarantee-strip__wrap">\n'
        f'{glass_html}\n'
        '  </div>\n'
        '</section>'
    )
    return html_without_glass[:hero_end] + strip + html_without_glass[hero_end:]


def main() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    b64 = run_psql(
        "SELECT encode(convert_to(blocks::text, 'UTF8'), 'base64') "
        f"FROM public.site_pages WHERE id='{PAGE_ID}';"
    ).strip()
    if not b64:
        raise SystemExit("STOP: page not found")

    blocks = json.loads(base64.b64decode(b64).decode("utf-8"))
    if not isinstance(blocks, list) or len(blocks) != 1:
        raise SystemExit(f"STOP: expected exactly 1 block, got {len(blocks) if isinstance(blocks, list) else type(blocks)}")

    code = blocks[0].get("content", {}).get("code")
    if not isinstance(code, str) or not code.strip():
        raise SystemExit("STOP: blocks[0].content.code is empty")

    BEFORE.write_text(code)

    required = ["openModal('setup')", 'href="#db"', '<section class="ir-hero-v2"', 'class="ir-hero-glass"']
    missing = [item for item in required if item not in code]
    if missing:
        raise SystemExit(f"STOP: required markers missing before patch: {missing}")

    style_pattern = re.compile(r'<style\s+id=["\']hero-fullbleed-override["\'][^>]*>.*?</style>', re.S | re.I)
    code2, style_count = style_pattern.subn(FINAL_STYLE, code, count=1)
    if style_count != 1:
        raise SystemExit(f"STOP: expected one hero-fullbleed-override style, got {style_count}")
    if style_pattern.search(code2):
        # subn with count=1 should leave none only if there was exactly one.
        raise SystemExit("STOP: multiple hero-fullbleed-override blocks detected")

    code2 = move_glass_after_hero(code2)

    forbidden_old_markers = [
        "lovable-hero-compact-v1",
        "lovable-hero-final-bottom-v1",
        "FULL-BLEED HERO OVERRIDE v4",
        "Compact hero v3",
        "GLASS HERO OVERRIDE",
    ]
    leftovers = [m for m in forbidden_old_markers if m in code2]
    if leftovers:
        raise SystemExit(f"STOP: old conflicting markers still present: {leftovers}")

    post_required = [
        "openModal('setup')",
        'href="#db"',
        '<section class="ir-hero-v2"',
        '<section class="ir-hero-guarantee-strip"',
        'lovable-hero-layout-final-v1',
    ]
    missing_after = [item for item in post_required if item not in code2]
    if missing_after:
        raise SystemExit(f"STOP: required markers missing after patch: {missing_after}")
    if code2.count('<style id="hero-fullbleed-override">') != 1:
        raise SystemExit("STOP: final style block count is not 1")
    if code2.count('<section class="ir-hero-guarantee-strip"') != 1:
        raise SystemExit("STOP: guarantee strip count is not 1")

    blocks[0]["content"]["code"] = code2
    AFTER.write_text(code2)

    payload = json.dumps(blocks, ensure_ascii=False)
    payload_b64 = base64.b64encode(payload.encode("utf-8")).decode("ascii")
    sql = (
        "WITH payload AS (SELECT convert_from(decode('" + payload_b64 + "','base64'),'UTF8')::jsonb AS blocks), "
        "upd AS (UPDATE public.site_pages SET blocks = payload.blocks, updated_at = now() "
        "FROM payload WHERE id = '" + PAGE_ID + "' RETURNING id) "
        "SELECT count(*) FROM upd;"
    )
    updated = run_psql(sql).strip()
    if updated != "1":
        raise SystemExit(f"STOP: expected rowcount 1, got {updated}")

    verify_b64 = run_psql(
        "SELECT encode(convert_to(blocks::text, 'UTF8'), 'base64') "
        f"FROM public.site_pages WHERE id='{PAGE_ID}';"
    ).strip()
    verify_blocks = json.loads(base64.b64decode(verify_b64).decode("utf-8"))
    verify_code = verify_blocks[0]["content"]["code"]
    if verify_code != code2:
        raise SystemExit("STOP: DB verify mismatch after update")

    print(json.dumps({
        "updated_rows": 1,
        "before_len": len(code),
        "after_len": len(code2),
        "style_blocks": verify_code.count('<style id="hero-fullbleed-override">'),
        "guarantee_strips": verify_code.count('<section class="ir-hero-guarantee-strip"'),
        "old_markers_present": [m for m in forbidden_old_markers if m in verify_code],
        "before_artifact": str(BEFORE),
        "after_artifact": str(AFTER),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()