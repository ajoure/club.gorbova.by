#!/usr/bin/env python3
"""SITE-000018 hero: fixed pixel height (iframe srcdoc -> 100vh broken)."""
import json, base64, re, urllib.request

PAGE_ID = "7e672fed-13f1-4ff1-8786-71a228a0c011"
URL = "https://hdjgkjceownmmnrqqtuz.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E"

req = urllib.request.Request(f"{URL}/functions/v1/read-site-blocks",
    data=json.dumps({"id": PAGE_ID}).encode(),
    headers={"Content-Type":"application/json","Authorization":f"Bearer {ANON}"})
data = json.loads(urllib.request.urlopen(req).read())
blocks = data["blocks"]
code = blocks[0]["content"]["code"]

# Remove the previous FULL-BLEED block we appended (if present) and re-add corrected
code = re.sub(
    r'\n\s*/\* === FULL-BLEED HERO OVERRIDE === \*/.*?(?=\n\s*</style>|\Z)',
    '\n',
    code, count=1, flags=re.S)

EXTRA = """
    /* === FULL-BLEED HERO OVERRIDE v2 (iframe-safe, pixel height) === */
    .ir-hero-v2 {
        min-height: 720px !important;
        height: 720px !important;
        padding: 0 !important;
        margin: 0 !important;
        display: flex !important;
        align-items: stretch !important;
        overflow: hidden !important;
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
        min-height: 720px !important;
        height: 720px !important;
    }
    .ir-hero-v2 .ir-hero-v2__visual .ir-hero-v2__person {
        object-position: right top !important;
    }
    .ir-hero-v2 .ir-hero-glass {
        left: 0.5rem !important; right: 0.5rem !important; bottom: 0 !important;
    }
    @media (max-width: 1024px) {
        .ir-hero-v2 { height: auto !important; min-height: auto !important; }
        .ir-hero-v2 .ir-hero-v2__visual { min-height: 420px !important; height: 420px !important; }
        .ir-hero-v2 .ir-hero-v2__wrap { padding: 1rem !important; }
        .ir-hero-glass { position: static !important; margin: 1rem 0 0 !important; }
    }
"""

code2, n = re.subn(
    r'(<style id="hero-fullbleed-override">)(.*?)(</style>)',
    lambda m: m.group(1) + m.group(2) + EXTRA + m.group(3),
    code, count=1, flags=re.S)
assert n == 1
code = code2

open(".lovable/artifacts/site018-hero-fullbleed-after.html","w").write(code)
blocks[0]["content"]["code"] = code

payload = json.dumps(blocks).encode()
b64 = base64.b64encode(payload).decode()
req = urllib.request.Request(f"{URL}/functions/v1/apply-site-blocks-patch",
    data=json.dumps({"id": PAGE_ID, "blocks_b64": b64}).encode(),
    headers={"Content-Type":"application/json","Authorization":f"Bearer {ANON}"})
print(urllib.request.urlopen(req, timeout=60).read().decode())
