import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const storageStatePath = process.env.PLAYWRIGHT_STORAGE_STATE;
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const searchTerm = process.env.COMPANIES_BENCHMARK_SEARCH || "ЭкоТехИндустрия";
const repetitions = Number.parseInt(process.env.COMPANIES_BENCHMARK_REPETITIONS || "10", 10);

if (!baseURL) {
  throw new Error("PLAYWRIGHT_BASE_URL is required (for example, the authenticated Lovable preview URL).");
}
if (!Number.isInteger(repetitions) || repetitions < 2 || repetitions > 50) {
  throw new Error("COMPANIES_BENCHMARK_REPETITIONS must be an integer between 2 and 50.");
}
if (!storageStatePath && !(adminEmail && adminPassword)) {
  throw new Error("Provide PLAYWRIGHT_STORAGE_STATE or both E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.");
}

const storageState = storageStatePath
  ? JSON.parse(await fs.readFile(storageStatePath, "utf8"))
  : undefined;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(storageState ? { storageState } : {});
const page = await context.newPage();

async function loginIfNeeded() {
  await page.goto(`${baseURL.replace(/\/$/, "")}/admin/companies`, { waitUntil: "domcontentloaded" });
  if (!/\/auth(?:\?|$)/.test(page.url())) return;
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel(/Пароль|Password/i).fill(adminPassword);
  await page.getByRole("button", { name: /Войти|Sign in/i }).click();
  await page.waitForURL(/\/admin\//, { timeout: 30_000 });
  await page.goto(`${baseURL.replace(/\/$/, "")}/admin/companies`, { waitUntil: "domcontentloaded" });
}

async function waitForCompaniesPage() {
  await page.getByRole("heading", { name: "Компании" }).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.getByPlaceholder("Название, УНП, ID, email или телефон").waitFor({ state: "visible", timeout: 30_000 });
}

async function measureSearch() {
  const input = page.getByPlaceholder("Название, УНП, ID, email или телефон");
  const started = performance.now();
  await input.fill(searchTerm);
  await page.getByRole("row").filter({ hasText: searchTerm }).first().waitFor({ state: "visible", timeout: 30_000 });
  return performance.now() - started;
}

async function measureCard() {
  const started = performance.now();
  await page.getByRole("row").filter({ hasText: searchTerm }).first().click();
  await page.getByRole("dialog").getByText(searchTerm, { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 });
  return performance.now() - started;
}

function percentile(samples, percentile) {
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

try {
  await loginIfNeeded();
  await waitForCompaniesPage();

  const searchSamples = [];
  const cardSamples = [];
  for (let index = 0; index < repetitions; index += 1) {
    searchSamples.push(await measureSearch());
    cardSamples.push(await measureCard());
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10_000 });
  }

  const report = {
    ok: true,
    read_only: true,
    base_url: baseURL,
    search_term: searchTerm,
    repetitions,
    search_ms: { samples: searchSamples, p50: percentile(searchSamples, 0.5), p95: percentile(searchSamples, 0.95) },
    card_ms: { samples: cardSamples, p50: percentile(cardSamples, 0.5), p95: percentile(cardSamples, 0.95) },
    targets: { search_p95_ms: 500, card_p95_ms: 1500 },
  };
  report.pass = report.search_ms.p95 <= report.targets.search_p95_ms && report.card_ms.p95 <= report.targets.card_p95_ms;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
