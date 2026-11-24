import type { AiVerdict, ExcuseJudgment, WindowSnapshot } from "../shared/types";

const PRODUCTIVE_PROCESSES = new Set([
  "code.exe",
  "devenv.exe",
  "idea64.exe",
  "pycharm64.exe",
  "clion64.exe",
  "webstorm64.exe",
  "rider64.exe",
  "eclipse.exe",
  "winword.exe",
  "excel.exe",
  "powerpnt.exe",
  "onenote.exe",
  "acrobat.exe",
  "acrord32.exe",
  "sumatrapdf.exe",
  "foxitpdfreader.exe",
  "obsidian.exe",
  "anki.exe",
  "notion.exe",
  "texstudio.exe",
  "texmaker.exe",
  "wt.exe",
  "powershell.exe",
  "pwsh.exe",
  "cmd.exe",
  "mintty.exe",
  "matlab.exe",
  "rstudio.exe",
  "zotero.exe",
  "notepad++.exe",
  "sublime_text.exe"
]);

const DISTRACTING_PROCESSES = new Set([
  "steam.exe",
  "steamwebhelper.exe",
  "epicgameslauncher.exe",
  "riotclientservices.exe",
  "leagueclient.exe",
  "valorant.exe",
  "minecraft.exe",
  "robloxplayerbeta.exe",
  "spotify.exe",
  "discord.exe",
  "whatsapp.exe",
  "telegram.exe",
  "netflix.exe"
]);

const DISTRACTION_TITLE_KEYWORDS = [
  "instagram",
  "tiktok",
  "twitch",
  "netflix",
  "prime video",
  "disney+",
  "facebook",
  "reddit",
  "9gag",
  "twitter",
  "x.com",
  "shorts",
  "reels",
  "gameplay",
  "walkthrough",
  "stream",
  "fantacalcio",
  "gazzetta",
  "calciomercato",
  "meme",
  "comic",
  "netflix",
  "chess.com",
  "lichess",
  "wordle"
];

const EDUCATIONAL_KEYWORDS = [
  "docs",
  "documentation",
  "tutorial",
  "corso",
  "lezione",
  "lecture",
  "university",
  "universita",
  "spiegazione",
  "esercizio",
  "esercizi",
  "pdf",
  "slides",
  "appunti",
  "wikipedia",
  "stackoverflow",
  "github",
  "mdn",
  "arxiv",
  "scholar",
  "cppreference",
  "python",
  "java",
  "rust",
  "typescript"
];

const STOPWORDS = new Set([
  "per",
  "con",
  "sul",
  "sulla",
  "degli",
  "delle",
  "dello",
  "della",
  "the",
  "and",
  "for",
  "with",
  "studio",
  "studiare",
  "finire",
  "fare",
  "ripasso",
  "esame"
]);

function extractGoalKeywords(goal: string): string[] {
  return goal
    .toLowerCase()
    .split(/[^a-z0-9àèéìòù]+/i)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function evaluateLocally(goal: string, win: WindowSnapshot): AiVerdict {
  const proc = win.processName.toLowerCase();
  const titleLower = win.title.toLowerCase();
  const goalKeywords = extractGoalKeywords(goal);

  const mentionsGoal = goalKeywords.some((kw) => titleLower.includes(kw));
  const processInGoal = goalKeywords.some((kw) => proc.replace(/\.exe$/, "").includes(kw));

  if (DISTRACTING_PROCESSES.has(proc) && !processInGoal) {
    const appLabel = proc.replace(/\.exe$/, "");
    return {
      verdict: "DISTRACTED",
      confidence: 0.92,
      distractionTarget: "DESKTOP_APP",
      roastMessageIt: `Seriamente hai aperto ${appLabel} invece di occuparti di "${goal}"? Questa finestra sparisce subito!`,
      cacheSeconds: 20
    };
  }

  if (PRODUCTIVE_PROCESSES.has(proc)) {
    return {
      verdict: "STUDYING",
      confidence: 0.88,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 60
    };
  }

  if (win.isBrowser) {
    const matchedDistraction = DISTRACTION_TITLE_KEYWORDS.find((kw) => titleLower.includes(kw));
    if (matchedDistraction && !mentionsGoal) {
      return {
        verdict: "DISTRACTED",
        confidence: 0.9,
        distractionTarget: "BROWSER_TAB",
        roastMessageIt: `Beccato su "${matchedDistraction}"! Non mi sembra proprio materiale per "${goal}". Chiudo la scheda!`,
        cacheSeconds: 15
      };
    }

    if (titleLower.includes("youtube")) {
      const hasEduSignal = mentionsGoal || EDUCATIONAL_KEYWORDS.some((kw) => titleLower.includes(kw));
      if (!hasEduSignal) {
        return {
          verdict: "DISTRACTED",
          confidence: 0.8,
          distractionTarget: "BROWSER_TAB",
          roastMessageIt: `YouTube sospetto rilevato: "${win.title.slice(0, 48)}". Se è una lezione giustificati subito, altrimenti chiudo!`,
          cacheSeconds: 15
        };
      }
    }

    return {
      verdict: "STUDYING",
      confidence: 0.72,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 25
    };
  }

  if (mentionsGoal) {
    return {
      verdict: "STUDYING",
      confidence: 0.8,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 45
    };
  }

  if (proc === "explorer.exe" || proc === "applicationframehost.exe") {
    return {
      verdict: "NEUTRAL_SYSTEM",
      confidence: 0.75,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 10
    };
  }

  return {
    verdict: "STUDYING",
    confidence: 0.65,
    distractionTarget: "NONE",
    roastMessageIt: "",
    cacheSeconds: 20
  };
}

export function evaluateExcuseLocally(goal: string, excuse: string): ExcuseJudgment {
  const cleaned = excuse.trim().toLowerCase();
  if (cleaned.length < 10) {
    return {
      approved: false,
      grantMinutes: 0,
      replyMessageIt: "Miao, questa non è nemmeno una frase completa! Via quella distrazione."
    };
  }

  const goalKeywords = extractGoalKeywords(goal);
  const referencesGoal = goalKeywords.some((kw) => cleaned.includes(kw));
  const studySignals = [
    "lezione",
    "corso",
    "slide",
    "appunti",
    "esercizio",
    "esercizi",
    "documentazione",
    "tutorial",
    "ricerca",
    "tesi",
    "pdf",
    "esame",
    "professore",
    "dispensa",
    "codice",
    "debug",
    "verifica"
  ];
  const hasStudyReason = referencesGoal || studySignals.some((w) => cleaned.includes(w));

  if (hasStudyReason) {
    return {
      approved: true,
      grantMinutes: 4,
      replyMessageIt: "Sospirone felino... ti concedo 4 minuti di tregua, ma ti tengo d'occhio."
    };
  }

  return {
    approved: false,
    grantMinutes: 0,
    replyMessageIt: "Scusa respinta dal Tribunale Felino: non c'entra nulla col tuo obiettivo di studio!"
  };
}
