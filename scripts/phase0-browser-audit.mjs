import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PHASE0_BASE_URL ?? "http://127.0.0.1:4173";
const label = process.env.PHASE0_BROWSER_LABEL ?? "fallback";
const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
const outputDirectory = resolve(artifactRoot, "browser", label);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {
  label,
  baseUrl,
  generatedAt: new Date().toISOString(),
  browser: { name: "Chromium", version: browser.version() },
  pages: [],
};

try {
  for (const viewport of [
    { name: "desktop-1366x768", width: 1366, height: 768, dpr: 1, exerciseThree: true },
    { name: "desktop-1920x1080", width: 1920, height: 1080, dpr: 1 },
    { name: "mobile-360x800", width: 360, height: 800, dpr: 2, mobile: true, touch: true },
    { name: "mobile-390x844", width: 390, height: 844, dpr: 2, mobile: true, touch: true },
  ]) {
    report.pages.push(await auditViewport(viewport));
  }
} finally {
  await browser.close();
}

await Promise.all([
  writeFile(
    resolve(outputDirectory, "browser-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "browser-audit.md"),
    renderMarkdown(report),
    "utf8",
  ),
]);
console.log(renderMarkdown(report));

async function auditViewport(viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    isMobile: viewport.mobile ?? false,
    hasTouch: viewport.touch ?? false,
    locale: "pt-BR",
    colorScheme: "light",
  });
  await context.addInitScript(instrumentRuntime);

  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const actions = [];

  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
      });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? "unknown",
    }),
  );

  const startedAt = performance.now();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_000);
  const navigationDurationMs = performance.now() - startedAt;

  await capture(page, `${viewport.name}-initial`);
  const initial = await collectState(page);

  await attempt(actions, "open-pattern-library", async () => {
    await page.getByRole("button", { name: "Moldes", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5_000 });
    await capture(page, `${viewport.name}-pattern-library`);
  });
  const library = await collectState(page);

  await attempt(actions, "choose-tshirt", async () => {
    const card = page.getByRole("button", { name: /Camiseta básica/ });
    if (await card.count()) await card.click();
    await page.waitForTimeout(500);
    await capture(page, `${viewport.name}-tshirt-editor`);
  });
  const template = await collectState(page);

  if (viewport.exerciseThree) {
    await attempt(actions, "mount-three-dimensional-preview", async () => {
      const button = page.getByRole("button", { name: "Montar no 3D", exact: true });
      if (await button.isDisabled()) {
        throw new Error("Botão Montar no 3D está desabilitado.");
      }
      await button.click();
      await page.waitForSelector("canvas.three-canvas", { timeout: 30_000 });
      await page.waitForTimeout(2_000);
      await capture(page, `${viewport.name}-three-dimensional-preview`);
    });
  }

  const three = await collectState(page);
  const frameRate = viewport.exerciseThree
    ? await estimateFrameRate(page, 1_500)
    : null;
  const beforeModeSwitch = await runtimeCounters(page);

  if (viewport.exerciseThree) {
    await attempt(actions, "return-to-modeling", async () => {
      await page.getByRole("button", { name: "Modelagem", exact: true }).click();
      await page.waitForTimeout(750);
    });
  }

  const afterModeSwitch = await runtimeCounters(page);
  const final = await collectState(page);
  const capabilities = await collectCapabilities(page);
  const performanceData = await collectPerformance(page);
  await context.close();

  return {
    name: viewport.name,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dpr,
      isMobile: viewport.mobile ?? false,
      hasTouch: viewport.touch ?? false,
    },
    navigationDurationMs: Math.round(navigationDurationMs * 100) / 100,
    capabilities,
    actions,
    states: { initial, library, template, three, final },
    frameRate,
    lifecycle: {
      beforeModeSwitch,
      afterModeSwitch,
      canvasCountDelta: afterModeSwitch.canvasCount - beforeModeSwitch.canvasCount,
      activeWorkerDelta: afterModeSwitch.activeWorkers - beforeModeSwitch.activeWorkers,
      animationFrameExecutionsAfterSwitch:
        afterModeSwitch.animationFramesExecuted -
        beforeModeSwitch.animationFramesExecuted,
    },
    consoleMessages,
    pageErrors,
    failedRequests,
    performance: performanceData,
  };
}

async function attempt(actions, name, callback) {
  const startedAt = performance.now();
  try {
    await callback();
    actions.push({
      name,
      status: "passed",
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    });
  } catch (error) {
    actions.push({
      name,
      status: "failed",
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function capture(page, name) {
  await page.screenshot({
    path: resolve(outputDirectory, `${name}.png`),
    type: "png",
    fullPage: false,
  });
}

function collectCapabilities(page) {
  return page.evaluate(() => {
    const probe = document.createElement("canvas");
    const gl2 = probe.getContext("webgl2");
    const result = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: "deviceMemory" in navigator ? navigator.deviceMemory : null,
      webAssembly: typeof WebAssembly === "object",
      webGl2: Boolean(gl2),
      webGpu: "gpu" in navigator,
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      crossOriginIsolated: window.crossOriginIsolated,
      devicePixelRatio: window.devicePixelRatio,
    };
    gl2?.getExtension("WEBGL_lose_context")?.loseContext();
    return result;
  });
}

function collectState(page) {
  return page.evaluate(() => {
    const visibleControls = [...document.querySelectorAll("button, input, select, [role='dialog']")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().slice(0, 80),
          ariaLabel: element.getAttribute("aria-label"),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
        };
      })
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
    const outsideViewport = visibleControls.filter(
      (rect) =>
        rect.right > innerWidth + 1 ||
        rect.left < -1 ||
        rect.bottom > innerHeight + 1 ||
        rect.top < -1,
    );

    return {
      title: document.title,
      bodyText: (document.body.innerText ?? "").slice(0, 2_000),
      canvasCount: document.querySelectorAll("canvas").length,
      threeCanvasCount: document.querySelectorAll("canvas.three-canvas").length,
      dialogCount: document.querySelectorAll("[role='dialog']").length,
      buttonCount: document.querySelectorAll("button").length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      outsideViewport: outsideViewport.slice(0, 50),
    };
  });
}

function runtimeCounters(page) {
  return page.evaluate(() => ({
    ...window.__moldeonAuditRuntime,
    canvasCount: document.querySelectorAll("canvas").length,
    threeCanvasCount: document.querySelectorAll("canvas.three-canvas").length,
  }));
}

function collectPerformance(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance
      .getEntriesByType("resource")
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        duration: Math.round(entry.duration * 100) / 100,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      }))
      .sort((left, right) => right.transferSize - left.transferSize);

    return {
      navigation: navigation
        ? {
            duration: navigation.duration,
            domContentLoaded: navigation.domContentLoadedEventEnd,
            loadEvent: navigation.loadEventEnd,
            transferSize: navigation.transferSize,
            encodedBodySize: navigation.encodedBodySize,
            decodedBodySize: navigation.decodedBodySize,
          }
        : null,
      largestResources: resources.slice(0, 25),
      resourceCount: resources.length,
    };
  });
}

function estimateFrameRate(page, durationMs) {
  return page.evaluate(async (duration) => {
    const startedAt = performance.now();
    let frames = 0;
    await new Promise((resolvePromise) => {
      const tick = (time) => {
        frames += 1;
        if (time - startedAt >= duration) resolvePromise();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const elapsed = performance.now() - startedAt;
    return {
      frames,
      durationMs: elapsed,
      framesPerSecond: (frames * 1_000) / elapsed,
    };
  }, durationMs);
}

function instrumentRuntime() {
  const runtime = {
    workersCreated: 0,
    workersTerminated: 0,
    activeWorkers: 0,
    animationFramesRequested: 0,
    animationFramesExecuted: 0,
    contexts: { webgl: 0, webgl2: 0, webgpu: 0 },
    longTasks: [],
  };
  Object.defineProperty(window, "__moldeonAuditRuntime", {
    value: runtime,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  const NativeWorker = window.Worker;
  if (NativeWorker) {
    window.Worker = class AuditedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        runtime.workersCreated += 1;
        runtime.activeWorkers += 1;
        this.__terminatedForAudit = false;
      }

      terminate() {
        if (!this.__terminatedForAudit) {
          this.__terminatedForAudit = true;
          runtime.workersTerminated += 1;
          runtime.activeWorkers = Math.max(0, runtime.activeWorkers - 1);
        }
        return super.terminate();
      }
    };
  }

  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  const observedContexts = new WeakMap();
  HTMLCanvasElement.prototype.getContext = function auditedGetContext(type, ...args) {
    const context = nativeGetContext.call(this, type, ...args);
    const supported = ["webgl", "experimental-webgl", "webgl2", "webgpu"];
    if (context && supported.includes(type)) {
      const normalized = type === "experimental-webgl" ? "webgl" : type;
      const observed = observedContexts.get(this) ?? new Set();
      if (!observed.has(normalized)) {
        observed.add(normalized);
        observedContexts.set(this, observed);
        runtime.contexts[normalized] += 1;
      }
    }
    return context;
  };

  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    runtime.animationFramesRequested += 1;
    return nativeRequestAnimationFrame((time) => {
      runtime.animationFramesExecuted += 1;
      callback(time);
    });
  };

  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          runtime.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Long Task API is optional.
    }
  }
}

function renderMarkdown(audit) {
  const rows = audit.pages
    .map((page) => {
      const failedActions = page.actions.filter((action) => action.status === "failed").length;
      return `| ${page.name} | ${page.capabilities.webGl2 ? "sim" : "não"} | ${page.capabilities.webGpu ? "sim" : "não"} | ${page.capabilities.crossOriginIsolated ? "sim" : "não"} | ${page.states.three.threeCanvasCount} | ${failedActions} | ${page.consoleMessages.length + page.pageErrors.length} |`;
    })
    .join("\n");

  return `# Auditoria de navegador: ${audit.label}\n\n` +
    `Chromium ${audit.browser.version}\n\n` +
    `| Viewport | WebGL 2 | WebGPU | Isolado | Canvas 3D | Ações falhas | Erros/warnings |\n` +
    `|---|---:|---:|---:|---:|---:|---:|\n${rows}\n`;
}
