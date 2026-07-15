import { chromium } from "file:///C:/Users/Think/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const target = pathToFileURL("D:/07-workspace/website-namche/index.html").href;
const errors = [];

async function inspect(viewport, desktop = false) {
  const page = await browser.newPage({ viewport });
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(target, { waitUntil: "load" });
  await page.locator(".service-section").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.locator(".cases-section-v2").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const result = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    heroText: document.querySelector(".hero-split-copy")?.textContent?.replace(/\s+/g, " ").trim(),
    serviceStepCount: document.querySelectorAll(".service-step").length,
    serviceNames: [...document.querySelectorAll(".service-step h3")].map((node) => node.textContent),
    caseNames: [...document.querySelectorAll(".case-card-v2 h3")].map((node) => node.textContent),
    heroImage: (() => { const image = document.querySelector(".hero-split-visual img"); return { complete: image?.complete, naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight }; })(),
    caseImages: [...document.querySelectorAll(".case-card-media img")].map((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth })),
  }));
  if (desktop) {
    await page.locator(".hero-split").screenshot({ path: "D:/07-workspace/website-namche/.history/hero-preview.jpg", type: "jpeg", quality: 50 });
    await page.locator(".service-section").screenshot({ path: "D:/07-workspace/website-namche/.history/service-preview.jpg", type: "jpeg", quality: 35 });
    await page.locator(".cases-section-v2").screenshot({ path: "D:/07-workspace/website-namche/.history/cases-preview-v2.jpg", type: "jpeg", quality: 35 });
  }
  await page.close();
  return result;
}

const desktop = await inspect({ width: 1440, height: 1000 }, true);
const mobile = await inspect({ width: 390, height: 844 });
console.log(JSON.stringify({ desktop, mobile, errors }, null, 2));
await browser.close();
