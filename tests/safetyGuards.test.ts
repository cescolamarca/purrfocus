import { describe, expect, it } from "vitest";
import { buildSurrenderPhrase, validateSurrenderInput } from "../src/shared/antiCheat";
import { evaluateExcuseLocally, evaluateLocally } from "../src/main/localFallbackJudge";
import {
  INPUT_STRUCT_SIZE,
  canSendCtrlWSafely,
  isBrowserProcess
} from "../src/main/win32";
import type { WindowSnapshot } from "../src/shared/types";

function makeWin(processName: string, title: string, isBrowser: boolean): WindowSnapshot {
  return {
    hwnd: 5555,
    pid: 99,
    processName,
    title,
    rawRect: { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 },
    isMaximized: false,
    isMinimized: false,
    isBrowser
  };
}

describe("safety guards, Win32 structs, anti-cheat and local fallback", () => {
  it("matches Windows x64 INPUT struct size (40 bytes)", () => {
    expect(INPUT_STRUCT_SIZE).toBe(40);
  });

  it("blocks Ctrl+W when foreground window drifted or is not a browser", () => {
    expect(isBrowserProcess("chrome.exe")).toBe(true);
    expect(isBrowserProcess("CODE.EXE")).toBe(false);
    expect(canSendCtrlWSafely(100, 100, "msedge.exe")).toBe(true);
    expect(canSendCtrlWSafely(101, 100, "msedge.exe")).toBe(false);
    expect(canSendCtrlWSafely(100, 100, "code.exe")).toBe(false);
    expect(canSendCtrlWSafely(0, 100, "chrome.exe")).toBe(false);
  });

  it("enforces surrender cooldown and exact manual phrase typing", () => {
    const phrase = buildSurrenderPhrase("Studiare Sistemi Operativi");
    expect(validateSurrenderInput(phrase, phrase, 3000).valid).toBe(false);
    expect(validateSurrenderInput(phrase, phrase.slice(0, -3), 12_000).valid).toBe(false);
    expect(validateSurrenderInput(phrase, phrase, 12_000).valid).toBe(true);
  });

  it("classifies study vs distraction cleanly in local fallback mode", () => {
    const ide = evaluateLocally(
      "Ripasso Grafi",
      makeWin("code.exe", "dijkstra.ts - Visual Studio Code", false)
    );
    expect(ide.verdict).toBe("STUDYING");

    const ig = evaluateLocally(
      "Ripasso Grafi",
      makeWin("chrome.exe", "Instagram Reels - Google Chrome", true)
    );
    expect(ig.verdict).toBe("DISTRACTED");
    expect(ig.distractionTarget).toBe("BROWSER_TAB");

    const game = evaluateLocally("Ripasso Grafi", makeWin("steam.exe", "Steam", false));
    expect(game.verdict).toBe("DISTRACTED");
    expect(game.distractionTarget).toBe("DESKTOP_APP");

    expect(evaluateExcuseLocally("Ripasso Grafi", "asd").approved).toBe(false);
    expect(
      evaluateExcuseLocally("Ripasso Grafi", "Sto guardando la lezione sui grafi di Dijkstra").approved
    ).toBe(true);
  });
});
