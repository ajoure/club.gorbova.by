#!/usr/bin/env python3
"""Patch SITE-000018 hero: glassmorphism guarantees overlay + Katerina without bg."""
import json, base64, re, sys, urllib.request

PAGE_ID = "7e672fed-13f1-4ff1-8786-71a228a0c011"
SUPABASE_URL = "https://hdjgkjceownmmnrqqtuz.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"
CDN_URL = "/__l5e/assets-v1/f4fb4946-351f-4317-bcd5-a6c8cac710d4/katerina-nobg.png"

# 1) Load current blocks
req = urllib.request.Request(
    f"{SUPABASE_URL}/functions/v1/read-site-blocks",
    data=json.dumps({"id": PAGE_ID}).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {ANON}"},
)
data = json.loads(urllib.request.urlopen(req).read())
blocks = data["blocks"]
code = blocks[0]["content"]["code"]
open(".lovable/artifacts/site018-hero-glass-before.html", "w").write(code)

# 2) Replace person image src (base64) with CDN URL
new_img = f'<img class="ir-hero-v2__person" src="{CDN_URL}" alt="Эксперт Екатерина Горбова" loading="eager">'
code, n = re.subn(
    r'<img class="ir-hero-v2__person"[^>]*?>',
    new_img,
    code,
    count=1,
    flags=re.S,
)
assert n == 1, f"person img replace failed: {n}"

# 3) Build glass card markup (reuse same content as ir-guarantees-strip, but new BEM block ir-hero-glass)
GLASS = """
                <div class="ir-hero-glass">
                    <div class="ir-hero-glass__label">Гарантия безопасности</div>
                    <div class="ir-hero-glass__grid">
                        <div class="ir-hero-glass__item">
                            <div class="ir-hero-glass__icon"><i class="fa-solid fa-user-shield"></i></div>
                            <div class="ir-hero-glass__body">
                                <h3>Защита от проверок</h3>
                                <p>Эксперт с опытом 400+ проверок закроет все вопросы со стороны контролирующих органов.</p>
                            </div>
                        </div>
                        <div class="ir-hero-glass__item">
                            <div class="ir-hero-glass__icon"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                            <div class="ir-hero-glass__body">
                                <h3>Законная экономия</h3>
                                <p>Перевод личных расходов в законные расходы компании без уплаты НДС и подоходного налога.</p>
                            </div>
                        </div>
                        <div class="ir-hero-glass__item">
                            <div class="ir-hero-glass__icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
                            <div class="ir-hero-glass__body">
                                <h3>Высвобождение времени</h3>
                                <p>Система сама рассылает обязательные материалы и собирает подтверждения сотрудников.</p>
                            </div>
                        </div>
                    </div>
                    <div class="ir-hero-glass__stats">
                        <span>Опыт лидера проекта:</span>
                        <b><i class="fa-solid fa-circle-check"></i> 400+ проверок</b>
                    </div>
                </div>
"""

# Insert glass markup inside .ir-hero-v2__visual before closing </div>
pattern_visual = re.compile(
    r'(<div class="ir-hero-v2__visual"[^>]*>\s*<img class="ir-hero-v2__person"[^>]*>\s*)(</div>)',
    re.S,
)
code, n = pattern_visual.subn(r'\1' + GLASS + r'            \2', code, count=1)
assert n == 1, f"glass insert failed: {n}"

# 4) Remove old <section class="ir-guarantees-strip">…</section>
code2, n = re.subn(
    r'\s*<!-- GUARANTEES STRIP[^>]*-->\s*<section class="ir-guarantees-strip">.*?</section>\s*',
    "\n\n",
    code,
    count=1,
    flags=re.S,
)
assert n == 1, f"guarantees-strip remove failed: {n}"
code = code2

# 5) Append CSS overrides at the end of <style id="hero-fullbleed-override">…</style>
EXTRA_CSS = """
    /* === GLASS HERO OVERRIDE === */
    .ir-hero-v2 .ir-hero-v2__visual { position: relative !important; overflow: hidden !important; background: transparent !important; }
    .ir-hero-v2 .ir-hero-v2__visual::after { display: none !important; }
    .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
        position: absolute !important; inset: 0 !important;
        width: 100% !important; height: 100% !important;
        object-fit: contain !important; object-position: right bottom !important;
        background: transparent !important;
        image-rendering: auto;
        transform: translateZ(0);
        -webkit-backface-visibility: hidden; backface-visibility: hidden;
    }
    .ir-hero-glass {
        position: absolute; left: 1.25rem; right: 1.25rem; bottom: 1.25rem;
        z-index: 3;
        background: rgba(15, 23, 34, 0.42);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        backdrop-filter: blur(18px) saturate(140%);
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 20px;
        box-shadow: 0 18px 48px -20px rgba(0,0,0,0.55);
        padding: 1.05rem 1.2rem 1.1rem;
        display: flex; flex-direction: column; gap: 0.85rem;
    }
    .ir-hero-glass__label {
        align-self: flex-start;
        background: linear-gradient(135deg, #38BDF8, #0EA5E9);
        color: #0f172a; font-weight: 700; font-size: 0.7rem;
        letter-spacing: 0.06em; text-transform: uppercase;
        padding: 0.35rem 0.7rem; border-radius: 999px;
    }
    .ir-hero-glass__grid {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;
    }
    .ir-hero-glass__item { display: flex; align-items: flex-start; gap: 0.7rem; }
    .ir-hero-glass__icon {
        width: 36px; height: 36px; flex: 0 0 36px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px; color: #38BDF8; font-size: 0.95rem;
    }
    .ir-hero-glass__body h3 { color: #fff; font-weight: 700; font-size: 0.92rem; margin: 0 0 0.18rem; line-height: 1.2; }
    .ir-hero-glass__body p { color: rgba(226,232,240,0.78); font-size: 0.74rem; line-height: 1.35; margin: 0; }
    .ir-hero-glass__stats {
        display: flex; align-items: center; justify-content: space-between;
        gap: 1rem; padding-top: 0.7rem;
        border-top: 1px solid rgba(255,255,255,0.1);
        color: rgba(148,163,184,0.9); font-size: 0.78rem;
    }
    .ir-hero-glass__stats b { color: #38BDF8; font-weight: 700; }
    .ir-hero-glass__stats b i { margin-right: 0.35rem; }

    /* Symmetric hero height: glass bottom aligns with CTA buttons bottom */
    @media (min-width: 1025px) {
        .ir-hero-v2 .ir-hero-v2__wrap { align-items: stretch !important; }
        .ir-hero-v2, .ir-hero-v2__wrap, .ir-hero-v2 .ir-hero-v2__visual { min-height: 640px !important; }
    }
    @media (max-width: 1024px) {
        .ir-hero-v2 .ir-hero-v2__visual { min-height: 420px !important; }
        .ir-hero-glass { position: static !important; margin: 1rem; }
        .ir-hero-glass__grid { grid-template-columns: 1fr; gap: 0.85rem; }
        .ir-hero-glass__stats { flex-direction: column; align-items: flex-start; gap: 0.4rem; }
    }
"""

code, n = re.subn(
    r'(<style id="hero-fullbleed-override">)(.*?)(</style>)',
    lambda m: m.group(1) + m.group(2) + EXTRA_CSS + m.group(3),
    code,
    count=1,
    flags=re.S,
)
assert n == 1, f"style override append failed: {n}"

# Save after-snapshot
open(".lovable/artifacts/site018-hero-glass-after.html", "w").write(code)
blocks[0]["content"]["code"] = code

# 6) Send back via apply-site-blocks-patch
payload = json.dumps(blocks).encode()
b64 = base64.b64encode(payload).decode()
print("payload size:", len(payload), "b64 size:", len(b64))

req = urllib.request.Request(
    f"{SUPABASE_URL}/functions/v1/apply-site-blocks-patch",
    data=json.dumps({"id": PAGE_ID, "blocks_b64": b64}).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {ANON}"},
)
resp = urllib.request.urlopen(req, timeout=60).read()
print("apply response:", resp.decode())
