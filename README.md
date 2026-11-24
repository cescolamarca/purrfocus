# PurrFocus 98

A Windows desktop study companion with a retro Windows 98 UI, 16x16 pixel-art cat animations, and hybrid Win32 + Gemini vision distraction enforcement.

While you focus on your work, the cat walks or naps calmly along the top border of your study window or the Windows taskbar. If you drift onto social media, unrelated videos, or games, it pops up a classic yellow Clippy warning balloon for 2.5 seconds before pouncing across the screen to close the distracting tab (`Ctrl+W`) or physically drag the window away.

## Features

- **Retro Windows 98 & Clippy Aesthetic**: Built with `98.css`, yellow `#FFFFE1` warning balloons, and a lightweight WebAudio 8-bit synthesizer (meows, purrs, warning chimes, zero TTS voice-over).
- **18 Pixel-Art Cat Coats**: Supports all 18 sprite variations (`Calico`, `Black`, `Orange`, `Cottoncandy`, `Ghost`, `Retrogreen`, etc.) with 8-direction movement, idle sitting/napping, cursor petting, and manual pickup.
- **Hybrid Smart Monitoring**:
  - Zero-cost `1 Hz` Win32 polling (`GetForegroundWindow`, process name, title, window bounds) via `koffi`.
  - Compact `960x540` JPEG screen capture sent to **Gemini 2.5 Flash-Lite** (or selectable `gemma-4-26b-a4b-it`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`) only on uncached context switches, ambiguous sites (`YouTube`, `Reddit`, `Discord`), or periodic `45s` split-screen audits.
  - Automatic local heuristic fallback if API quota/credits (`402`/`429`) or network are unavailable.
- **Feline Study Court & Anti-Cheat**:
  - Click **"Aspetta! È per studio!"** within the 2.5s countdown to defend your screen in a 25-second modal judged against the live screenshot.
  - Early exit requires a 10-second cooldown and manually typing a surrender sentence (paste/drop blocked).
- **Safety Guards**:
  - Never sends `Alt+F4` to desktop apps; drags and minimizes windows while preserving `WINDOWPLACEMENT.rcNormalPosition`.
  - Re-verifies `GetForegroundWindow()` and browser process identity right before sending `Ctrl+W`.
  - Global emergency exit shortcut: `Ctrl+Alt+Shift+Q`.

## Architecture

- `src/main/win32.ts`: `koffi` FFI bindings to `user32.dll` and `kernel32.dll` for foreground window tracking, `SendInput`, cursor tugging, and 60 FPS window dragging.
- `src/main/hybridMonitor.ts`: Window state debounce (`1200ms`), verdict cache, ambiguous-host TTL, and `desktopCapturer` integration.
- `src/main/geminiJudge.ts` & `src/main/localFallbackJudge.ts`: Structured JSON evaluation with automatic local fallback.
- `src/main/enforcer.ts`: State machine managing the 2.5s warning, 25s excuse negotiation, and physical strikes.
- `src/renderer/spriteMap.ts` & `src/renderer/catPhysics.ts`: 60 FPS pixel-art renderer with fading pawprints and transparent click-through hit testing.

## Setup & Running

Requirements: Node.js 20+ on Windows (no C++ compiler required; `koffi` uses prebuilt binaries).

```powershell
git clone https://github.com/cescolamarca/purrfocus.git
cd purrfocus
npm install
npm run start
```

### API Key Configuration

PurrFocus reads `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) from your environment variables, or you can paste one inside the launcher's optional API section.

```powershell
# PowerShell (persistent user env variable)
[Environment]::SetEnvironmentVariable("GOOGLE_API_KEY", "your-google-ai-studio-key", "User")
```

## Development & Tests

```powershell
npm run typecheck
npm run build
npm test
```

## Sprite Sheet Attribution
https://pop-shop-packs.itch.io/
Uses the 16x16 **Tiny Cat** pixel-art sprite sheets.
