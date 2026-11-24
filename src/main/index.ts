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
  CatSpeechBubble,
  MonitorStatusBadge,
  QuotaStatus,
  Rect,
  RendererUiState,
  SessionConfig,
  SessionStats,
  ShameNoteState,
  WindowSnapshot
} from "../shared/types";
import { EnforcerEngine } from "./enforcer";
import { HybridMonitor, normalizeWindowKey } from "./hybridMonitor";
import { evaluateLocally } from "./localFallbackJudge";
import {
  configureBorderlessOverlayWindow,
  getActiveWindowSnapshot,
  getPhysicalWindowRect,
  getWindowClassName,
  hwndFromNativeBuffer,
  restoreAllSavedWindows,
  setPhysicalWindowBoundsUnclamped,
  setPhysicalWindowClipRect,
  setWindowNoActivate
} from "./win32";

let mainWindow: BrowserWindow | null = null;
let overlayHwnd = 0;
let lastInteractive: boolean | null = null;
let lastFocusable: boolean | null = null;
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
let modalLockOpen = false;
let currentSurrenderPhrase = "";
let lastNegotiation: RendererUiState["negotiation"];
let lastShameNote: ShameNoteState | undefined;
let lastSpeechBubble: CatSpeechBubble | undefined;

const isSmokeTest = process.argv.includes("--smoke-test");
const BLEED_X = 2;
const BLEED_TOP = 36;
const BLEED_BOTTOM = 6;

app.commandLine.appendSwitch("disable-features", "WebRtcAllowWgcScreenCapturer");

const gotSingleInstanceLock = isSmokeTest || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

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
    distractionChecksTotal: 0,
    rageCount: 0
  };
}

function getWorkAreaDip(): Rect {
  const primary = screen.getPrimaryDisplay();
  const origin = primary.bounds;
  const wa = primary.workArea;
  const left = wa.x - origin.x;
  const top = wa.y - origin.y;
  return {
    left,
    top,
    right: left + wa.width,
    bottom: top + wa.height,
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
  const primary = screen.getPrimaryDisplay();
  const origin = primary.bounds;
  const scale = primary.scaleFactor || 1;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const converted = screen.screenToDipRect(mainWindow, {
        x: phys.left,
        y: phys.top,
        width: phys.width,
        height: phys.height
      });
      const left = converted.x - origin.x;
      const top = converted.y - origin.y;
      return {
        left,
        top,
        right: left + converted.width,
        bottom: top + converted.height,
        width: converted.width,
        height: converted.height
      };
    } catch {
      // Fall back to scale factor math if window bounds are unavailable
    }
  }
  const left = Math.round(phys.left / scale) - origin.x;
  const top = Math.round(phys.top / scale) - origin.y;
  const width = Math.round(phys.width / scale);
  const height = Math.round(phys.height / scale);
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

function toDipPoint(pt: { x: number; y: number }): { x: number; y: number } {
  const primary = screen.getPrimaryDisplay();
  const origin = primary.bounds;
  const scale = primary.scaleFactor || 1;
  try {
    const converted = screen.screenToDipPoint(pt);
    return { x: converted.x - origin.x, y: converted.y - origin.y };
  } catch {
    return {
      x: Math.round(pt.x / scale) - origin.x,
      y: Math.round(pt.y / scale) - origin.y
    };
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
    surrenderPhrase: currentSurrenderPhrase || undefined,
    shameNote: lastShameNote,
    catSpeechBubble:
      lastSpeechBubble && lastSpeechBubble.expiresAt > Date.now() ? lastSpeechBubble : undefined
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
  lastShameNote = undefined;
  lastSpeechBubble = undefined;
  modalLockOpen = false;
}

function applyOverlayInputState(interactive: boolean, focusable: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (lastInteractive !== interactive) {
    lastInteractive = interactive;
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  }
  if (lastFocusable !== focusable) {
    lastFocusable = focusable;
    setWindowNoActivate(overlayHwnd, !focusable);
  }
  if (interactive && focusable) {
    mainWindow.focus();
  }
}

function finishSession(completedNaturally: boolean, completionNote?: string): void {
  teardownSession();
  if (completionNote) {
    stats.completedEarly = true;
    stats.completionNote = completionNote;
  }
  phase = "REPORT";
  badge = {
    state: "FINISHED",
    label: completedNaturally ? "Attività completata!" : "Resa registrata",
    quotaStatus: badge.quotaStatus,
    usedFallback: badge.usedFallback
  };
  lastOverlayCommand = {
    mode: completedNaturally ? "VICTORY" : "IDLE_PERCH",
    workArea: getWorkAreaDip()
  };
  applyOverlayInputState(true, true);
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

  applyOverlayInputState(false, false);

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
      onShameNote: (note) => {
        lastShameNote = note;
        pushUiState();
      },
      onSpeechBubble: (text, durationMs) => {
        lastSpeechBubble = { text, expiresAt: Date.now() + durationMs };
        pushUiState();
      },
      isTargetStillDistracting: (targetHwnd, originalKey) => {
        const snap = getActiveWindowSnapshot(getOwnPids());
        if (!snap) {
          return true;
        }
        if (snap.hwnd !== targetHwnd) {
          return evaluateLocally(config.goal, snap).verdict !== "STUDYING";
        }
        const currentKey = normalizeWindowKey(snap.processName, snap.title);
        if (currentKey !== originalKey) {
          return evaluateLocally(config.goal, snap).verdict !== "STUDYING";
        }
        return true;
      },
      onPhaseOrCommand: (info) => {
        lastOverlayCommand = info.command;
        lastNegotiation = info.negotiation;
        if (info.phase === "WARNING") {
          badge = { ...badge, state: "WARNING", label: "Distrazione rilevata!" };
        } else if (info.phase === "NEGOTIATING") {
          badge = { ...badge, state: "NEGOTIATING", label: "Tribunale Felino" };
          applyOverlayInputState(true, true);
        } else if (info.phase === "STRIKING") {
          badge = { ...badge, state: "STRIKING", label: "Zampata in corso!" };
          if (!modalLockOpen) {
            applyOverlayInputState(false, false);
          }
        } else {
          if (info.quotaStatus !== undefined && info.usedFallback !== undefined) {
            updateBadgeFromQuota("STUDYING", "Studio OK", info.quotaStatus, info.usedFallback);
          } else {
            badge = { ...badge, state: "STUDYING", label: "Studio OK" };
          }
          if (!modalLockOpen) {
            applyOverlayInputState(false, false);
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
      },
      onIdleDetected: (idleSeconds) => {
        void enforcer?.handleIdlePhoneNudge(idleSeconds);
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
            applyOverlayInputState(true, true);
          }
        }
      },
      {
        label: "Segna Attività Completata",
        click: () => {
          if (phase === "ACTIVE" && mainWindow && !mainWindow.isDestroyed()) {
            modalLockOpen = true;
            mainWindow.show();
            applyOverlayInputState(true, true);
            mainWindow.webContents.send("ui:open-complete");
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

function getPhysicalViewportClip(): {
  winX: number;
  winY: number;
  winW: number;
  winH: number;
  physLeft: number;
  physTop: number;
  physRight: number;
  physBottom: number;
  scale: number;
} {
  const primary = screen.getPrimaryDisplay();
  const scale = primary.scaleFactor || 1;
  const bleedPhysLeft = Math.round(BLEED_X * scale);
  const bleedPhysTop = Math.round(BLEED_TOP * scale);
  const bleedPhysBottom = Math.round(BLEED_BOTTOM * scale);
  const physMonW = Math.round(primary.bounds.width * scale);
  const physMonH = Math.round(primary.bounds.height * scale);

  const winX = Math.round(primary.bounds.x * scale) - bleedPhysLeft;
  const winY = Math.round(primary.bounds.y * scale) - bleedPhysTop;
  const winW = physMonW + bleedPhysLeft * 2;
  const winH = physMonH + bleedPhysTop + bleedPhysBottom;

  return {
    winX,
    winY,
    winW,
    winH,
    physLeft: bleedPhysLeft,
    physTop: bleedPhysTop,
    physRight: bleedPhysLeft + physMonW,
    physBottom: bleedPhysTop + physMonH,
    scale
  };
}

function applyViewportClipShape(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !overlayHwnd) {
    return;
  }
  const clip = getPhysicalViewportClip();
  setPhysicalWindowBoundsUnclamped(overlayHwnd, clip.winX, clip.winY, clip.winW, clip.winH);
  setPhysicalWindowClipRect(
    overlayHwnd,
    clip.physLeft,
    clip.physTop,
    clip.physRight,
    clip.physBottom
  );
}

function createOverlayWindow(): void {
  const bounds = screen.getPrimaryDisplay().bounds;
  mainWindow = new BrowserWindow({
    x: bounds.x - BLEED_X,
    y: bounds.y - BLEED_TOP,
    width: bounds.width + BLEED_X * 2,
    height: bounds.height + BLEED_TOP + BLEED_BOTTOM,
    enableLargerThanScreen: true,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayHwnd = hwndFromNativeBuffer(mainWindow.getNativeWindowHandle());
  lastInteractive = null;
  lastFocusable = null;
  configureBorderlessOverlayWindow(overlayHwnd, true);
  applyViewportClipShape();
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.on("blur", () => {
    applyViewportClipShape();
  });

  mainWindow.on("focus", () => {
    applyViewportClipShape();
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    configureBorderlessOverlayWindow(overlayHwnd, false);
    applyViewportClipShape();
    mainWindow.show();
  });

  const rendererHtml = path.resolve(__dirname, "..", "renderer", "index.html");
  void mainWindow.loadFile(rendererHtml);

  mainWindow.webContents.once("did-finish-load", () => {
    configureBorderlessOverlayWindow(overlayHwnd);
    applyViewportClipShape();
    pushUiState();
    if (isSmokeTest) {
      const snap = getActiveWindowSnapshot(getOwnPids());
      const clip = getPhysicalViewportClip();
      const winRect = getPhysicalWindowRect(overlayHwnd);
      console.log(
        `SMOKE_OK workArea=${JSON.stringify(getWorkAreaDip())} winRect=${JSON.stringify(winRect)} clip=${clip.physLeft},${clip.physTop}..${clip.physRight},${clip.physBottom} scale=${clip.scale} fg=${snap?.processName ?? "none"}`
      );
      setTimeout(() => {
        app.quit();
      }, 450);
    }
  });

  mainWindow.on("closed", () => {
    overlayHwnd = 0;
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

  ipcMain.handle("enforcer:strike-now", () => {
    enforcer?.strikeNow();
  });

  ipcMain.handle("session:surrender-phrase", () => {
    surrenderOpenedAt = Date.now();
    modalLockOpen = true;
    if (!currentSurrenderPhrase) {
      currentSurrenderPhrase = buildSurrenderPhrase(currentConfig?.goal ?? "lo studio");
    }
    applyOverlayInputState(true, true);
    return currentSurrenderPhrase;
  });

  ipcMain.handle("session:cancel-surrender", () => {
    modalLockOpen = false;
    if (phase === "ACTIVE") {
      applyOverlayInputState(false, false);
    }
  });

  ipcMain.handle("session:attempt-surrender", (_event, typedPhrase: string) => {
    const elapsed = Date.now() - surrenderOpenedAt;
    const result = validateSurrenderInput(currentSurrenderPhrase, typedPhrase, elapsed);
    if (result.valid) {
      modalLockOpen = false;
      finishSession(false);
    }
    return result;
  });

  ipcMain.handle("session:set-modal-lock", (_event, locked: boolean) => {
    modalLockOpen = Boolean(locked);
    if (modalLockOpen) {
      applyOverlayInputState(true, true);
    } else if (phase === "ACTIVE") {
      applyOverlayInputState(false, false);
    }
  });

  ipcMain.handle("session:complete-task", (_event, completionNote: string) => {
    const cleanNote = completionNote.trim() || currentConfig?.goal || "Obiettivo completato";
    modalLockOpen = false;
    finishSession(true, cleanNote);
  });

  ipcMain.handle("monitor:force-check", async () => {
    if (!monitor) {
      return "Nessuna sessione attiva.";
    }
    const verdict = await monitor.forceImmediateCheck();
    if (!verdict) {
      return "Sto già controllando o sei sul desktop!";
    }
    if (verdict.verdict === "STUDYING") {
      return "Controllato! Qui stai studiando bene, bravo!";
    }
    if (verdict.verdict === "NEUTRAL_SYSTEM") {
      return "Finestra di sistema: apri i tuoi appunti o l'editor!";
    }
    return verdict.roastMessageIt || "Beccato a distrarti!";
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
    applyOverlayInputState(true, true);
    pushUiState();
  });

  ipcMain.on("overlay:set-interactive", (_event, interactive: boolean, focusable = false) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (
      phase === "LAUNCHER" ||
      phase === "REPORT" ||
      modalLockOpen ||
      enforcer?.getPhase() === "NEGOTIATING"
    ) {
      applyOverlayInputState(true, true);
      return;
    }

    applyOverlayInputState(Boolean(interactive), Boolean(focusable));
  });
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    registerIpcHandlers();
    createOverlayWindow();
    screen.on("display-metrics-changed", () => {
      applyViewportClipShape();
    });
    if (!isSmokeTest) {
      setupTray();
      globalShortcut.register("CommandOrControl+Alt+Shift+Q", () => {
        teardownSession();
        restoreAllSavedWindows();
        app.quit();
      });
    }
  });
}

app.on("will-quit", () => {
  teardownSession();
  restoreAllSavedWindows();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
