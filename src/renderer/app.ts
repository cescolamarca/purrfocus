import type {
  CatSkinManifestEntry,
  ModelId,
  RendererUiState,
  SessionConfig
} from "../shared/types";
import { CAT_DRAW_SIZE, CatPhysicsEngine } from "./catPhysics";
import { RetroAudioSynth } from "./retroAudio";
import { getSpriteFrameRect } from "./spriteMap";

declare global {
  interface Window {
    purrfocus: {
      getCatManifest: () => Promise<CatSkinManifestEntry[]>;
      startSession: (config: SessionConfig) => Promise<void>;
      openExcuseCourt: () => Promise<void>;
      submitExcuse: (excuseText: string) => Promise<void>;
      cancelNegotiation: () => Promise<void>;
      requestSurrenderPhrase: () => Promise<string>;
      cancelSurrenderModal: () => Promise<void>;
      attemptSurrender: (typedPhrase: string) => Promise<{ valid: boolean; reason?: string }>;
      toggleMute: (muted: boolean) => Promise<void>;
      resetToLauncher: () => Promise<void>;
      setOverlayInteractive: (interactive: boolean, focusable?: boolean) => void;
      onStateUpdate: (callback: (state: RendererUiState) => void) => () => void;
    };
  }
}

const audio = new RetroAudioSynth();
const physics = new CatPhysicsEngine(() => audio.playPurr());

const canvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const launcherBackdrop = document.getElementById("launcher-backdrop")!;
const previewCanvas = document.getElementById("preview-cat-canvas") as HTMLCanvasElement;
const previewCtx = previewCanvas.getContext("2d")!;
const selectedCatNameEl = document.getElementById("selected-cat-name")!;
const catSelectEl = document.getElementById("cat-select") as HTMLSelectElement;
const catSwatchesEl = document.getElementById("cat-swatches")!;
const goalInput = document.getElementById("goal-input") as HTMLInputElement;
const durationInput = document.getElementById("duration-input") as HTMLInputElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const audioCheckbox = document.getElementById("audio-checkbox") as HTMLInputElement;
const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement;
const launcherError = document.getElementById("launcher-error")!;
const btnLauncherHelp = document.getElementById("btn-launcher-help")!;
const btnStartSession = document.getElementById("btn-start-session")!;

const hudWindow = document.getElementById("hud-window")!;
const hudBody = document.getElementById("hud-body")!;
const btnHudCollapse = document.getElementById("btn-hud-collapse")!;
const hudTimerEl = document.getElementById("hud-timer")!;
const hudGoalEl = document.getElementById("hud-goal")!;
const hudLedEl = document.getElementById("hud-led")!;
const hudStatusTextEl = document.getElementById("hud-status-text")!;
const btnHudMute = document.getElementById("btn-hud-mute")!;
const btnHudSurrender = document.getElementById("btn-hud-surrender")!;

const warningBalloon = document.getElementById("warning-balloon")!;
const balloonCountdownText = document.getElementById("balloon-countdown-text")!;
const balloonMessage = document.getElementById("balloon-message")!;
const balloonProgressFill = document.getElementById("balloon-progress-fill")!;
const btnJustifyNow = document.getElementById("btn-justify-now")!;

const courtBackdrop = document.getElementById("court-backdrop")!;
const courtTargetTitle = document.getElementById("court-target-title")!;
const courtAccusation = document.getElementById("court-accusation")!;
const courtTimer = document.getElementById("court-timer")!;
const courtExcuseInput = document.getElementById("court-excuse-input") as HTMLTextAreaElement;
const courtReply = document.getElementById("court-reply")!;
const btnCourtSubmit = document.getElementById("btn-court-submit") as HTMLButtonElement;
const btnCourtSurrender = document.getElementById("btn-court-surrender") as HTMLButtonElement;

const surrenderBackdrop = document.getElementById("surrender-backdrop")!;
const surrenderPhraseBox = document.getElementById("surrender-phrase-box")!;
const surrenderInput = document.getElementById("surrender-input") as HTMLInputElement;
const surrenderError = document.getElementById("surrender-error")!;
const btnSurrenderClose = document.getElementById("btn-surrender-close")!;
const btnSurrenderConfirm = document.getElementById("btn-surrender-confirm")!;
const btnSurrenderBack = document.getElementById("btn-surrender-back")!;

const reportBackdrop = document.getElementById("report-backdrop")!;
const reportStatsBox = document.getElementById("report-stats-box")!;
const reportVerdict = document.getElementById("report-verdict")!;
const btnReportNew = document.getElementById("btn-report-new")!;

let skins: CatSkinManifestEntry[] = [];
const skinImages = new Map<string, HTMLImageElement>();
let selectedSkinId = "calico-00";
let lastUiState: RendererUiState | null = null;
let warningStartedAt = 0;
let warningTotalMs = 2500;
let lastMode = "";
let lastInteractiveFlag: boolean | null = null;
let surrenderOpen = false;
let previewTick = 0;
let hudCollapsed = false;

function resizeOverlayCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeOverlayCanvas);
resizeOverlayCanvas();

function formatClock(secondsTotal: number): string {
  const s = Math.max(0, Math.round(secondsTotal));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function selectSkin(id: string): void {
  selectedSkinId = id;
  catSelectEl.value = id;
  const skin = skins.find((s) => s.id === id);
  if (skin) {
    selectedCatNameEl.textContent = skin.label;
  }
  const img = skinImages.get(id);
  if (img) {
    physics.setSpriteImage(img);
  }
  for (const btn of catSwatchesEl.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.getAttribute("data-id") === id);
  }
}

async function initCatSkins(): Promise<void> {
  skins = await window.purrfocus.getCatManifest();
  catSelectEl.innerHTML = "";
  catSwatchesEl.innerHTML = "";

  const loadPromises = skins.map(
    (skin) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          skinImages.set(skin.id, img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = `./assets/cats/${encodeURIComponent(skin.file)}`;
      })
  );
  await Promise.all(loadPromises);

  for (const skin of skins) {
    const opt = document.createElement("option");
    opt.value = skin.id;
    opt.textContent = skin.label;
    catSelectEl.appendChild(opt);

    const swatchBtn = document.createElement("button");
    swatchBtn.type = "button";
    swatchBtn.className = "cat-swatch-btn";
    swatchBtn.title = skin.label;
    swatchBtn.setAttribute("data-id", skin.id);

    const mini = document.createElement("canvas");
    mini.width = 16;
    mini.height = 16;
    const mctx = mini.getContext("2d")!;
    const img = skinImages.get(skin.id);
    if (img) {
      const frame = getSpriteFrameRect("STANDING", 0, 0);
      mctx.imageSmoothingEnabled = false;
      mctx.drawImage(img, frame.sx, frame.sy, 16, 16, 0, 0, 16, 16);
    }
    swatchBtn.appendChild(mini);
    swatchBtn.addEventListener("click", () => selectSkin(skin.id));
    catSwatchesEl.appendChild(swatchBtn);
  }

  const preferred = skins.find((s) => s.id === "calico-00")?.id ?? skins[0]?.id;
  if (preferred) {
    selectSkin(preferred);
  }
}

catSelectEl.addEventListener("change", () => selectSkin(catSelectEl.value));

for (const btn of document.querySelectorAll(".preset-btn")) {
  btn.addEventListener("click", () => {
    const mins = btn.getAttribute("data-mins");
    if (mins) durationInput.value = mins;
  });
}

btnLauncherHelp.addEventListener("click", () => {
  const apiDetails = document.querySelector(".api-details") as HTMLDetailsElement | null;
  if (apiDetails) {
    apiDetails.open = !apiDetails.open;
  }
});

btnStartSession.addEventListener("click", async () => {
  const goal = goalInput.value.trim();
  const mins = Math.max(1, Math.min(360, Number(durationInput.value) || 25));
  if (goal.length < 3) {
    launcherError.textContent = "Scrivi cosa devi studiare o completare (almeno 3 caratteri).";
    launcherError.classList.remove("hidden");
    return;
  }
  launcherError.classList.add("hidden");
  const muted = !audioCheckbox.checked;
  audio.setMuted(muted);

  await window.purrfocus.startSession({
    goal,
    durationMinutes: mins,
    catSkinId: selectedSkinId,
    modelId: modelSelect.value as ModelId,
    muted,
    apiKeyOverride: apiKeyInput.value.trim() || undefined
  });
});

btnHudCollapse.addEventListener("click", () => {
  hudCollapsed = !hudCollapsed;
  hudBody.classList.toggle("hidden", hudCollapsed);
});

btnHudMute.addEventListener("click", async () => {
  const nextMuted = !audio.isMuted();
  audio.setMuted(nextMuted);
  await window.purrfocus.toggleMute(nextMuted);
});

btnJustifyNow.addEventListener("click", async () => {
  audio.playCourtGavel();
  await window.purrfocus.openExcuseCourt();
});

btnCourtSubmit.addEventListener("click", async () => {
  const txt = courtExcuseInput.value.trim();
  if (!txt) return;
  await window.purrfocus.submitExcuse(txt);
});

courtExcuseInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void btnCourtSubmit.click();
  }
});

btnCourtSurrender.addEventListener("click", async () => {
  await window.purrfocus.cancelNegotiation();
});

btnHudSurrender.addEventListener("click", async () => {
  surrenderOpen = true;
  surrenderInput.value = "";
  surrenderError.classList.add("hidden");
  const phrase = await window.purrfocus.requestSurrenderPhrase();
  surrenderPhraseBox.textContent = phrase;
  surrenderBackdrop.classList.remove("hidden");
  window.purrfocus.setOverlayInteractive(true, true);
  surrenderInput.focus();
});

surrenderInput.addEventListener("paste", (e) => e.preventDefault());
surrenderInput.addEventListener("drop", (e) => e.preventDefault());

async function closeSurrenderModal(): Promise<void> {
  surrenderOpen = false;
  surrenderBackdrop.classList.add("hidden");
  await window.purrfocus.cancelSurrenderModal();
}

btnSurrenderBack.addEventListener("click", () => void closeSurrenderModal());
btnSurrenderClose.addEventListener("click", () => void closeSurrenderModal());

btnSurrenderConfirm.addEventListener("click", async () => {
  const res = await window.purrfocus.attemptSurrender(surrenderInput.value);
  if (!res.valid) {
    surrenderError.textContent = res.reason || "Verifica fallita.";
    surrenderError.classList.remove("hidden");
    return;
  }
  surrenderOpen = false;
  surrenderBackdrop.classList.add("hidden");
});

btnReportNew.addEventListener("click", async () => {
  reportBackdrop.classList.add("hidden");
  await window.purrfocus.resetToLauncher();
});

function updateInteractiveHitTest(clientX: number, clientY: number): void {
  if (!lastUiState || lastUiState.phase !== "ACTIVE" || surrenderOpen) {
    return;
  }
  if (lastUiState.negotiation) {
    return;
  }

  const el = document.elementFromPoint(clientX, clientY);
  const overUi = Boolean(el && el.closest(".interactive-ui"));
  const overCat = physics.isPointOverCat(clientX, clientY);
  const shouldBeInteractive = overUi || overCat;

  if (shouldBeInteractive !== lastInteractiveFlag) {
    lastInteractiveFlag = shouldBeInteractive;
    window.purrfocus.setOverlayInteractive(shouldBeInteractive, false);
  }
}

window.addEventListener("mousemove", (e) => {
  physics.handlePointerMove(e.clientX, e.clientY);
  updateInteractiveHitTest(e.clientX, e.clientY);
});

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.closest(".interactive-ui")) {
    return;
  }
  physics.handlePointerDown(e.clientX, e.clientY);
});

window.addEventListener("mouseup", () => {
  physics.handlePointerUp();
});

function applyUiState(state: RendererUiState): void {
  lastUiState = state;
  physics.setWorkArea(state.workArea);
  if (state.config) {
    audio.setMuted(state.config.muted);
    if (state.config.catSkinId !== selectedSkinId && skinImages.has(state.config.catSkinId)) {
      selectSkin(state.config.catSkinId);
    }
  }

  launcherBackdrop.classList.toggle("hidden", state.phase !== "LAUNCHER");
  hudWindow.classList.toggle("hidden", state.phase !== "ACTIVE");
  reportBackdrop.classList.toggle("hidden", state.phase !== "REPORT");

  if (state.phase === "ACTIVE" && state.config) {
    const remaining = Math.max(0, state.stats.targetSeconds - state.stats.elapsedSeconds);
    hudTimerEl.textContent = formatClock(remaining);
    hudGoalEl.textContent = state.config.goal;
    hudStatusTextEl.textContent = state.badge.label;
    btnHudMute.textContent = state.config.muted ? "Audio: OFF" : "Audio: ON";

    hudLedEl.className = "status-led";
    if (state.badge.state === "WARNING" || state.badge.state === "STRIKING" || state.badge.state === "NEGOTIATING") {
      hudLedEl.classList.add("led-red");
    } else if (state.badge.state === "CHECKING_VISION" || state.badge.usedFallback) {
      hudLedEl.classList.add("led-yellow");
    } else {
      hudLedEl.classList.add("led-green");
    }
  }

  const mode = state.overlayCommand.mode;
  physics.applyCommand(state.overlayCommand);

  if (mode !== lastMode) {
    if (mode === "WARNING_CROUCH") {
      warningStartedAt = performance.now();
      warningTotalMs = state.overlayCommand.countdownMs || 2500;
      audio.playWarningHiss();
    } else if (mode === "POUNCE_STRIKE" || mode === "DRAGGING_WINDOW") {
      audio.playStrikeMeow();
    } else if (mode === "VICTORY") {
      audio.playVictoryFanfare();
    }
    lastMode = mode;
  }

  const showBalloon = state.phase === "ACTIVE" && mode === "WARNING_CROUCH" && !state.negotiation;
  warningBalloon.classList.toggle("hidden", !showBalloon);
  if (showBalloon) {
    balloonMessage.textContent =
      state.overlayCommand.roastMessageIt || "Miao! Che cosa stai guardando?!";
  }

  const showCourt = state.phase === "ACTIVE" && Boolean(state.negotiation);
  const wasCourtHidden = courtBackdrop.classList.contains("hidden");
  courtBackdrop.classList.toggle("hidden", !showCourt);
  if (showCourt && state.negotiation) {
    courtTargetTitle.textContent = state.negotiation.targetTitle;
    courtAccusation.textContent = state.negotiation.roastMessageIt;
    courtTimer.textContent = String(Math.ceil(state.negotiation.remainingMs / 1000));
    btnCourtSubmit.disabled = state.negotiation.pending;
    btnCourtSurrender.disabled = state.negotiation.pending;

    if (state.negotiation.replyMessageIt) {
      courtReply.textContent = state.negotiation.replyMessageIt;
      courtReply.classList.remove("hidden");
    } else {
      courtReply.classList.add("hidden");
    }

    if (wasCourtHidden) {
      courtExcuseInput.value = "";
      courtExcuseInput.focus();
    }
  }

  if (state.phase === "REPORT") {
    const minsStudied = (state.stats.elapsedSeconds / 60).toFixed(1);
    const finishedFull = state.stats.elapsedSeconds >= state.stats.targetSeconds;
    const totalPunishments = state.stats.tabsClosed + state.stats.windowsDragged;

    reportStatsBox.innerHTML = `
      <div>Tempo trascorso:</div><strong>${minsStudied} min</strong>
      <div>Schede chiuse dal gatto (Ctrl+W):</div><strong>${state.stats.tabsClosed}</strong>
      <div>Finestre trascinate via:</div><strong>${state.stats.windowsDragged}</strong>
      <div>Scuse approvate / respinte:</div><strong>${state.stats.excusesAccepted} / ${state.stats.excusesRejected}</strong>
    `;

    if (!finishedFull) {
      reportVerdict.textContent =
        "Voto Felino: RITIRATO CON DISONORE. La prossima volta finisci il timer!";
    } else if (totalPunishments === 0) {
      reportVerdict.textContent =
        "Voto Felino: S+! Nemmeno una distrazione. Ti sei guadagnato le fusa ufficiali.";
    } else if (totalPunishments <= 2) {
      reportVerdict.textContent =
        "Voto Felino: B+. Qualche zampata necessaria, ma hai portato a casa il risultato!";
    } else {
      reportVerdict.textContent =
        "Voto Felino: C-. Ho dovuto faticare più di te per tenerti sui libri!";
    }
  }
}

window.purrfocus.onStateUpdate(applyUiState);

let lastTickTime = performance.now();
function animationLoop(now: number): void {
  const dt = now - lastTickTime;
  lastTickTime = now;

  physics.update(dt);
  physics.render(ctx);

  if (!warningBalloon.classList.contains("hidden")) {
    const pos = physics.getPosition();
    const bw = 265;
    const bh = warningBalloon.offsetHeight || 115;
    const left = Math.max(12, Math.min(window.innerWidth - bw - 12, pos.x - 30));
    const flipBelow = pos.y - bh - 16 < 12;
    const top = flipBelow ? pos.y + CAT_DRAW_SIZE + 14 : pos.y - bh - 16;
    warningBalloon.classList.toggle("flip-below", flipBelow);
    warningBalloon.style.left = `${Math.round(left)}px`;
    warningBalloon.style.top = `${Math.round(top)}px`;

    const elapsed = now - warningStartedAt;
    const pct = Math.max(0, Math.min(100, 100 - (elapsed / warningTotalMs) * 100));
    balloonProgressFill.style.width = `${pct.toFixed(1)}%`;
    balloonCountdownText.textContent = `${Math.max(0, (warningTotalMs - elapsed) / 1000).toFixed(1)}s`;
  }

  if (!launcherBackdrop.classList.contains("hidden")) {
    previewTick += dt;
    const img = skinImages.get(selectedSkinId);
    if (img) {
      const frame = getSpriteFrameRect("WALKING", 0, Math.floor(previewTick / 190));
      previewCtx.clearRect(0, 0, 96, 96);
      previewCtx.imageSmoothingEnabled = false;
      previewCtx.drawImage(img, frame.sx, frame.sy, 16, 16, 16, 16, 64, 64);
    }
  }

  requestAnimationFrame(animationLoop);
}

void initCatSkins().then(() => {
  requestAnimationFrame(animationLoop);
});
