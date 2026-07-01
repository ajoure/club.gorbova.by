import { chromium } from '@playwright/test';
const session = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
if (!session || !storageKey) throw new Error('Missing browser session env');
const browser = await chromium.launch({ headless: true, executablePath: '/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', msg => {
  const text = msg.text();
  if (/error|training|container|lesson|access|supabase/i.test(text)) console.log('CONSOLE', msg.type(), text.slice(0, 500));
});
page.on('response', async res => {
  const url = res.url();
  if ((url.includes('/rest/v1/') || url.includes('/functions/v1/')) && res.status() >= 400) {
    console.log('HTTP', res.status(), url.slice(0, 240));
    try { console.log((await res.text()).slice(0, 500)); } catch {}
  }
});
await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' });
await page.evaluate(({ storageKey, session }) => {
  localStorage.setItem(storageKey, session);
}, { storageKey, session });
await page.goto('http://127.0.0.1:8080/knowledge', { waitUntil: 'networkidle', timeout: 60000 });
await page.getByRole('tab', { name: /Видеоответы/ }).click();
await page.waitForTimeout(2500);
const bodyText = await page.locator('body').innerText();
console.log('BODY_TEXT_START');
console.log(bodyText.slice(0, 4000));
console.log('BODY_TEXT_END');
const cards = await page.locator('text=/Выпуск №/').count();
const empty = await page.locator('text=Раздел пока пуст').count();
console.log(JSON.stringify({ cards, empty, url: page.url() }));
await page.screenshot({ path: '/mnt/documents/knowledge-videoanswers-check.png', fullPage: true });
await browser.close();
