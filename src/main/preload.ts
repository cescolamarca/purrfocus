import { contextBridge, ipcRenderer } from "electron";
import type {
  CatSkinManifestEntry,
  RendererUiState,
  SessionConfig
} from "../shared/types";

const api = {
  getCatManifest: (): Promise<CatSkinManifestEntry[]> =>
    ipcRenderer.invoke("session:get-cats"),
  startSession: (config: SessionConfig): Promise<void> =>
    ipcRenderer.invoke("session:start", config),
  openExcuseCourt: (): Promise<void> =>
    ipcRenderer.invoke("enforcer:open-court"),
  submitExcuse: (excuseText: string): Promise<void> =>
    ipcRenderer.invoke("enforcer:submit-excuse", excuseText),
  cancelNegotiation: (): Promise<void> =>
    ipcRenderer.invoke("enforcer:cancel-court"),
  concedeAndCloseNow: (): Promise<void> =>
    ipcRenderer.invoke("enforcer:strike-now"),
  requestSurrenderPhrase: (): Promise<string> =>
    ipcRenderer.invoke("session:surrender-phrase"),
  cancelSurrenderModal: (): Promise<void> =>
    ipcRenderer.invoke("session:cancel-surrender"),
  attemptSurrender: (typedPhrase: string): Promise<{ valid: boolean; reason?: string }> =>
    ipcRenderer.invoke("session:attempt-surrender", typedPhrase),
  setModalLock: (locked: boolean): Promise<void> =>
    ipcRenderer.invoke("session:set-modal-lock", locked),
  completeTask: (completionNote: string): Promise<void> =>
    ipcRenderer.invoke("session:complete-task", completionNote),
  forceCheckNow: (): Promise<string> =>
    ipcRenderer.invoke("monitor:force-check"),
  toggleMute: (muted: boolean): Promise<void> =>
    ipcRenderer.invoke("session:toggle-mute", muted),
  resetToLauncher: (): Promise<void> =>
    ipcRenderer.invoke("session:reset-launcher"),
  setOverlayInteractive: (interactive: boolean, focusable = false): void => {
    ipcRenderer.send("overlay:set-interactive", interactive, focusable);
  },
  onStateUpdate: (callback: (state: RendererUiState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: RendererUiState) => {
      callback(state);
    };
    ipcRenderer.on("state:update", listener);
    return () => ipcRenderer.removeListener("state:update", listener);
  },
  onOpenCompleteRequested: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("ui:open-complete", listener);
    return () => ipcRenderer.removeListener("ui:open-complete", listener);
  }
};

contextBridge.exposeInMainWorld("purrfocus", api);
