import { chromium } from "file:///C:/Users/Think/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
await page.goto(pathToFileURL("D:/07-workspace/website-namche/index.html").href, { waitUntil: "load" });

for (const [selector, file] of [
  [".value-section-v2", "value-preview.jpg"],
  [".cases-section-v2", "cases-preview.jpg"],
]) {
  const section = page.locator(selector);
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await section.screenshot({ path: `D:/07-workspace/website-namche/.history/${file}`, type: "jpeg", quality: 58 });
}

await browser.close();
