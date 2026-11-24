import type {
  AiVerdict,
  CatOverlayCommand,
  ModelId,
  NegotiationState,
  QuotaStatus,
  Rect,
  SessionStats,
  ShameNoteState,
  WindowSnapshot
} from "../shared/types";
import { evaluateExcuseWithAi } from "./geminiJudge";
import {
  animateWindowDragAndMinimize,
  focusStudyWindow,
  getCursorPhysicalPoint,
  hijackCursorToPoint,
  sendCtrlWToBrowser,
  shakeWindowViolently
} from "./win32";

export type EnforcerPhase = "IDLE" | "WARNING" | "NEGOTIATING" | "STRIKING";

interface ActiveTarget {
  win: WindowSnapshot;
  verdict: AiVerdict;
  screenshotBase64: string | null;
  key: string;
}

export interface EnforcerCallbacks {
  toDipRect: (physicalRect: Rect) => Rect;
  toDipPoint: (pt: { x: number; y: number }) => { x: number; y: number };
  getPhysicalScreenBounds: () => Rect;
  getWorkAreaDip: () => Rect;
  getLastStudyHwnd: () => number;
  getLastStudyDipRect: () => Rect | undefined;
  grantExcuse: (key: string, minutes: number) => void;
  invalidateKey: (key: string) => void;
  onShameNote: (note: ShameNoteState) => void;
  onSpeechBubble: (text: string, durationMs: number) => void;
  onPhaseOrCommand: (info: {
    phase: EnforcerPhase;
    command: CatOverlayCommand;
    negotiation?: NegotiationState;
    quotaStatus?: QuotaStatus;
    usedFallback?: boolean;
  }) => void;
}

const WARNING_COUNTDOWN_MS = 1800;

export class EnforcerEngine {
  private phase: EnforcerPhase = "IDLE";
  private activeTarget: ActiveTarget | null = null;
  private warningTimer: NodeJS.Timeout | null = null;
  private negotiationTimer: NodeJS.Timeout | null = null;
  private negotiationDeadline = 0;
  private negotiationPending = false;
  private disposed = false;
  private shameCounter = 0;

  constructor(
    private readonly config: {
      goal: string;
      modelId: ModelId;
      apiKeyOverride?: string;
    },
    private readonly stats: SessionStats,
    private readonly callbacks: EnforcerCallbacks
  ) {}

  isBusy(): boolean {
    return this.phase !== "IDLE";
  }

  getPhase(): EnforcerPhase {
    return this.phase;
  }

  handleDistraction(target: ActiveTarget): void {
    if (this.disposed || this.phase !== "IDLE") {
      return;
    }

    this.activeTarget = target;
    this.phase = "WARNING";
    this.stats.distractionChecksTotal += 1;

    const targetDip = this.callbacks.toDipRect(target.win.rawRect);
    this.callbacks.onPhaseOrCommand({
      phase: "WARNING",
      command: {
        mode: "WARNING_CROUCH",
        targetRect: targetDip,
        studyRect: this.callbacks.getLastStudyDipRect(),
        workArea: this.callbacks.getWorkAreaDip(),
        roastMessageIt:
          target.verdict.roastMessageIt ||
          "Miao! Questa scheda non sembra proprio materiale di studio...",
        countdownMs: WARNING_COUNTDOWN_MS,
        hwnd: target.win.hwnd
      }
    });

    this.clearTimers();
    this.warningTimer = setTimeout(() => {
      void this.executeStrike();
    }, WARNING_COUNTDOWN_MS);
  }

  async handleIdlePhoneNudge(idleSeconds: number): Promise<void> {
    if (this.disposed || this.phase !== "IDLE") {
      return;
    }
    this.phase = "STRIKING";
    const physBounds = this.callbacks.getPhysicalScreenBounds();
    const cur = getCursorPhysicalPoint();
    const centerX = Math.round(physBounds.left + physBounds.width * 0.5);
    const centerY = Math.round(physBounds.top + physBounds.height * 0.45);
    const pullX = Math.round((cur.x + centerX) * 0.5);
    const pullY = Math.round((cur.y + centerY) * 0.5);

    const dipPt = this.callbacks.toDipPoint(pullX >= 0 ? { x: pullX, y: pullY } : { x: 500, y: 360 });
    this.callbacks.onSpeechBubble(
      `Ehi! ${idleSeconds}s senza toccare il PC... posa il telefono e torna su «${this.config.goal}»!`,
      4500
    );
    this.callbacks.onPhaseOrCommand({
      phase: "STRIKING",
      command: {
        mode: "POUNCE_STRIKE",
        targetRect: {
          left: dipPt.x - 100,
          top: dipPt.y - 20,
          right: dipPt.x + 100,
          bottom: dipPt.y + 80,
          width: 200,
          height: 100
        },
        workArea: this.callbacks.getWorkAreaDip()
      }
    });

    await hijackCursorToPoint(pullX, pullY, 20, 480);
    if (!this.disposed) {
      setTimeout(() => {
        if (!this.disposed) {
          this.returnToIdle();
        }
      }, 650);
    }
  }

  openExcuseCourt(): void {
    if (this.disposed || this.phase !== "WARNING" || !this.activeTarget) {
      return;
    }

    this.clearTimers();
    this.phase = "NEGOTIATING";
    this.negotiationPending = false;
    this.negotiationDeadline = Date.now() + 25_000;

    const emitNegotiationTick = () => {
      if (this.disposed || this.phase !== "NEGOTIATING" || !this.activeTarget) {
        return;
      }
      const remainingMs = Math.max(0, this.negotiationDeadline - Date.now());
      this.callbacks.onPhaseOrCommand({
        phase: "NEGOTIATING",
        command: {
          mode: "NEGOTIATING",
          targetRect: this.callbacks.toDipRect(this.activeTarget.win.rawRect),
          workArea: this.callbacks.getWorkAreaDip(),
          roastMessageIt: this.activeTarget.verdict.roastMessageIt
        },
        negotiation: {
          remainingMs,
          roastMessageIt: this.activeTarget.verdict.roastMessageIt,
          targetTitle: this.activeTarget.win.title || this.activeTarget.win.processName,
          pending: this.negotiationPending
        }
      });

      if (remainingMs <= 0 && !this.negotiationPending) {
        this.clearTimers();
        void this.executeStrike();
      }
    };

    emitNegotiationTick();
    this.negotiationTimer = setInterval(emitNegotiationTick, 250);
  }

  async submitExcuse(excuseText: string): Promise<void> {
    if (this.disposed || this.phase !== "NEGOTIATING" || !this.activeTarget || this.negotiationPending) {
      return;
    }

    this.clearTimers();
    this.negotiationPending = true;
    const target = this.activeTarget;

    this.callbacks.onPhaseOrCommand({
      phase: "NEGOTIATING",
      command: {
        mode: "NEGOTIATING",
        workArea: this.callbacks.getWorkAreaDip()
      },
      negotiation: {
        remainingMs: Math.max(0, this.negotiationDeadline - Date.now()),
        roastMessageIt: target.verdict.roastMessageIt,
        targetTitle: target.win.title || target.win.processName,
        pending: true
      }
    });

    const outcome = await evaluateExcuseWithAi({
      modelId: this.config.modelId,
      apiKeyOverride: this.config.apiKeyOverride,
      goal: this.config.goal,
      windowSnapshot: target.win,
      screenshotBase64: target.screenshotBase64,
      excuseText
    });

    if (this.disposed) {
      return;
    }

    const judgment = outcome.data;
    if (judgment.approved) {
      this.stats.excusesAccepted += 1;
      this.callbacks.grantExcuse(target.key, judgment.grantMinutes);
      this.callbacks.onPhaseOrCommand({
        phase: "NEGOTIATING",
        quotaStatus: outcome.quotaStatus,
        usedFallback: outcome.usedFallback,
        command: {
          mode: "IDLE_PERCH",
          workArea: this.callbacks.getWorkAreaDip(),
          studyRect: this.callbacks.toDipRect(target.win.rawRect)
        },
        negotiation: {
          remainingMs: 0,
          roastMessageIt: target.verdict.roastMessageIt,
          targetTitle: target.win.title || target.win.processName,
          pending: false,
          replyMessageIt: judgment.replyMessageIt
        }
      });

      setTimeout(() => {
        if (!this.disposed) {
          this.returnToIdle(this.callbacks.toDipRect(target.win.rawRect));
        }
      }, 1400);
      return;
    }

    this.stats.excusesRejected += 1;
    this.callbacks.onPhaseOrCommand({
      phase: "NEGOTIATING",
      quotaStatus: outcome.quotaStatus,
      usedFallback: outcome.usedFallback,
      command: {
        mode: "WARNING_CROUCH",
        targetRect: this.callbacks.toDipRect(target.win.rawRect),
        workArea: this.callbacks.getWorkAreaDip()
      },
      negotiation: {
        remainingMs: 0,
        roastMessageIt: target.verdict.roastMessageIt,
        targetTitle: target.win.title || target.win.processName,
        pending: false,
        replyMessageIt: judgment.replyMessageIt
      }
    });

    setTimeout(() => {
      if (!this.disposed) {
        void this.executeStrike();
      }
    }, 1150);
  }

  cancelNegotiationAndStrike(): void {
    if (this.disposed || this.phase !== "NEGOTIATING") {
      return;
    }
    this.clearTimers();
    void this.executeStrike();
  }

  private maybeEmitShameNote(target: ActiveTarget): void {
    if (this.stats.rageCount < 2) {
      return;
    }
    this.shameCounter += 1;
    this.callbacks.onShameNote({
      id: this.shameCounter,
      strikeNumber: this.stats.rageCount,
      targetTitle: target.win.title || target.win.processName,
      messageIt: `VERBALE #${this.stats.rageCount}: Ti ho già beccato ${this.stats.rageCount} volte a divagare invece di completare "${this.config.goal}". Il gatto sta perdendo la pazienza!`
    });
  }

  private async executeStrike(): Promise<void> {
    if (this.disposed || !this.activeTarget) {
      this.returnToIdle();
      return;
    }

    this.clearTimers();
    this.phase = "STRIKING";
    this.stats.rageCount += 1;
    const target = this.activeTarget;
    const isBrowserTab =
      target.win.isBrowser && target.verdict.distractionTarget !== "DESKTOP_APP";

    const rawRect = target.win.rawRect;
    const dipTargetRect = this.callbacks.toDipRect(rawRect);
    const shakeAmount = this.stats.rageCount >= 2 ? 22 : 8;

    if (isBrowserTab) {
      this.callbacks.onPhaseOrCommand({
        phase: "STRIKING",
        command: {
          mode: "POUNCE_STRIKE",
          targetRect: dipTargetRect,
          workArea: this.callbacks.getWorkAreaDip(),
          roastMessageIt: target.verdict.roastMessageIt
        }
      });

      const tugTargetX = Math.round(rawRect.left + Math.min(280, Math.max(90, rawRect.width * 0.35)));
      const tugTargetY = Math.round(rawRect.top + 24);
      await hijackCursorToPoint(tugTargetX, tugTargetY, shakeAmount, 380);
      await shakeWindowViolently(target.win.hwnd, 260);

      if (!this.disposed) {
        const closed = sendCtrlWToBrowser(target.win.hwnd);
        if (closed) {
          this.stats.tabsClosed += 1;
        }
        this.callbacks.invalidateKey(target.key);
        const studyHwnd = this.callbacks.getLastStudyHwnd();
        if (studyHwnd && studyHwnd !== target.win.hwnd) {
          focusStudyWindow(studyHwnd);
        }
        this.maybeEmitShameNote(target);
      }

      setTimeout(() => {
        if (!this.disposed) {
          this.returnToIdle();
        }
      }, 650);
      return;
    }

    this.callbacks.onPhaseOrCommand({
      phase: "STRIKING",
      command: {
        mode: "DRAGGING_WINDOW",
        targetRect: dipTargetRect,
        workArea: this.callbacks.getWorkAreaDip(),
        roastMessageIt: target.verdict.roastMessageIt
      }
    });

    await hijackCursorToPoint(
      Math.round(rawRect.left + rawRect.width * 0.45),
      Math.round(rawRect.top + 18),
      shakeAmount,
      260
    );

    const dragged = await animateWindowDragAndMinimize(
      target.win.hwnd,
      this.callbacks.getPhysicalScreenBounds(),
      (catPhysX, catPhysY, livePhysRect) => {
        if (this.disposed) {
          return;
        }
        this.callbacks.onPhaseOrCommand({
          phase: "STRIKING",
          command: {
            mode: "DRAGGING_WINDOW",
            targetRect: this.callbacks.toDipRect(livePhysRect),
            workArea: this.callbacks.getWorkAreaDip(),
            catAnchor: this.callbacks.toDipPoint({ x: catPhysX, y: catPhysY }),
            roastMessageIt: target.verdict.roastMessageIt
          }
        });
      }
    );

    if (!this.disposed) {
      if (dragged) {
        this.stats.windowsDragged += 1;
      }
      this.callbacks.invalidateKey(target.key);
      const studyHwnd = this.callbacks.getLastStudyHwnd();
      if (studyHwnd && studyHwnd !== target.win.hwnd) {
        focusStudyWindow(studyHwnd);
      }
      this.maybeEmitShameNote(target);
      this.returnToIdle();
    }
  }

  private returnToIdle(studyRectDip?: Rect): void {
    this.clearTimers();
    this.activeTarget = null;
    this.negotiationPending = false;
    this.phase = "IDLE";
    this.callbacks.onPhaseOrCommand({
      phase: "IDLE",
      command: {
        mode: "IDLE_PERCH",
        studyRect: studyRectDip ?? this.callbacks.getLastStudyDipRect(),
        workArea: this.callbacks.getWorkAreaDip()
      }
    });
  }

  private clearTimers(): void {
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.negotiationTimer) {
      clearInterval(this.negotiationTimer);
      this.negotiationTimer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.activeTarget = null;
    this.phase = "IDLE";
  }
}
