import { chromium } from "file:///C:/Users/Think/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL("D:/07-workspace/website-namche/index.html").href, { waitUntil: "load" });

for (const [selector, file] of [
  [".value-section-v2", "value-section.png"],
  [".cases-section-v2", "cases-section.png"],
]) {
  const section = page.locator(selector);
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await section.screenshot({ path: `D:/07-workspace/website-namche/.history/${file}` });
}

const images = await page.locator(".case-card-media img").evaluateAll((nodes) => nodes.map((image) => ({
  src: image.getAttribute("src"),
  complete: image.complete,
  naturalWidth: image.naturalWidth,
  naturalHeight: image.naturalHeight,
})));
console.log(JSON.stringify(images, null, 2));
await browser.close();
