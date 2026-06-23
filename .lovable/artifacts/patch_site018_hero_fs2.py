#!/usr/bin/env python3
"""SITE-000018: replace Katerina photo + raise photo & glass + full-screen hero."""
import json, base64, re, urllib.request

PAGE_ID = "7e672fed-13f1-4ff1-8786-71a228a0c011"
URL = "https://hdjgkjceownmmnrqqtuz.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"
NEW_IMG = "/__l5e/assets-v1/978443c5-9bf4-469c-af9e-450b86757e3c/katerina-hero-v2.png"
OLD_IMG = "/__l5e/assets-v1/f4fb4946-351f-4317-bcd5-a6c8cac710d4/katerina-nobg.png"

req = urllib.request.Request(f"{URL}/functions/v1/read-site-blocks",
    data=json.dumps({"id": PAGE_ID}).encode(),
    headers={"Content-Type":"application/json","Authorization":f"Bearer {ANON}"})
data = json.loads(urllib.request.urlopen(req).read())
blocks = data["blocks"]
code = blocks[0]["content"]["code"]
open(".lovable/artifacts/site018-hero-fs2-before.html","w").write(code)

# 1) swap image
code = code.replace(OLD_IMG, NEW_IMG)

# 2) strip prior FULL-BLEED override, re-inject v3
code = re.sub(
    r'\n\s*/\* === FULL-BLEED HERO OVERRIDE.*?(?=\n\s*</style>|\Z)',
    '\n', code, count=1, flags=re.S)

EXTRA = """
    /* === FULL-BLEED HERO OVERRIDE v3 === */
    .ir-hero-v2 {
        min-height: 860px !important;
        height: 860px !important;
        padding: 0 !important;
        margin: 0 !important;
        display: flex !important;
        align-items: stretch !important;
        overflow: hidden !important;
        position: relative !important;
    }
    .ir-hero-v2 .ir-hero-v2__wrap {
        min-height: 100% !important;
        height: 100% !important;
        align-items: stretch !important;
        padding: 1.25rem 1.5rem !important;
        gap: 1.5rem !important;
    }
    .ir-hero-v2 .ir-hero-v2__content {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0 !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
    }
    .ir-hero-v2 .ir-hero-v2__content::before,
    .ir-hero-v2 .ir-hero-v2__content::after { display: none !important; }
    .ir-hero-v2 .ir-hero-v2__visual {
        min-height: 860px !important;
        height: 860px !important;
        position: relative !important;
        overflow: hidden !important;
    }
    .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
        object-fit: contain !important;
        object-position: right top !important;
        height: 100% !important;
        width: 100% !important;
        transform: translateY(-2%) scale(1.02) !important;
        transform-origin: right top !important;
    }
    .ir-hero-v2 .ir-hero-glass {
        position: absolute !important;
        left: 0.5rem !important;
        right: 0.5rem !important;
        bottom: auto !important;
        top: 52% !important;
    }
    @media (max-width: 1024px) {
        .ir-hero-v2 { height: auto !important; min-height: auto !important; }
        .ir-hero-v2 .ir-hero-v2__visual { min-height: 460px !important; height: 460px !important; }
        .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person { transform: none !important; object-position: right top !important; }
        .ir-hero-v2 .ir-hero-v2__wrap { padding: 1rem !important; }
        .ir-hero-glass { position: static !important; margin: 1rem 0 0 !important; top: auto !important; }
    }
"""

code2, n = re.subn(
    r'(<style id="hero-fullbleed-override">)(.*?)(</style>)',
    lambda m: m.group(1) + m.group(2) + EXTRA + m.group(3),
    code, count=1, flags=re.S)
assert n == 1, "override style block not found"
code = code2

open(".lovable/artifacts/site018-hero-fs2-after.html","w").write(code)
blocks[0]["content"]["code"] = code

payload = json.dumps(blocks).encode()
b64 = base64.b64encode(payload).decode()
req = urllib.request.Request(f"{URL}/functions/v1/apply-site-blocks-patch",
    data=json.dumps({"id": PAGE_ID, "blocks_b64": b64}).encode(),
    headers={"Content-Type":"application/json","Authorization":f"Bearer {ANON}"})
print(urllib.request.urlopen(req, timeout=60).read().decode())
