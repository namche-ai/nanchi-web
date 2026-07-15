import { chromium } from "file:///C:/Users/Think/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";

const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const target = pathToFileURL("D:/07-workspace/website-namche/index.html").href;
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const errors = [];

async function revealPage(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
}

async function inspect(viewport, screenshotName) {
  const page = await browser.newPage({ viewport });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(target, { waitUntil: "load" });
  await revealPage(page);

  const result = await page.evaluate(() => ({
    title: document.title,
    viewport: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    headerLogos: [...document.querySelectorAll(".brand-image img")].map((image) => ({
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })),
    flowCount: document.querySelectorAll(".flow-wrap").length,
    customerStripCount: document.querySelectorAll(".customer-strip").length,
    valueOutcomeCount: document.querySelectorAll(".value-outcome").length,
    caseCardCount: document.querySelectorAll(".case-card-v2").length,
    brokenImages: [...document.images].filter((image) => !image.complete || !image.naturalWidth).map((image) => image.src),
  }));

  if (viewport.width >= 900) {
    await page.locator(".header-demo").click();
    result.modalOpened = await page.locator("[data-modal]").evaluate((el) => el.classList.contains("open"));
    await page.locator("[data-close-demo]").first().click();
  } else {
    await page.locator("[data-menu-button]").click();
    result.mobileMenuOpened = await page.locator("[data-mobile-nav]").evaluate((el) => el.classList.contains("open"));
    await page.locator("[data-menu-button]").click();
  }

  await page.screenshot({ path: `D:/07-workspace/website-namche/.history/${screenshotName}`, fullPage: true });
  await page.close();
  return result;
}

const desktop = await inspect({ width: 1440, height: 1000 }, "home-detail-desktop.png");
const mobile = await inspect({ width: 390, height: 844 }, "home-detail-mobile.png");
console.log(JSON.stringify({ desktop, mobile, errors }, null, 2));
await browser.close();


