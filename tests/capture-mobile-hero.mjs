import { chromium } from "file:///C:/Users/Think/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(pathToFileURL("D:/07-workspace/website-namche/index.html").href, { waitUntil: "load" });
await page.locator(".hero-split").screenshot({ path: "D:/07-workspace/website-namche/.history/hero-mobile-preview.jpg", type: "jpeg", quality: 45 });
console.log(JSON.stringify(await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, bodyWidth: document.body.scrollWidth }))));
await browser.close();
