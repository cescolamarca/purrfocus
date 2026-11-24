import path from "node:path";
import koffi from "koffi";
import type { Rect, WindowSnapshot } from "../shared/types";

export const BROWSER_PROCESSES = new Set([
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "brave.exe",
  "opera.exe",
  "vivaldi.exe",
  "arc.exe",
  "zen.exe",
  "waterfox.exe"
]);

export function isBrowserProcess(processName: string): boolean {
  return BROWSER_PROCESSES.has(processName.trim().toLowerCase());
}

/**
 * Ensures Ctrl+W is only synthesized if the foreground window still matches the
 * verified browser target at the exact moment of execution.
 */
export function canSendCtrlWSafely(
  currentForegroundHwnd: number,
  expectedHwnd: number,
  currentProcessName: string
): boolean {
  if (!currentForegroundHwnd || !expectedHwnd) {
    return false;
  }
  if (currentForegroundHwnd !== expectedHwnd) {
    return false;
  }
  return isBrowserProcess(currentProcessName);
}

const RECT = koffi.struct("RECT", {
  left: "int32",
  top: "int32",
  right: "int32",
  bottom: "int32"
});

const POINT = koffi.struct("POINT", {
  x: "int32",
  y: "int32"
});

const WINDOWPLACEMENT = koffi.struct("WINDOWPLACEMENT", {
  length: "uint32",
  flags: "uint32",
  showCmd: "uint32",
  ptMinPosition: POINT,
  ptMaxPosition: POINT,
  rcNormalPosition: RECT
});

const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
  dx: "int32",
  dy: "int32",
  mouseData: "uint32",
  dwFlags: "uint32",
  time: "uint32",
  dwExtraInfo: "uintptr"
});

const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
  wVk: "uint16",
  wScan: "uint16",
  dwFlags: "uint32",
  time: "uint32",
  dwExtraInfo: "uintptr"
});

const HARDWAREINPUT = koffi.struct("HARDWAREINPUT", {
  uMsg: "uint32",
  wParamL: "uint16",
  wParamH: "uint16"
});

const INPUT_UNION = koffi.union("INPUT_UNION", {
  mi: MOUSEINPUT,
  ki: KEYBDINPUT,
  hi: HARDWAREINPUT
});

const INPUT = koffi.struct("INPUT", {
  type: "uint32",
  u: INPUT_UNION
});

export const INPUT_STRUCT_SIZE = koffi.sizeof(INPUT);

interface NativeApi {
  GetForegroundWindow: () => number;
  GetWindowTextLengthW: (hwnd: number) => number;
  GetWindowTextW: (hwnd: number, buf: Buffer, maxCount: number) => number;
  GetClassNameW: (hwnd: number, buf: Buffer, maxCount: number) => number;
  GetWindowThreadProcessId: (hwnd: number, pidOut: [number]) => number;
  GetWindowRect: (hwnd: number, rectOut: Record<string, number>) => number;
  IsZoomed: (hwnd: number) => number;
  IsIconic: (hwnd: number) => number;
  IsWindow: (hwnd: number) => number;
  ShowWindow: (hwnd: number, nCmdShow: number) => number;
  SetWindowPos: (
    hwnd: number,
    hwndInsertAfter: number,
    x: number,
    y: number,
    cx: number,
    cy: number,
    flags: number
  ) => number;
  GetWindowPlacement: (hwnd: number, lpwndpl: Record<string, unknown>) => number;
  SetWindowPlacement: (hwnd: number, lpwndpl: Record<string, unknown>) => number;
  SetForegroundWindow: (hwnd: number) => number;
  GetCursorPos: (pointOut: Record<string, number>) => number;
  SetCursorPos: (x: number, y: number) => number;
  SendInput: (cInputs: number, pInputs: unknown[], cbSize: number) => number;
  OpenProcess: (access: number, inheritHandle: number, pid: number) => number;
  QueryFullProcessImageNameW: (
    hProcess: number,
    flags: number,
    exeNameBuf: Buffer,
    sizeOut: [number]
  ) => number;
  CloseHandle: (handle: number) => number;
}

let nativeApi: NativeApi | null = null;

function getNativeApi(): NativeApi {
  if (nativeApi) {
    return nativeApi;
  }

  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");

  nativeApi = {
    GetForegroundWindow: user32.func("uintptr __stdcall GetForegroundWindow()"),
    GetWindowTextLengthW: user32.func("int __stdcall GetWindowTextLengthW(uintptr hwnd)"),
    GetWindowTextW: user32.func("int __stdcall GetWindowTextW(uintptr hwnd, _Out_ uint16 *lpString, int nMaxCount)"),
    GetClassNameW: user32.func("int __stdcall GetClassNameW(uintptr hwnd, _Out_ uint16 *lpClassName, int nMaxCount)"),
    GetWindowThreadProcessId: user32.func(
      "uint32 __stdcall GetWindowThreadProcessId(uintptr hwnd, _Out_ uint32 *lpdwProcessId)"
    ),
    GetWindowRect: user32.func("int __stdcall GetWindowRect(uintptr hwnd, _Out_ RECT *lpRect)"),
    IsZoomed: user32.func("int __stdcall IsZoomed(uintptr hwnd)"),
    IsIconic: user32.func("int __stdcall IsIconic(uintptr hwnd)"),
    IsWindow: user32.func("int __stdcall IsWindow(uintptr hwnd)"),
    ShowWindow: user32.func("int __stdcall ShowWindow(uintptr hwnd, int nCmdShow)"),
    SetWindowPos: user32.func(
      "int __stdcall SetWindowPos(uintptr hwnd, uintptr hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)"
    ),
    GetWindowPlacement: user32.func(
      "int __stdcall GetWindowPlacement(uintptr hwnd, _Inout_ WINDOWPLACEMENT *lpwndpl)"
    ),
    SetWindowPlacement: user32.func(
      "int __stdcall SetWindowPlacement(uintptr hwnd, WINDOWPLACEMENT *lpwndpl)"
    ),
    SetForegroundWindow: user32.func("int __stdcall SetForegroundWindow(uintptr hwnd)"),
    GetCursorPos: user32.func("int __stdcall GetCursorPos(_Out_ POINT *lpPoint)"),
    SetCursorPos: user32.func("int __stdcall SetCursorPos(int X, int Y)"),
    SendInput: user32.func("uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)"),
    OpenProcess: kernel32.func(
      "uintptr __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)"
    ),
    QueryFullProcessImageNameW: kernel32.func(
      "int __stdcall QueryFullProcessImageNameW(uintptr hProcess, uint32 dwFlags, _Out_ uint16 *lpExeName, _Inout_ uint32 *lpdwSize)"
    ),
    CloseHandle: kernel32.func("int __stdcall CloseHandle(uintptr hObject)")
  };

  return nativeApi;
}

const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_CONTROL = 0x11;
const VK_W = 0x57;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

interface SavedPlacementEntry {
  hwnd: number;
  placement: Record<string, unknown>;
}

const savedPlacements = new Map<number, SavedPlacementEntry>();

function readWideString(fn: (buf: Buffer, maxChars: number) => number, maxChars = 512): string {
  const buf = Buffer.alloc(maxChars * 2);
  const copied = fn(buf, maxChars);
  if (copied <= 0) {
    return "";
  }
  return buf.toString("utf16le", 0, copied * 2);
}

function getProcessNameByPid(pid: number): string {
  if (!pid) {
    return "";
  }
  const api = getNativeApi();
  const handle = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) {
    return "";
  }
  try {
    const chars = 512;
    const buf = Buffer.alloc(chars * 2);
    const sizeOut: [number] = [chars];
    const ok = api.QueryFullProcessImageNameW(handle, 0, buf, sizeOut);
    if (!ok || sizeOut[0] <= 0) {
      return "";
    }
    const fullPath = buf.toString("utf16le", 0, sizeOut[0] * 2);
    return path.basename(fullPath).toLowerCase();
  } finally {
    api.CloseHandle(handle);
  }
}

export function getWindowClassName(hwnd: number): string {
  if (!hwnd) {
    return "";
  }
  const api = getNativeApi();
  return readWideString((buf, max) => api.GetClassNameW(hwnd, buf, max), 128);
}

function toRect(raw: { left: number; top: number; right: number; bottom: number }): Rect {
  return {
    left: raw.left,
    top: raw.top,
    right: raw.right,
    bottom: raw.bottom,
    width: Math.max(0, raw.right - raw.left),
    height: Math.max(0, raw.bottom - raw.top)
  };
}

export function getActiveWindowSnapshot(ownPids: Set<number>): WindowSnapshot | null {
  if (process.platform !== "win32") {
    return null;
  }

  const api = getNativeApi();
  const hwnd = Number(api.GetForegroundWindow());
  if (!hwnd) {
    return null;
  }

  const pidOut: [number] = [0];
  api.GetWindowThreadProcessId(hwnd, pidOut);
  const pid = pidOut[0];
  if (ownPids.has(pid)) {
    return null;
  }

  const titleLen = api.GetWindowTextLengthW(hwnd);
  const title = readWideString(
    (buf, max) => api.GetWindowTextW(hwnd, buf, max),
    Math.min(Math.max(titleLen + 2, 256), 1024)
  );
  const processName = getProcessNameByPid(pid);

  const rectOut = { left: 0, top: 0, right: 0, bottom: 0 };
  api.GetWindowRect(hwnd, rectOut);

  return {
    hwnd,
    pid,
    processName,
    title,
    rawRect: toRect(rectOut),
    isMaximized: api.IsZoomed(hwnd) !== 0,
    isMinimized: api.IsIconic(hwnd) !== 0,
    isBrowser: isBrowserProcess(processName)
  };
}

export function getCursorPhysicalPoint(): { x: number; y: number } {
  const api = getNativeApi();
  const pt = { x: 0, y: 0 };
  api.GetCursorPos(pt);
  return pt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function tugCursorTowards(
  targetX: number,
  targetY: number,
  durationMs = 260
): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }
  const api = getNativeApi();
  const start = getCursorPhysicalPoint();
  const steps = Math.max(6, Math.round(durationMs / 16));
  const dx = targetX - start.x;
  const dy = targetY - start.y;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = 1 - Math.pow(1 - t, 2);
    api.SetCursorPos(Math.round(start.x + dx * ease), Math.round(start.y + dy * ease));
    await sleep(14);
  }
}

function makeKeyboardInput(wVk: number, flags = 0) {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk,
        wScan: 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0
      }
    }
  };
}

export function sendCtrlWToBrowser(expectedHwnd: number): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  const api = getNativeApi();
  const fgHwnd = Number(api.GetForegroundWindow());
  const pidOut: [number] = [0];
  api.GetWindowThreadProcessId(fgHwnd, pidOut);
  const currentProc = getProcessNameByPid(pidOut[0]);

  if (!canSendCtrlWSafely(fgHwnd, expectedHwnd, currentProc)) {
    return false;
  }

  const inputs = [
    makeKeyboardInput(VK_CONTROL, 0),
    makeKeyboardInput(VK_W, 0),
    makeKeyboardInput(VK_W, KEYEVENTF_KEYUP),
    makeKeyboardInput(VK_CONTROL, KEYEVENTF_KEYUP)
  ];

  const sent = api.SendInput(inputs.length, inputs, INPUT_STRUCT_SIZE);
  return sent === inputs.length;
}

export async function animateWindowDragAndMinimize(
  hwnd: number,
  physicalScreenBounds: Rect,
  onStep: (catPhysX: number, catPhysY: number, liveRect: Rect) => void
): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }
  const api = getNativeApi();
  if (!api.IsWindow(hwnd) || api.IsIconic(hwnd)) {
    return false;
  }

  const placement: Record<string, unknown> = {
    length: koffi.sizeof(WINDOWPLACEMENT),
    flags: 0,
    showCmd: 0,
    ptMinPosition: { x: 0, y: 0 },
    ptMaxPosition: { x: 0, y: 0 },
    rcNormalPosition: { left: 0, top: 0, right: 0, bottom: 0 }
  };

  const gotPlacement = api.GetWindowPlacement(hwnd, placement) !== 0;
  const originalPlacement = gotPlacement ? structuredClone(placement) : null;
  if (originalPlacement) {
    savedPlacements.set(hwnd, { hwnd, placement: originalPlacement });
  }

  if (api.IsZoomed(hwnd) !== 0) {
    api.ShowWindow(hwnd, SW_RESTORE);
    await sleep(60);
  }

  const rectOut = { left: 0, top: 0, right: 0, bottom: 0 };
  if (api.GetWindowRect(hwnd, rectOut) === 0) {
    return false;
  }

  const maxW = Math.round(physicalScreenBounds.width * 0.72);
  const maxH = Math.round(physicalScreenBounds.height * 0.75);
  const startX = rectOut.left;
  const startY = Math.max(physicalScreenBounds.top + 30, rectOut.top);
  const width = Math.min(Math.max(320, rectOut.right - rectOut.left), maxW);
  const height = Math.min(Math.max(240, rectOut.bottom - rectOut.top), maxH);

  const centerX = startX + width / 2;
  const screenMidX = physicalScreenBounds.left + physicalScreenBounds.width / 2;
  const dragRight = centerX >= screenMidX;
  const endX = dragRight
    ? physicalScreenBounds.right - 90
    : physicalScreenBounds.left - width + 90;
  const endY = Math.min(
    physicalScreenBounds.bottom - 140,
    startY + 45
  );

  const steps = 42;
  for (let i = 1; i <= steps; i++) {
    if (!api.IsWindow(hwnd) || api.IsIconic(hwnd)) {
      break;
    }
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = Math.round(startX + (endX - startX) * ease);
    const y = Math.round(startY + (endY - startY) * ease);

    api.SetWindowPos(hwnd, 0, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE);

    const liveRect: Rect = {
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height
    };
    const grabX = dragRight ? x + 52 : x + width - 52;
    const grabY = y + 8;
    onStep(grabX, grabY, liveRect);
    await sleep(16);
  }

  if (api.IsWindow(hwnd)) {
    api.ShowWindow(hwnd, SW_MINIMIZE);
    if (originalPlacement) {
      const restoreNormal = {
        ...originalPlacement,
        showCmd: SW_MINIMIZE
      };
      api.SetWindowPlacement(hwnd, restoreNormal);
    }
  }

  return true;
}

export function focusStudyWindow(studyHwnd: number): boolean {
  if (process.platform !== "win32" || !studyHwnd) {
    return false;
  }
  const api = getNativeApi();
  if (!api.IsWindow(studyHwnd)) {
    return false;
  }
  if (api.IsIconic(studyHwnd) !== 0) {
    api.ShowWindow(studyHwnd, SW_RESTORE);
  }
  return api.SetForegroundWindow(studyHwnd) !== 0;
}

export function restoreAllSavedWindows(): void {
  if (process.platform !== "win32") {
    return;
  }
  const api = getNativeApi();
  for (const [hwnd, entry] of savedPlacements.entries()) {
    if (api.IsWindow(hwnd)) {
      api.SetWindowPlacement(hwnd, entry.placement);
    }
  }
  savedPlacements.clear();
}
