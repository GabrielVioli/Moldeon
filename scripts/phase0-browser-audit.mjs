import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PHASE0_BASE_URL ?? "http://127.0.0.1:4173";
const label = process.env.PHASE0_BROWSER_LABEL ?? "fallback";
const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
const browserDirectory = resolve(artifactRoot, "browser", label);
await mkdir(browserDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {
  label,
  baseUrl,
  generatedAt: new Date().toISOString(),
  browser: {
    name: "Chromium",
    version: browser.version(),
  },
  pages: [],
};

try {
  report.pages.push(
    await auditViewport(browser, {
      name: "desktop-1366x768",
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      exerciseThree: true,
    }),
  );
  report.pages.push(
    await auditViewport(browser, {
      name: "desktop-1920x1080",
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      exerciseThree: false,
    }),
  );
  report.pages.push(
    await auditViewport(browser, {
      name: "mobile-360x800",
      width: 360,
      height: 800,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      exerciseThree: false,
    }),
  );
  report.pages.push(
    await auditViewport(browser, {
      name: "mobile-390x844",
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      exerciseThree: false,
    }),
  );
} finally {
  await browser.close();
}

await writeFile(
  resolve(browserDirectory, "browser-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
await writeFile(
  resolve(browserDirectory, "browser-audit.md"),
  renderMarkdown(report),
  "utf8",
);
console.log(renderMarkdown(report));

async function auditViewport(browserInstance, options) {
  const context = await browserInstance.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.deviceScaleFactor,
    isMobile: options.isMobile ?? false,
    hasTouch: options.hasTouch ?? false,
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
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });

  const navigationStarted = performance.now();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_200);
  const navigationDurationMs = performance.now() - navigationStarted;

  await screenshot(page, options.name, "initial");
  const initialState = await collectPageState(page);

  await attempt(actions, "open-pattern-library", async () => {
    await page.getByRole("button", { name: "Moldes", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5_000 });
    await screenshot(page, options.name, "pattern-library");
  });

  const libraryState = await collectPageState(page);

  await attempt(actions, "choose-tshirt", async () => {
    await page.getByRole("button", { name: /Camiseta básica/ }).click();
    await page.waitForTimeout(700);
    await screenshot(page, options.name, "tshirt-editor");
  });

  const templateState = await collectPageState(page);

  if (options.exerciseThree) {
    await attempt(actions, "open-assembly-mode", async () => {
      await page.getByRole("button", { name: "Montagem", exact: true }).click();
      await page.waitForTimeout(350);
    });
    await attempt(actions, "mount-three-dimensional-preview", async () => {
      const button = page.getByRole("button", { name: /Montar no 3D|Atualizar roupa montada/ });
      if (await button.isDisabled()) throw new Error("Botão de montagem 3D está desabilitado.");
      await button.click();
      await page.waitForSelector("canvas.three-canvas", { timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await screenshot(page, options.name, "three-dimensional-preview");
    });
  }

  const threeState = await collectPageState(page);
  const frameRate = options.exerciseThree ? await estimateFrameRate(page, 1_500) : null;

  const beforeModeSwitch = await runtimeCounters(page);
  if (options.exerciseThree) {
    await attempt(actions, "return-to-modeling", async () => {
      await page.getByRole("button", { name: "Modelagem", exact: true }).click();
      await page.waitForTimeout(1_000);
    });
  }
  const afterModeSwitch = await runtimeCounters(page);
  const finalState = await collectPageState(page);

  const capabilities = await page.evaluate(() => {
    const probeCanvas = document.createElement("canvas");
    const gl2 = probeCanvas.getContext("webgl2");
    gl2?.getExtension("WEBGL_lose_context")?.loseContext();
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory:
        "deviceMemory" in navigator ? navigator.deviceMemory : null,
      webAssembly: typeof WebAssembly === "object",
      webGl2: Boolean(gl2),
      webGpu: "gpu" in navigator,
      sharedArrayBuffer: typeof SharedArrayBuffer === "function",
      crossOriginIsolated: window.crossOriginIsolated,
      devicePixelRatio: window.devicePixelRatio,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });

  const performanceData = await page.evaluate(() => {
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
      resources,
      largestResources: resources.slice(0, 20),
    };
  });

  await context.close();

  return {
    name: options.name,
    viewport: {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.deviceScaleFactor,
      isMobile: options.isMobile ?? false,
      hasTouch: options.hasTouch ?? false,
    },
    navigationDurationMs: Math.round(navigationDurationMs * 100) / 100,
    capabilities,
    actions,
    states: {
      initial: initialState,
      patternLibrary: libraryState,
      template: templateState,
      three: threeState,
      final: finalState,
    },
    frameRate,
    lifecycle: {
      beforeModeSwitch,
      afterModeSwitch,
      canvasCountDelta: afterModeSwitch.canvasCount - beforeModeSwitch.canvasCount,
      activeWorkerDelta:
        afterModeSwitch.activeWorkers - beforeModeSwitch.activeWorkers,
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

async function screenshot(page, viewportName, stateName) {
  await page.screenshot({
    path: resolve(browserDirectory, `${viewportName}-${stateName}.webp`),
    type: "webp",
    quality: 82,
    fullPage: false,
  });
}

async function collectPageState(page) {
  return page.evaluate(() => {
    const elements = [...document.querySelectorAll("button, input, select, [role='dialog']")];
    const outsideViewport = elements
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
      .filter(
        (rect) =>
          rect.right > window.innerWidth + 1 ||
          rect.left < -1 ||
          rect.bottom > window.innerHeight + 1 ||
          rect.top < -1,
      );

    return {
      title: document.title,
      bodyText: (document.body.innerText ?? "").slice(0, 2_000),
      canvasCount: document.querySelectorAll("canvas").length,
      threeCanvasCount: document.querySelectorAll("canvas.three-canvas").length,
      dialogCount: document.querySelectorAll("[role='dialog']").length,
      buttonCount: document.querySelectorAll("button").length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      outsideViewport: outsideViewport.slice(0, 40),
    };
  });
}

async function runtimeCounters(page) {
  return page.evaluate(() => ({
    ...window.__moldeonAuditRuntime,
    canvasCount: document.querySelectorAll("canvas").length,
    threeCanvasCount: document.querySelectorAll("canvas.three-canvas").length,
  }));
}

async function estimateFrameRate(page, durationMs) {
  return page.evaluate(async (duration) => {
    const start = performance.now();
    let frames = 0;
    await new Promise((resolvePromise) => {
      const tick = (time) => {
        frames += 1;
        if (time - start >= duration) resolvePromise();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const elapsed = performance.now() - start;
    return {
      frames,
      durationMs: elapsed,
      framesPerSecond: (frames * 1000) / elapsed,
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
        this.__auditTerminated = false;
      }

      terminate() {
        if (!this.__auditTerminated) {
          this.__auditTerminated = true;
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
    if (context && ["webgl", "experimental-webgl", "webgl2", "webgpu"].includes(type)) {
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
