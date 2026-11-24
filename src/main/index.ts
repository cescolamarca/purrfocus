import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray
} from "electron";
import { buildSurrenderPhrase, validateSurrenderInput } from "../shared/antiCheat";
import type {
  CatOverlayCommand,
  CatSkinManifestEntry,
  MonitorStatusBadge,
  QuotaStatus,
  Rect,
  RendererUiState,
  SessionConfig,
  SessionStats,
  WindowSnapshot
} from "../shared/types";
import { EnforcerEngine } from "./enforcer";
import { HybridMonitor } from "./hybridMonitor";
import {
  getActiveWindowSnapshot,
  getWindowClassName,
  restoreAllSavedWindows
} from "./win32";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let monitor: HybridMonitor | null = null;
let enforcer: EnforcerEngine | null = null;
let sessionTimer: NodeJS.Timeout | null = null;

let phase: "LAUNCHER" | "ACTIVE" | "REPORT" = "LAUNCHER";
let currentConfig: SessionConfig | undefined;
let stats: SessionStats = createEmptyStats(25);
let badge: MonitorStatusBadge = {
  state: "IDLE",
  label: "In attesa di avvio",
  quotaStatus: "OK",
  usedFallback: false
};
let lastOverlayCommand: CatOverlayCommand = { mode: "IDLE_PERCH" };
let lastStudyWindowDipRect: Rect | undefined;
let surrenderOpenedAt = 0;
let surrenderModalOpen = false;
let currentSurrenderPhrase = "";
let lastNegotiation: RendererUiState["negotiation"];

const isSmokeTest = process.argv.includes("--smoke-test");

function createEmptyStats(durationMinutes: number): SessionStats {
  return {
    startedAt: Date.now(),
    elapsedSeconds: 0,
    targetSeconds: Math.max(1, durationMinutes) * 60,
    tabsClosed: 0,
    windowsDragged: 0,
    excusesAccepted: 0,
    excusesRejected: 0,
    focusChecksTotal: 0,
    distractionChecksTotal: 0
  };
}

function getWorkAreaDip(): Rect {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    left: wa.x,
    top: wa.y,
    right: wa.x + wa.width,
    bottom: wa.y + wa.height,
    width: wa.width,
    height: wa.height
  };
}

function getPhysicalScreenBounds(): Rect {
  const primary = screen.getPrimaryDisplay();
  const scale = primary.scaleFactor || 1;
  const b = primary.bounds;
  return {
    left: Math.round(b.x * scale),
    top: Math.round(b.y * scale),
    right: Math.round((b.x + b.width) * scale),
    bottom: Math.round((b.y + b.height) * scale),
    width: Math.round(b.width * scale),
    height: Math.round(b.height * scale)
  };
}

function toDipRect(phys: Rect): Rect {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const converted = screen.screenToDipRect(mainWindow, {
        x: phys.left,
        y: phys.top,
        width: phys.width,
        height: phys.height
      });
      return {
        left: converted.x,
        top: converted.y,
        right: converted.x + converted.width,
        bottom: converted.y + converted.height,
        width: converted.width,
        height: converted.height
      };
    } catch {
      // Fall back to scale factor math if window bounds are unavailable
    }
  }
  return {
    left: Math.round(phys.left / scale),
    top: Math.round(phys.top / scale),
    right: Math.round(phys.right / scale),
    bottom: Math.round(phys.bottom / scale),
    width: Math.round(phys.width / scale),
    height: Math.round(phys.height / scale)
  };
}

function toDipPoint(pt: { x: number; y: number }): { x: number; y: number } {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  try {
    return screen.screenToDipPoint(pt);
  } catch {
    return { x: Math.round(pt.x / scale), y: Math.round(pt.y / scale) };
  }
}

function getOwnPids(): Set<number> {
  const pids = new Set<number>([process.pid]);
  for (const metric of app.getAppMetrics()) {
    pids.add(metric.pid);
  }
  return pids;
}

function pushUiState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const state: RendererUiState = {
    phase,
    config: currentConfig,
    stats: { ...stats },
    badge: { ...badge },
    overlayCommand: {
      ...lastOverlayCommand,
      workArea: getWorkAreaDip(),
      studyRect: lastOverlayCommand.studyRect ?? lastStudyWindowDipRect
    },
    workArea: getWorkAreaDip(),
    negotiation: lastNegotiation,
    surrenderPhrase: currentSurrenderPhrase || undefined
  };
  mainWindow.webContents.send("state:update", state);
}

function updateBadgeFromQuota(
  baseState: MonitorStatusBadge["state"],
  label: string,
  quotaStatus: QuotaStatus,
  usedFallback: boolean
): void {
  let suffix = "";
  if (usedFallback) {
    if (quotaStatus === "BILLING_402") suffix = " [Locale: Crediti API 402]";
    else if (quotaStatus === "RATE_LIMIT_429") suffix = " [Locale: Rate Limit]";
    else if (quotaStatus === "NO_KEY") suffix = " [Locale: Nessuna Key]";
    else suffix = " [Modalita Locale]";
  }
  badge = {
    state: baseState,
    label: `${label}${suffix}`,
    quotaStatus,
    usedFallback
  };
}

function teardownSession(): void {
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
  monitor?.stop();
  monitor = null;
  enforcer?.dispose();
  enforcer = null;
  lastNegotiation = undefined;
}

function finishSession(completedNaturally: boolean): void {
  teardownSession();
  phase = "REPORT";
  badge = {
    state: "FINISHED",
    label: completedNaturally ? "Sessione completata!" : "Resa registrata",
    quotaStatus: badge.quotaStatus,
    usedFallback: badge.usedFallback
  };
  lastOverlayCommand = {
    mode: completedNaturally ? "VICTORY" : "IDLE_PERCH",
    workArea: getWorkAreaDip()
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setFocusable(true);
    mainWindow.focus();
  }
  pushUiState();
}

function startStudySession(config: SessionConfig): void {
  teardownSession();
  currentConfig = config;
  phase = "ACTIVE";
  stats = createEmptyStats(config.durationMinutes);
  lastStudyWindowDipRect = undefined;
  currentSurrenderPhrase = buildSurrenderPhrase(config.goal);
  badge = {
    state: "STUDYING",
    label: "Studio monitorato",
    quotaStatus: "OK",
    usedFallback: false
  };
  lastOverlayCommand = {
    mode: "IDLE_PERCH",
    workArea: getWorkAreaDip()
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFocusable(false);
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  enforcer = new EnforcerEngine(
    {
      goal: config.goal,
      modelId: config.modelId,
      apiKeyOverride: config.apiKeyOverride
    },
    stats,
    {
      toDipRect,
      toDipPoint,
      getPhysicalScreenBounds,
      getWorkAreaDip,
      getLastStudyHwnd: () => monitor?.getLastVerifiedStudyHwnd() ?? 0,
      getLastStudyDipRect: () => lastStudyWindowDipRect,
      grantExcuse: (key, minutes) => monitor?.grantTemporaryExcuse(key, minutes),
      invalidateKey: (key) => monitor?.invalidateKey(key),
      onPhaseOrCommand: (info) => {
        lastOverlayCommand = info.command;
        lastNegotiation = info.negotiation;
        if (info.phase === "WARNING") {
          badge = { ...badge, state: "WARNING", label: "Distrazione rilevata!" };
        } else if (info.phase === "NEGOTIATING") {
          badge = { ...badge, state: "NEGOTIATING", label: "Tribunale Felino" };
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setIgnoreMouseEvents(false);
            mainWindow.setFocusable(true);
            mainWindow.focus();
          }
        } else if (info.phase === "STRIKING") {
          badge = { ...badge, state: "STRIKING", label: "Zampata in corso!" };
          if (mainWindow && !mainWindow.isDestroyed() && !surrenderModalOpen) {
            mainWindow.setFocusable(false);
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
          }
        } else {
          if (info.quotaStatus !== undefined && info.usedFallback !== undefined) {
            updateBadgeFromQuota("STUDYING", "Studio OK", info.quotaStatus, info.usedFallback);
          } else {
            badge = { ...badge, state: "STUDYING", label: "Studio OK" };
          }
          if (mainWindow && !mainWindow.isDestroyed() && !surrenderModalOpen) {
            mainWindow.setFocusable(false);
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
          }
        }
        pushUiState();
      }
    }
  );

  monitor = new HybridMonitor(
    {
      goal: config.goal,
      modelId: config.modelId,
      apiKeyOverride: config.apiKeyOverride
    },
    {
      getActiveWindow: () => {
        const snapshot = getActiveWindowSnapshot(getOwnPids());
        if (!snapshot) {
          return null;
        }
        snapshot.dipRect = toDipRect(snapshot.rawRect);
        return {
          snapshot,
          className: getWindowClassName(snapshot.hwnd)
        };
      },
      isBusyWithIntervention: () => enforcer?.isBusy() ?? false,
      onStatusUpdate: (info) => {
        if (info.checkingVision) {
          badge = {
            state: "CHECKING_VISION",
            label: "Controllo Vision...",
            quotaStatus: info.quotaStatus,
            usedFallback: info.usedFallback
          };
        } else {
          updateBadgeFromQuota("STUDYING", "Studio OK", info.quotaStatus, info.usedFallback);
        }
        pushUiState();
      },
      onStudyWindowConfirmed: (win: WindowSnapshot) => {
        stats.focusChecksTotal += 1;
        lastStudyWindowDipRect = win.dipRect ?? toDipRect(win.rawRect);
        if (!enforcer?.isBusy()) {
          lastOverlayCommand = {
            mode: "IDLE_PERCH",
            studyRect: lastStudyWindowDipRect,
            workArea: getWorkAreaDip()
          };
        }
        pushUiState();
      },
      onDistractionDetected: (info) => {
        enforcer?.handleDistraction(info);
      }
    }
  );

  monitor.start();

  sessionTimer = setInterval(() => {
    if (phase !== "ACTIVE") {
      return;
    }
    stats.elapsedSeconds += 1;
    if (stats.elapsedSeconds >= stats.targetSeconds) {
      finishSession(true);
      return;
    }
    pushUiState();
  }, 1000);

  pushUiState();
}

function createPixelCatTrayIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const setPx = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = a;
  };

  // Retro orange pixel cat head silhouette
  const silhouette = [
    "..OO........OO..",
    ".OOOO......OOOO.",
    ".OOXO......OXOO.",
    ".OOOOOOOOOOOOOO.",
    ".OOOOOOOOOOOOOO.",
    "OOOOOOOOOOOOOOOO",
    "OOOOWWOOOOOWWOOO",
    "OOOWWWOOOOOWWWOO",
    "OOOOOOOOOOOOOOOO",
    "OOOOOOOPPPPOOOOO",
    ".OOOOOOOOOOOOOO.",
    ".OOCCCCCCCCCCOO.",
    "..OOOOOOOOOOOO..",
    "...OOOOOOOOOO..."
  ];

  for (let row = 0; row < silhouette.length; row++) {
    const line = silhouette[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === "O") setPx(col, row + 1, 232, 134, 48);
      else if (ch === "X") setPx(col, row + 1, 255, 198, 178);
      else if (ch === "W") setPx(col, row + 1, 25, 25, 30);
      else if (ch === "P") setPx(col, row + 1, 240, 120, 140);
      else if (ch === "C") setPx(col, row + 1, 255, 236, 200);
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function setupTray(): void {
  if (tray) {
    return;
  }
  tray = new Tray(createPixelCatTrayIcon());
  tray.setToolTip("PurrFocus 98 — Study Companion");

  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: "Mostra / Focus Pannello",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.setIgnoreMouseEvents(false);
            mainWindow.setFocusable(true);
            mainWindow.focus();
          }
        }
      },
      {
        label: currentConfig?.muted ? "Attiva Audio 8-bit" : "Silenzia Audio 8-bit",
        click: () => {
          if (currentConfig) {
            currentConfig.muted = !currentConfig.muted;
            pushUiState();
            rebuildMenu();
          }
        }
      },
      { type: "separator" },
      {
        label: "Uscita Emergenza (Ctrl+Alt+Shift+Q)",
        click: () => {
          teardownSession();
          restoreAllSavedWindows();
          app.quit();
        }
      }
    ]);
    tray?.setContextMenu(menu);
  };

  rebuildMenu();
}

function createOverlayWindow(): void {
  const bounds = screen.getPrimaryDisplay().bounds;
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const rendererHtml = path.resolve(__dirname, "..", "renderer", "index.html");
  void mainWindow.loadFile(rendererHtml);

  mainWindow.webContents.once("did-finish-load", () => {
    pushUiState();
    if (isSmokeTest) {
      const snap = getActiveWindowSnapshot(getOwnPids());
      console.log(
        `SMOKE_OK workArea=${JSON.stringify(getWorkAreaDip())} fg=${snap?.processName ?? "none"}`
      );
      setTimeout(() => {
        app.quit();
      }, 450);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("session:get-cats", () => {
    const manifestPath = path.resolve(__dirname, "..", "renderer", "assets", "cats", "manifest.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    return JSON.parse(raw) as CatSkinManifestEntry[];
  });

  ipcMain.handle("session:start", (_event, config: SessionConfig) => {
    startStudySession(config);
  });

  ipcMain.handle("enforcer:open-court", () => {
    enforcer?.openExcuseCourt();
  });

  ipcMain.handle("enforcer:submit-excuse", (_event, excuseText: string) => {
    return enforcer?.submitExcuse(excuseText);
  });

  ipcMain.handle("enforcer:cancel-court", () => {
    enforcer?.cancelNegotiationAndStrike();
  });

  ipcMain.handle("session:surrender-phrase", () => {
    surrenderOpenedAt = Date.now();
    surrenderModalOpen = true;
    if (!currentSurrenderPhrase) {
      currentSurrenderPhrase = buildSurrenderPhrase(currentConfig?.goal ?? "lo studio");
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.setFocusable(true);
      mainWindow.focus();
    }
    return currentSurrenderPhrase;
  });

  ipcMain.handle("session:cancel-surrender", () => {
    surrenderModalOpen = false;
    if (mainWindow && !mainWindow.isDestroyed() && phase === "ACTIVE") {
      mainWindow.setFocusable(false);
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  ipcMain.handle("session:attempt-surrender", (_event, typedPhrase: string) => {
    const elapsed = Date.now() - surrenderOpenedAt;
    const result = validateSurrenderInput(currentSurrenderPhrase, typedPhrase, elapsed);
    if (result.valid) {
      surrenderModalOpen = false;
      finishSession(false);
    }
    return result;
  });

  ipcMain.handle("session:toggle-mute", (_event, muted: boolean) => {
    if (currentConfig) {
      currentConfig.muted = muted;
      pushUiState();
    }
  });

  ipcMain.handle("session:reset-launcher", () => {
    teardownSession();
    phase = "LAUNCHER";
    badge = {
      state: "IDLE",
      label: "Pronto",
      quotaStatus: badge.quotaStatus,
      usedFallback: badge.usedFallback
    };
    lastOverlayCommand = { mode: "IDLE_PERCH", workArea: getWorkAreaDip() };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.setFocusable(true);
      mainWindow.focus();
    }
    pushUiState();
  });

  ipcMain.on("overlay:set-interactive", (_event, interactive: boolean, focusable = false) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (
      phase === "LAUNCHER" ||
      phase === "REPORT" ||
      surrenderModalOpen ||
      enforcer?.getPhase() === "NEGOTIATING"
    ) {
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.setFocusable(true);
      return;
    }

    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
    mainWindow.setFocusable(Boolean(focusable));
    if (interactive && focusable) {
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createOverlayWindow();
  if (!isSmokeTest) {
    setupTray();
    globalShortcut.register("CommandOrControl+Alt+Shift+Q", () => {
      teardownSession();
      restoreAllSavedWindows();
      app.quit();
    });
  }
});

app.on("will-quit", () => {
  teardownSession();
  restoreAllSavedWindows();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
