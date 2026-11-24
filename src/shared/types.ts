export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface WindowSnapshot {
  hwnd: number;
  pid: number;
  processName: string;
  title: string;
  rawRect: Rect;
  dipRect?: Rect;
  isMaximized: boolean;
  isMinimized: boolean;
  isBrowser: boolean;
}

export type VerdictType = "STUDYING" | "DISTRACTED" | "NEUTRAL_SYSTEM";

export type DistractionTarget = "BROWSER_TAB" | "DESKTOP_APP" | "SPLIT_SCREEN" | "NONE";

export interface AiVerdict {
  verdict: VerdictType;
  confidence: number;
  distractionTarget: DistractionTarget;
  roastMessageIt: string;
  cacheSeconds: number;
}

export interface ExcuseJudgment {
  approved: boolean;
  grantMinutes: number;
  replyMessageIt: string;
}

export type ModelId =
  | "gemini-2.5-flash-lite"
  | "gemma-4-26b-a4b-it"
  | "gemini-3.1-flash-lite"
  | "gemini-2.5-flash";

export type QuotaStatus = "OK" | "BILLING_402" | "RATE_LIMIT_429" | "NO_KEY" | "ERROR";

export interface MonitorStatusBadge {
  state:
    | "IDLE"
    | "STUDYING"
    | "CHECKING_VISION"
    | "WARNING"
    | "NEGOTIATING"
    | "STRIKING"
    | "PAUSED"
    | "FINISHED";
  label: string;
  quotaStatus: QuotaStatus;
  usedFallback: boolean;
}

export interface SessionConfig {
  goal: string;
  durationMinutes: number;
  catSkinId: string;
  modelId: ModelId;
  muted: boolean;
  apiKeyOverride?: string;
}

export interface SessionStats {
  startedAt: number;
  elapsedSeconds: number;
  targetSeconds: number;
  tabsClosed: number;
  windowsDragged: number;
  excusesAccepted: number;
  excusesRejected: number;
  focusChecksTotal: number;
  distractionChecksTotal: number;
  rageCount: number;
  completedEarly?: boolean;
  completionNote?: string;
}

export interface ShameNoteState {
  id: number;
  strikeNumber: number;
  targetTitle: string;
  messageIt: string;
}

export interface CatSpeechBubble {
  text: string;
  expiresAt: number;
}

export type CatBehaviorMode =
  | "IDLE_PERCH"
  | "WARNING_CROUCH"
  | "NEGOTIATING"
  | "POUNCE_STRIKE"
  | "DRAGGING_WINDOW"
  | "VICTORY";

export interface CatOverlayCommand {
  mode: CatBehaviorMode;
  targetRect?: Rect;
  studyRect?: Rect;
  workArea?: Rect;
  roastMessageIt?: string;
  countdownMs?: number;
  hwnd?: number;
  catAnchor?: { x: number; y: number };
}

export interface CatSkinManifestEntry {
  id: string;
  label: string;
  file: string;
}

export interface NegotiationState {
  remainingMs: number;
  roastMessageIt: string;
  targetTitle: string;
  pending: boolean;
  replyMessageIt?: string;
}

export interface RendererUiState {
  phase: "LAUNCHER" | "ACTIVE" | "REPORT";
  config?: SessionConfig;
  stats: SessionStats;
  badge: MonitorStatusBadge;
  overlayCommand: CatOverlayCommand;
  workArea: Rect;
  negotiation?: NegotiationState;
  surrenderPhrase?: string;
  shameNote?: ShameNoteState;
  catSpeechBubble?: CatSpeechBubble;
}
