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
      concedeAndCloseNow: () => Promise<void>;
      requestSurrenderPhrase: () => Promise<string>;
      cancelSurrenderModal: () => Promise<void>;
      attemptSurrender: (typedPhrase: string) => Promise<{ valid: boolean; reason?: string }>;
      setModalLock: (locked: boolean) => Promise<void>;
      completeTask: (completionNote: string) => Promise<void>;
      forceCheckNow: () => Promise<string>;
      toggleMute: (muted: boolean) => Promise<void>;
      resetToLauncher: () => Promise<void>;
      setOverlayInteractive: (interactive: boolean, focusable?: boolean) => void;
      onStateUpdate: (callback: (state: RendererUiState) => void) => () => void;
      onOpenCompleteRequested: (callback: () => void) => () => void;
    };
  }
}

const audio = new RetroAudioSynth();
const physics = new CatPhysicsEngine(() => audio.playPurr());

const viewportRoot = document.getElementById("viewport-root")!;
const canvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const BLEED_X = 2;
const BLEED_Y = 36;

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
const btnHudComplete = document.getElementById("btn-hud-complete")!;
const btnHudMute = document.getElementById("btn-hud-mute")!;
const btnHudSurrender = document.getElementById("btn-hud-surrender")!;

const catSpeechBubble = document.getElementById("cat-speech-bubble")!;
const catSpeechText = document.getElementById("cat-speech-text")!;

const catContextMenu = document.getElementById("cat-context-menu")!;
const menuCompleteTask = document.getElementById("menu-complete-task")!;
const menuForceCheck = document.getElementById("menu-force-check")!;
const menuGiveTreat = document.getElementById("menu-give-treat")!;
const menuSurrender = document.getElementById("menu-surrender")!;

const shameNoteWindow = document.getElementById("shame-note-window")!;
const shameNoteText = document.getElementById("shame-note-text")!;
const shameNoteTarget = document.getElementById("shame-note-target")!;
const btnShameClose = document.getElementById("btn-shame-close")!;
const btnShameAck = document.getElementById("btn-shame-ack")!;

const warningBalloon = document.getElementById("warning-balloon")!;
const balloonCountdownText = document.getElementById("balloon-countdown-text")!;
const balloonMessage = document.getElementById("balloon-message")!;
const balloonProgressFill = document.getElementById("balloon-progress-fill")!;
const btnConcedeNow = document.getElementById("btn-concede-now")!;
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

const completeBackdrop = document.getElementById("complete-backdrop")!;
const completeGoalLabel = document.getElementById("complete-goal-label")!;
const completeElapsedLabel = document.getElementById("complete-elapsed-label")!;
const completeNoteInput = document.getElementById("complete-note-input") as HTMLInputElement;
const completeError = document.getElementById("complete-error")!;
const btnCompleteClose = document.getElementById("btn-complete-close")!;
const btnCompleteConfirm = document.getElementById("btn-complete-confirm")!;
const btnCompleteCancel = document.getElementById("btn-complete-cancel")!;

const reportBackdrop = document.getElementById("report-backdrop")!;
const reportStatsBox = document.getElementById("report-stats-box")!;
const reportVerdict = document.getElementById("report-verdict")!;
const btnReportNew = document.getElementById("btn-report-new")!;

let skins: CatSkinManifestEntry[] = [];
const skinImages = new Map<string, HTMLImageElement>();
let selectedSkinId = "calico-00";
let lastUiState: RendererUiState | null = null;
let warningStartedAt = 0;
let warningTotalMs = 18_000;
let lastMode = "";
let lastInteractiveFlag: boolean | null = null;
let lastClientX = -1;
let lastClientY = -1;
let surrenderOpen = false;
let completeOpen = false;
let dismissedShameId = 0;
let localBubbleExpiresAt = 0;
let lastServerBubbleExpiresAt = 0;
let previewTick = 0;
let hudCollapsed = false;

function resizeOverlayCanvas(): void {
  canvas.width = viewportRoot.clientWidth || window.innerWidth;
  canvas.height = viewportRoot.clientHeight || window.innerHeight;
}
window.addEventListener("resize", resizeOverlayCanvas);
resizeOverlayCanvas();

function formatClock(secondsTotal: number): string {
  const s = Math.max(0, Math.round(secondsTotal));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function showCatSpeechBubble(text: string, durationMs = 3000): void {
  localBubbleExpiresAt = performance.now() + durationMs;
  catSpeechText.textContent = text;
  catSpeechBubble.classList.remove("hidden");
}

function hideContextMenu(): void {
  catContextMenu.classList.add("hidden");
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
  dismissedShameId = 0;
  localBubbleExpiresAt = 0;
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

async function openCompleteModal(): Promise<void> {
  if (!lastUiState || lastUiState.phase !== "ACTIVE") {
    return;
  }
  hideContextMenu();
  completeOpen = true;
  completeError.classList.add("hidden");
  completeGoalLabel.textContent = lastUiState.config?.goal || "Obiettivo di studio";
  completeElapsedLabel.textContent = `${(lastUiState.stats.elapsedSeconds / 60).toFixed(1)} min`;
  completeNoteInput.value = "";
  completeBackdrop.classList.remove("hidden");
  await window.purrfocus.setModalLock(true);
  completeNoteInput.focus();
}

async function closeCompleteModal(): Promise<void> {
  completeOpen = false;
  completeBackdrop.classList.add("hidden");
  await window.purrfocus.setModalLock(false);
}

btnHudComplete.addEventListener("click", () => void openCompleteModal());
btnCompleteClose.addEventListener("click", () => void closeCompleteModal());
btnCompleteCancel.addEventListener("click", () => void closeCompleteModal());

btnCompleteConfirm.addEventListener("click", async () => {
  const note = completeNoteInput.value.trim();
  if (note.length < 4) {
    completeError.textContent = "Scrivi brevemente cosa hai completato (almeno 4 caratteri).";
    completeError.classList.remove("hidden");
    return;
  }
  completeOpen = false;
  completeBackdrop.classList.add("hidden");
  await window.purrfocus.completeTask(note);
});

completeNoteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void btnCompleteConfirm.click();
  }
});

window.purrfocus.onOpenCompleteRequested(() => {
  void openCompleteModal();
});

btnJustifyNow.addEventListener("click", async () => {
  audio.playCourtGavel();
  await window.purrfocus.openExcuseCourt();
});

btnConcedeNow.addEventListener("click", async () => {
  await window.purrfocus.concedeAndCloseNow();
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

async function openSurrenderModal(): Promise<void> {
  hideContextMenu();
  surrenderOpen = true;
  surrenderInput.value = "";
  surrenderError.classList.add("hidden");
  const phrase = await window.purrfocus.requestSurrenderPhrase();
  surrenderPhraseBox.textContent = phrase;
  surrenderBackdrop.classList.remove("hidden");
  window.purrfocus.setOverlayInteractive(true, true);
  surrenderInput.focus();
}

btnHudSurrender.addEventListener("click", () => void openSurrenderModal());

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

btnShameAck.addEventListener("click", () => {
  if (lastUiState?.shameNote) {
    dismissedShameId = lastUiState.shameNote.id;
  }
  shameNoteWindow.classList.add("hidden");
});
btnShameClose.addEventListener("click", () => btnShameAck.click());

menuCompleteTask.addEventListener("click", () => void openCompleteModal());
menuSurrender.addEventListener("click", () => void openSurrenderModal());

menuForceCheck.addEventListener("click", async () => {
  hideContextMenu();
  showCatSpeechBubble("Fammi controllare cosa stai combinando...", 2200);
  const reply = await window.purrfocus.forceCheckNow();
  showCatSpeechBubble(reply, 3600);
});

menuGiveTreat.addEventListener("click", () => {
  hideContextMenu();
  const elapsed = lastUiState?.stats.elapsedSeconds ?? 0;
  const rages = lastUiState?.stats.rageCount ?? 0;
  if (rages > 0 && elapsed < 30) {
    physics.emitHissFeedback("NO!");
    audio.playWarningHiss();
    showCatSpeechBubble("Niente croccantini dopo le distrazioni! Prima lavora!", 3200);
    return;
  }
  const pos = physics.getPosition();
  const viewW = viewportRoot.clientWidth || window.innerWidth;
  const offset = pos.x > viewW * 0.5 ? -180 : 180;
  physics.chaseTreat(pos.x + offset, pos.y + 42);
  showCatSpeechBubble("Miao! Croccantino meritato!", 2600);
});

btnReportNew.addEventListener("click", async () => {
  reportBackdrop.classList.add("hidden");
  await window.purrfocus.resetToLauncher();
});

function updateInteractiveHitTest(clientX: number, clientY: number): void {
  if (!lastUiState || lastUiState.phase !== "ACTIVE" || surrenderOpen || completeOpen) {
    return;
  }
  if (lastUiState.negotiation) {
    return;
  }

  const vx = clientX - BLEED_X;
  const vy = clientY - BLEED_Y;
  const el = document.elementFromPoint(clientX, clientY);
  const overUi = Boolean(el && el.closest(".interactive-ui"));
  const overCat = physics.isPointOverCat(vx, vy);
  const shouldBeInteractive = overUi || overCat;

  if (shouldBeInteractive !== lastInteractiveFlag) {
    lastInteractiveFlag = shouldBeInteractive;
    window.purrfocus.setOverlayInteractive(shouldBeInteractive, false);
  }
}

window.addEventListener("mousemove", (e) => {
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  physics.handlePointerMove(e.clientX - BLEED_X, e.clientY - BLEED_Y);
  updateInteractiveHitTest(e.clientX, e.clientY);
});

window.addEventListener("mousedown", (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || !el.closest("#cat-context-menu")) {
    hideContextMenu();
  }
  if (e.button !== 0) return;
  if (!lastUiState || lastUiState.phase !== "ACTIVE") {
    return;
  }
  if (el && el.closest(".interactive-ui")) {
    return;
  }
  physics.handlePointerDown(e.clientX - BLEED_X, e.clientY - BLEED_Y);
});

window.addEventListener("mouseup", () => {
  const outcome = physics.handlePointerUp();
  if (outcome === "PETTED") {
    const rages = lastUiState?.stats.rageCount ?? 0;
    if (rages >= 2) {
      showCatSpeechBubble("Fusa sospette... non provare a corrompermi, studia!", 2800);
    } else {
      showCatSpeechBubble("Purr... bravo umano! Tasto destro per opzioni.", 2800);
    }
  }
});

window.addEventListener("contextmenu", (e) => {
  if (!lastUiState || lastUiState.phase !== "ACTIVE") {
    return;
  }
  const vx = e.clientX - BLEED_X;
  const vy = e.clientY - BLEED_Y;
  if (physics.isPointOverCat(vx, vy)) {
    e.preventDefault();
    const mw = 190;
    const mh = 115;
    const viewW = viewportRoot.clientWidth || window.innerWidth;
    const viewH = viewportRoot.clientHeight || window.innerHeight;
    const left = Math.max(8, Math.min(viewW - mw - 8, vx));
    const top = Math.max(8, Math.min(viewH - mh - 8, vy));
    catContextMenu.style.left = `${Math.round(left)}px`;
    catContextMenu.style.top = `${Math.round(top)}px`;
    catContextMenu.classList.remove("hidden");
    window.purrfocus.setOverlayInteractive(true, false);
  }
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
  if (state.phase !== "ACTIVE") {
    hideContextMenu();
    shameNoteWindow.classList.add("hidden");
    catSpeechBubble.classList.add("hidden");
  }

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
      warningTotalMs = state.overlayCommand.countdownMs || 18_000;
      audio.playWarningHiss();
    } else if (mode === "POUNCE_STRIKE" || mode === "DRAGGING_WINDOW") {
      audio.playStrikeMeow();
    } else if (mode === "VICTORY") {
      audio.playVictoryFanfare();
    }
    lastMode = mode;
  }

  if (
    state.catSpeechBubble &&
    state.catSpeechBubble.expiresAt !== lastServerBubbleExpiresAt &&
    state.catSpeechBubble.expiresAt > Date.now()
  ) {
    lastServerBubbleExpiresAt = state.catSpeechBubble.expiresAt;
    showCatSpeechBubble(
      state.catSpeechBubble.text,
      Math.max(1500, state.catSpeechBubble.expiresAt - Date.now())
    );
  }

  const showShame =
    state.phase === "ACTIVE" &&
    Boolean(state.shameNote && state.shameNote.id !== dismissedShameId);
  shameNoteWindow.classList.toggle("hidden", !showShame);
  if (showShame && state.shameNote) {
    shameNoteText.textContent = state.shameNote.messageIt;
    shameNoteTarget.textContent = `Distrazione: ${state.shameNote.targetTitle}`;
  }

  const showBalloon = state.phase === "ACTIVE" && mode === "WARNING_CROUCH" && !state.negotiation;
  warningBalloon.classList.toggle("hidden", !showBalloon);
  if (showBalloon) {
    catSpeechBubble.classList.add("hidden");
    balloonMessage.textContent =
      state.overlayCommand.roastMessageIt || "Miao! Che cosa stai guardando?!";
    positionBubbleOverCat(warningBalloon, 265);
    if (lastClientX >= 0 && lastClientY >= 0) {
      updateInteractiveHitTest(lastClientX, lastClientY);
    }
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
    const finishedGoal =
      Boolean(state.stats.completedEarly) || state.stats.elapsedSeconds >= state.stats.targetSeconds;
    const totalPunishments = state.stats.tabsClosed + state.stats.windowsDragged;

    const noteHtml = state.stats.completionNote
      ? `<div>Traguardo raggiunto:</div><strong>${state.stats.completionNote.replace(/</g, "&lt;")}</strong>`
      : "";

    reportStatsBox.innerHTML = `
      <div>Tempo trascorso:</div><strong>${minsStudied} min</strong>
      ${noteHtml}
      <div>Schede chiuse dal gatto (Ctrl+W):</div><strong>${state.stats.tabsClosed}</strong>
      <div>Finestre trascinate via:</div><strong>${state.stats.windowsDragged}</strong>
      <div>Scuse approvate / respinte:</div><strong>${state.stats.excusesAccepted} / ${state.stats.excusesRejected}</strong>
    `;

    if (!finishedGoal) {
      reportVerdict.textContent =
        "Voto Felino: RITIRATO CON DISONORE. La prossima volta finisci il timer!";
    } else if (state.stats.completedEarly && totalPunishments === 0) {
      reportVerdict.textContent =
        "Voto Felino: MISSIONE COMPIUTA IN ANTICIPO (S+)! Efficienza da vero felino.";
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

function positionBubbleOverCat(el: HTMLElement, width: number): void {
  const pos = physics.getPosition();
  const bh = el.offsetHeight || 80;
  const viewW = viewportRoot.clientWidth || window.innerWidth;
  const left = Math.max(12, Math.min(viewW - width - 12, pos.x - 30));
  const flipBelow = pos.y - bh - 16 < 12;
  const top = flipBelow ? pos.y + CAT_DRAW_SIZE + 14 : pos.y - bh - 16;
  el.classList.toggle("flip-below", flipBelow);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

let lastTickTime = performance.now();
function animationLoop(now: number): void {
  const dt = now - lastTickTime;
  lastTickTime = now;

  if (lastUiState && lastUiState.phase !== "LAUNCHER") {
    physics.update(dt);
    physics.render(ctx);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  if (!warningBalloon.classList.contains("hidden")) {
    positionBubbleOverCat(warningBalloon, 265);
    const elapsed = now - warningStartedAt;
    const pct = Math.max(0, Math.min(100, 100 - (elapsed / warningTotalMs) * 100));
    balloonProgressFill.style.width = `${pct.toFixed(1)}%`;
    balloonCountdownText.textContent = `${Math.max(0, (warningTotalMs - elapsed) / 1000).toFixed(1)}s`;
  } else if (!catSpeechBubble.classList.contains("hidden")) {
    if (now > localBubbleExpiresAt) {
      catSpeechBubble.classList.add("hidden");
    } else {
      positionBubbleOverCat(catSpeechBubble, 225);
    }
  }

  if (!launcherBackdrop.classList.contains("hidden")) {
    previewTick += dt;
    const img = skinImages.get(selectedSkinId);
    if (img) {
      const cycle = Math.floor(previewTick / 3200) % 2;
      const frame =
        cycle === 0
          ? getSpriteFrameRect("SITTING", 0, Math.floor(previewTick / 260))
          : getSpriteFrameRect("WALKING", 6, Math.floor(previewTick / 180));
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
