import { describe, expect, it, vi } from "vitest";
import type { AiVerdict, WindowSnapshot } from "../src/shared/types";

vi.mock("electron", () => ({
  desktopCapturer: {
    getSources: vi.fn(async () => [])
  },
  nativeImage: {
    createFromBitmap: vi.fn()
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }))
  }
}));

import {
  DEFAULT_MONITOR_TIMINGS,
  decideMonitorAction,
  isAmbiguousContext,
  normalizeWindowKey,
  type MonitorStateSnapshot
} from "../src/main/hybridMonitor";

function makeWin(processName: string, title: string, isBrowser = false): WindowSnapshot {
  return {
    hwnd: 1001,
    pid: 42,
    processName,
    title,
    rawRect: { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 },
    isMaximized: false,
    isMinimized: false,
    isBrowser
  };
}

function makeState(overrides: Partial<MonitorStateSnapshot> = {}): MonitorStateSnapshot {
  return {
    pendingKey: null,
    pendingSinceMs: 0,
    lastVisionCheckMs: 100_000,
    verdictCache: new Map(),
    excuseGrants: new Map(),
    ...overrides
  };
}

describe("hybridMonitor decision logic", () => {
  it("ignores Windows shell system surfaces", () => {
    const win = makeWin("explorer.exe", "Program Manager");
    const decision = decideMonitorAction(makeState(), win, "Shell_TrayWnd", 101_000);
    expect(decision.action).toBe("IGNORE");
  });

  it("uses crisp timings and debounces new contexts before triggering screenshot capture", () => {
    expect(DEFAULT_MONITOR_TIMINGS.debounceMs).toBe(650);
    expect(DEFAULT_MONITOR_TIMINGS.ambiguousTtlMs).toBe(12_000);
    expect(DEFAULT_MONITOR_TIMINGS.auditIntervalMs).toBe(25_000);

    const win = makeWin("chrome.exe", "YouTube - Funny Cats", true);
    const key = normalizeWindowKey(win.processName, win.title);

    const first = decideMonitorAction(makeState(), win, "Chrome_WidgetWin_1", 105_000);
    expect(first.action).toBe("WAIT_DEBOUNCE");

    const waiting = decideMonitorAction(
      makeState({ pendingKey: key, pendingSinceMs: 105_000 }),
      win,
      "Chrome_WidgetWin_1",
      105_400
    );
    expect(waiting.action).toBe("WAIT_DEBOUNCE");

    const ready = decideMonitorAction(
      makeState({ pendingKey: key, pendingSinceMs: 105_000 }),
      win,
      "Chrome_WidgetWin_1",
      105_800
    );
    expect(ready.action).toBe("CAPTURE_AND_JUDGE");
  });

  it("reuses cache for verified non-ambiguous windows and refreshes ambiguous hosts faster", () => {
    const studyWin = makeWin("code.exe", "graph.ts - Visual Studio Code");
    const studyKey = normalizeWindowKey(studyWin.processName, studyWin.title);
    const studyVerdict: AiVerdict = {
      verdict: "STUDYING",
      confidence: 0.95,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 60
    };

    const cachedState = makeState({
      lastVisionCheckMs: 100_000,
      verdictCache: new Map([
        [studyKey, { verdict: studyVerdict, storedAtMs: 100_000, expiresAtMs: 160_000 }]
      ])
    });

    const hit = decideMonitorAction(cachedState, studyWin, "Chrome_WidgetWin_1", 120_000);
    expect(hit.action).toBe("USE_CACHE");

    const ytWin = makeWin("chrome.exe", "YouTube - Algorithms Lecture", true);
    const ytKey = normalizeWindowKey(ytWin.processName, ytWin.title);
    expect(isAmbiguousContext(ytWin.processName, ytWin.title)).toBe(true);

    const ytState = makeState({
      pendingKey: ytKey,
      pendingSinceMs: 100_000,
      lastVisionCheckMs: 120_000,
      verdictCache: new Map([
        [ytKey, { verdict: studyVerdict, storedAtMs: 100_000, expiresAtMs: 160_000 }]
      ])
    });

    const staleAmbiguous = decideMonitorAction(
      ytState,
      ytWin,
      "Chrome_WidgetWin_1",
      100_000 + DEFAULT_MONITOR_TIMINGS.ambiguousTtlMs + 1000
    );
    expect(staleAmbiguous.action).toBe("CAPTURE_AND_JUDGE");
    expect(staleAmbiguous.reason).toBe("AMBIGUOUS_REFRESH");
  });

  it("triggers periodic split-screen audit even when foreground window stays cached", () => {
    const win = makeWin("code.exe", "notes.md - VS Code");
    const key = normalizeWindowKey(win.processName, win.title);
    const verdict: AiVerdict = {
      verdict: "STUDYING",
      confidence: 0.9,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 120
    };

    const state = makeState({
      pendingKey: key,
      pendingSinceMs: 100_000,
      lastVisionCheckMs: 100_000,
      verdictCache: new Map([[key, { verdict, storedAtMs: 100_000, expiresAtMs: 220_000 }]])
    });

    const audit = decideMonitorAction(
      state,
      win,
      "Chrome_WidgetWin_1",
      100_000 + DEFAULT_MONITOR_TIMINGS.auditIntervalMs + 500
    );
    expect(audit.action).toBe("CAPTURE_AND_JUDGE");
    expect(audit.reason).toBe("SPLIT_SCREEN_AUDIT");
  });

  it("honors active temporary excuse grants", () => {
    const win = makeWin("chrome.exe", "YouTube - Heap Sort", true);
    const key = normalizeWindowKey(win.processName, win.title);
    const state = makeState({
      excuseGrants: new Map([[key, 200_000]])
    });

    const decision = decideMonitorAction(state, win, "Chrome_WidgetWin_1", 150_000);
    expect(decision.action).toBe("USE_EXCUSE");
  });
});
