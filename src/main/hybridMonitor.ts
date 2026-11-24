import { desktopCapturer } from "electron";
import type { AiVerdict, ModelId, QuotaStatus, WindowSnapshot } from "../shared/types";
import { evaluateActivityWithAi } from "./geminiJudge";

export const AMBIGUOUS_HOSTS = [
  "youtube",
  "reddit",
  "twitch",
  "instagram",
  "tiktok",
  "x.com",
  "twitter",
  "facebook",
  "netflix",
  "prime video",
  "primevideo",
  "disney+",
  "discord",
  "whatsapp",
  "telegram",
  "spotify",
  "9gag",
  "pinterest"
];

const SYSTEM_PROCESSES = new Set([
  "searchhost.exe",
  "startmenuexperiencehost.exe",
  "shellexperiencehost.exe",
  "lockapp.exe",
  "taskmgr.exe",
  "dwm.exe"
]);

const SYSTEM_CLASSES = new Set([
  "Shell_TrayWnd",
  "Shell_SecondaryTrayWnd",
  "NotifyIconOverflowWindow",
  "Windows.UI.Core.CoreWindow",
  "MultitaskingViewFrame",
  "TaskListThumbnailWnd"
]);

export interface CachedVerdictEntry {
  verdict: AiVerdict;
  storedAtMs: number;
  expiresAtMs: number;
}

export interface MonitorTimings {
  debounceMs: number;
  ambiguousTtlMs: number;
  auditIntervalMs: number;
}

export const DEFAULT_MONITOR_TIMINGS: MonitorTimings = {
  debounceMs: 1200,
  ambiguousTtlMs: 25_000,
  auditIntervalMs: 45_000
};

export interface MonitorStateSnapshot {
  pendingKey: string | null;
  pendingSinceMs: number;
  lastVisionCheckMs: number;
  verdictCache: Map<string, CachedVerdictEntry>;
  excuseGrants: Map<string, number>;
}

export interface MonitorDecision {
  action: "IGNORE" | "WAIT_DEBOUNCE" | "USE_CACHE" | "USE_EXCUSE" | "CAPTURE_AND_JUDGE";
  key: string;
  cachedVerdict?: AiVerdict;
  reason: string;
}

export function isSystemSurface(processName: string, className: string, title: string): boolean {
  const proc = processName.trim().toLowerCase();
  if (SYSTEM_PROCESSES.has(proc)) {
    return true;
  }
  if (SYSTEM_CLASSES.has(className)) {
    return true;
  }
  if (proc === "explorer.exe" && (!title.trim() || title === "Program Manager")) {
    return true;
  }
  return false;
}

export function isAmbiguousContext(processName: string, title: string): boolean {
  const proc = processName.trim().toLowerCase();
  const titleLower = title.toLowerCase();
  if (proc === "discord.exe" || proc === "whatsapp.exe" || proc === "telegram.exe") {
    return true;
  }
  return AMBIGUOUS_HOSTS.some((host) => titleLower.includes(host));
}

export function normalizeWindowKey(processName: string, title: string): string {
  const cleanTitle = title.trim().replace(/\s+/g, " ").slice(0, 140);
  return `${processName.trim().toLowerCase()}::${cleanTitle}`;
}

/**
 * Pure decision function determining whether the current window needs a Vision API
 * check, can be served from cache, or is still debouncing a quick Alt-Tab switch.
 */
export function decideMonitorAction(
  state: MonitorStateSnapshot,
  win: WindowSnapshot,
  className: string,
  nowMs: number,
  timings: MonitorTimings = DEFAULT_MONITOR_TIMINGS
): MonitorDecision {
  const key = normalizeWindowKey(win.processName, win.title);

  if (isSystemSurface(win.processName, className, win.title)) {
    return { action: "IGNORE", key, reason: "SYSTEM_SURFACE" };
  }

  const excuseExpiry = state.excuseGrants.get(key);
  if (excuseExpiry !== undefined && excuseExpiry > nowMs) {
    return { action: "USE_EXCUSE", key, reason: "ACTIVE_EXCUSE" };
  }

  const cached = state.verdictCache.get(key);
  const ambiguous = isAmbiguousContext(win.processName, win.title);
  const cacheValid =
    cached !== undefined &&
    cached.expiresAtMs > nowMs &&
    (!ambiguous || nowMs - cached.storedAtMs < timings.ambiguousTtlMs);

  const auditDue = nowMs - state.lastVisionCheckMs >= timings.auditIntervalMs;

  if (cacheValid && !auditDue) {
    return {
      action: "USE_CACHE",
      key,
      cachedVerdict: cached.verdict,
      reason: "CACHE_HIT"
    };
  }

  if (state.pendingKey !== key) {
    return { action: "WAIT_DEBOUNCE", key, reason: "DEBOUNCE_START" };
  }

  if (nowMs - state.pendingSinceMs < timings.debounceMs) {
    return { action: "WAIT_DEBOUNCE", key, reason: "DEBOUNCE_WAIT" };
  }

  if (cacheValid && auditDue) {
    return { action: "CAPTURE_AND_JUDGE", key, reason: "SPLIT_SCREEN_AUDIT" };
  }

  return {
    action: "CAPTURE_AND_JUDGE",
    key,
    reason: ambiguous && cached ? "AMBIGUOUS_REFRESH" : "NEW_CONTEXT"
  };
}

export async function capturePrimaryScreenJpeg(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 960, height: 540 }
    });
    const primary = sources[0];
    if (!primary || primary.thumbnail.isEmpty()) {
      return null;
    }
    const jpeg = primary.thumbnail.toJPEG(60);
    return jpeg.toString("base64");
  } catch {
    return null;
  }
}

export interface MonitorCallbacks {
  getActiveWindow: () => { snapshot: WindowSnapshot; className: string } | null;
  isBusyWithIntervention: () => boolean;
  onStatusUpdate: (info: {
    checkingVision: boolean;
    quotaStatus: QuotaStatus;
    usedFallback: boolean;
    studyWindow: WindowSnapshot | null;
  }) => void;
  onStudyWindowConfirmed: (win: WindowSnapshot) => void;
  onDistractionDetected: (info: {
    win: WindowSnapshot;
    verdict: AiVerdict;
    screenshotBase64: string | null;
    key: string;
  }) => void;
}

export class HybridMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isEvaluating = false;
  private state: MonitorStateSnapshot = {
    pendingKey: null,
    pendingSinceMs: 0,
    lastVisionCheckMs: 0,
    verdictCache: new Map(),
    excuseGrants: new Map()
  };
  private lastVerifiedStudyHwnd = 0;
  private lastQuotaStatus: QuotaStatus = "OK";
  private lastUsedFallback = false;

  constructor(
    private readonly config: {
      goal: string;
      modelId: ModelId;
      apiKeyOverride?: string;
    },
    private readonly callbacks: MonitorCallbacks
  ) {}

  start(): void {
    this.stop();
    this.state.lastVisionCheckMs = Date.now() - DEFAULT_MONITOR_TIMINGS.auditIntervalMs;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLastVerifiedStudyHwnd(): number {
    return this.lastVerifiedStudyHwnd;
  }

  grantTemporaryExcuse(key: string, minutes: number): void {
    this.state.excuseGrants.set(key, Date.now() + minutes * 60_000);
    this.state.verdictCache.delete(key);
  }

  invalidateKey(key: string): void {
    this.state.verdictCache.delete(key);
  }

  private getActiveExceptionDescriptions(nowMs: number): string[] {
    const active: string[] = [];
    for (const [key, exp] of this.state.excuseGrants.entries()) {
      if (exp > nowMs) {
        active.push(key);
      } else {
        this.state.excuseGrants.delete(key);
      }
    }
    return active;
  }

  async tick(): Promise<void> {
    if (this.isEvaluating || this.callbacks.isBusyWithIntervention()) {
      return;
    }

    const active = this.callbacks.getActiveWindow();
    if (!active) {
      return;
    }

    const { snapshot, className } = active;
    const nowMs = Date.now();
    const decision = decideMonitorAction(this.state, snapshot, className, nowMs);

    if (this.state.pendingKey !== decision.key) {
      this.state.pendingKey = decision.key;
      this.state.pendingSinceMs = nowMs;
    }

    if (decision.action === "IGNORE" || decision.action === "WAIT_DEBOUNCE") {
      return;
    }

    if (decision.action === "USE_EXCUSE") {
      this.lastVerifiedStudyHwnd = snapshot.hwnd;
      this.callbacks.onStudyWindowConfirmed(snapshot);
      return;
    }

    if (decision.action === "USE_CACHE" && decision.cachedVerdict) {
      if (decision.cachedVerdict.verdict === "STUDYING") {
        this.lastVerifiedStudyHwnd = snapshot.hwnd;
        this.callbacks.onStudyWindowConfirmed(snapshot);
      } else if (decision.cachedVerdict.verdict === "DISTRACTED") {
        this.callbacks.onDistractionDetected({
          win: snapshot,
          verdict: decision.cachedVerdict,
          screenshotBase64: null,
          key: decision.key
        });
      }
      return;
    }

    this.isEvaluating = true;
    this.callbacks.onStatusUpdate({
      checkingVision: true,
      quotaStatus: this.lastQuotaStatus,
      usedFallback: this.lastUsedFallback,
      studyWindow: null
    });

    try {
      const screenshotBase64 = await capturePrimaryScreenJpeg();
      const outcome = await evaluateActivityWithAi({
        modelId: this.config.modelId,
        apiKeyOverride: this.config.apiKeyOverride,
        goal: this.config.goal,
        windowSnapshot: snapshot,
        screenshotBase64,
        approvedExceptions: this.getActiveExceptionDescriptions(nowMs)
      });

      this.lastQuotaStatus = outcome.quotaStatus;
      this.lastUsedFallback = outcome.usedFallback;
      this.state.lastVisionCheckMs = Date.now();

      const verdict = outcome.data;
      if (verdict.verdict === "STUDYING") {
        this.state.verdictCache.set(decision.key, {
          verdict,
          storedAtMs: Date.now(),
          expiresAtMs: Date.now() + verdict.cacheSeconds * 1000
        });
        this.lastVerifiedStudyHwnd = snapshot.hwnd;
        this.callbacks.onStudyWindowConfirmed(snapshot);
        this.callbacks.onStatusUpdate({
          checkingVision: false,
          quotaStatus: this.lastQuotaStatus,
          usedFallback: this.lastUsedFallback,
          studyWindow: snapshot
        });
      } else if (verdict.verdict === "DISTRACTED" && verdict.confidence >= 0.6) {
        this.callbacks.onStatusUpdate({
          checkingVision: false,
          quotaStatus: this.lastQuotaStatus,
          usedFallback: this.lastUsedFallback,
          studyWindow: null
        });
        this.callbacks.onDistractionDetected({
          win: snapshot,
          verdict,
          screenshotBase64,
          key: decision.key
        });
      } else {
        this.callbacks.onStatusUpdate({
          checkingVision: false,
          quotaStatus: this.lastQuotaStatus,
          usedFallback: this.lastUsedFallback,
          studyWindow: null
        });
      }
    } finally {
      this.isEvaluating = false;
    }
  }
}
