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
  "netflix.exe",
  "vlc.exe",
  "mpv.exe",
  "wmplayer.exe",
  "battle.net.exe",
  "upc.exe",
  "eadesktop.exe"
]);

const DISTRACTION_TITLE_KEYWORDS = [
  "instagram",
  "tiktok",
  "facebook",
  "threads",
  "reddit",
  "x.com",
  "twitter",
  "pinterest",
  "9gag",
  "tumblr",
  "snapchat",
  "discord",
  "whatsapp",
  "telegram",
  "netflix",
  "prime video",
  "primevideo",
  "disney+",
  "disneyplus",
  "dazn",
  "raiplay",
  "mediaset",
  "twitch",
  "kick.com",
  "crunchyroll",
  "anime",
  "cb01",
  "altadefinizione",
  "streaming",
  "episodio",
  "stagione",
  "shorts",
  "reels",
  "trailer",
  "highlights",
  "gameplay",
  "walkthrough",
  "stream",
  "meme",
  "comic",
  "amazon",
  "ebay",
  "zalando",
  "shein",
  "temu",
  "aliexpress",
  "vinted",
  "subito",
  "booking",
  "gazzetta",
  "corriere",
  "repubblica",
  "fanpage",
  "ansa",
  "fantacalcio",
  "calciomercato",
  "diretta",
  "serie a",
  "champions",
  "poki",
  "crazygames",
  "chess.com",
  "lichess",
  "wordle",
  "itch.io",
  "geforce",
  "spotify",
  "soundcloud"
];

const EDUCATIONAL_KEYWORDS = [
  "docs",
  "documentation",
  "tutorial",
  "corso",
  "lezione",
  "lecture",
  "universit",
  "unisa",
  "spiegazione",
  "esercizio",
  "esercizi",
  "pdf",
  ".pdf",
  "slides",
  "slide",
  "appunti",
  "dispensa",
  "dispense",
  "capitolo",
  "teorema",
  "riassunto",
  "tesi",
  "wikipedia",
  "treccani",
  "stackoverflow",
  "github",
  "gitlab",
  "localhost",
  "127.0.0.1",
  "mdn",
  "arxiv",
  "scholar",
  "ieee",
  "youmath",
  "studenti",
  "skuola",
  "docsity",
  "studocu",
  "moodle",
  "elearning",
  "teams",
  "classroom",
  "overleaf",
  "latex",
  "colab",
  "jupyter",
  "chatgpt",
  "claude",
  "gemini",
  "notebooklm",
  "drive.google",
  "docs.google",
  "wordreference",
  "deepl",
  "python",
  "java",
  "rust",
  "typescript",
  "cppreference"
];

const ACADEMIC_YOUTUBE_KEYWORDS = [
  "lezione",
  "lecture",
  "corso",
  "tutorial",
  "spiegazione",
  "esercizio",
  "mit ",
  "stanford",
  "unisa",
  "politecnico",
  "algoritm",
  "analisi",
  "fisica",
  "chimica",
  "matematica",
  "programmazione"
];

const TRANSIENT_BROWSER_TITLES = [
  "nuova scheda",
  "new tab",
  "pagina iniziale",
  "about:blank",
  "google chrome",
  "microsoft edge",
  "mozilla firefox",
  "brave",
  "opera"
];

const EXPLORER_DISTRACTION_KEYWORDS = [
  "download",
  "giochi",
  "games",
  "video",
  "film",
  "immagini",
  "pictures",
  "musica"
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

function isTransientBlankBrowserTitle(titleLower: string): boolean {
  const trimmed = titleLower.trim();
  if (!trimmed) {
    return true;
  }
  return TRANSIENT_BROWSER_TITLES.some(
    (t) => trimmed === t || trimmed.startsWith(`${t} - `) || trimmed === `${t} - google chrome`
  );
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
      confidence: 0.94,
      distractionTarget: "DESKTOP_APP",
      roastMessageIt: `Seriamente hai aperto ${appLabel} invece di occuparti di «${goal}»?! Questa finestra sparisce subito!`,
      cacheSeconds: 15
    };
  }

  if (PRODUCTIVE_PROCESSES.has(proc)) {
    return {
      verdict: "STUDYING",
      confidence: 0.88,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 30
    };
  }

  if (win.isBrowser) {
    if (isTransientBlankBrowserTitle(titleLower)) {
      return {
        verdict: "NEUTRAL_SYSTEM",
        confidence: 0.7,
        distractionTarget: "NONE",
        roastMessageIt: "",
        cacheSeconds: 5
      };
    }

    const matchedDistraction = DISTRACTION_TITLE_KEYWORDS.find((kw) => titleLower.includes(kw));
    if (matchedDistraction && !mentionsGoal) {
      return {
        verdict: "DISTRACTED",
        confidence: 0.93,
        distractionTarget: "BROWSER_TAB",
        roastMessageIt: `Beccato su "${matchedDistraction}"! Non mi sembra proprio materiale per «${goal}». Chiudo la scheda!`,
        cacheSeconds: 12
      };
    }

    if (titleLower.includes("youtube")) {
      const hasAcademicSignal =
        mentionsGoal || ACADEMIC_YOUTUBE_KEYWORDS.some((kw) => titleLower.includes(kw));
      if (!hasAcademicSignal) {
        return {
          verdict: "DISTRACTED",
          confidence: 0.88,
          distractionTarget: "BROWSER_TAB",
          roastMessageIt: `YouTube sospetto rilevato: «${win.title.slice(0, 46)}». Se è una lezione giustificati subito, altrimenti chiudo!`,
          cacheSeconds: 12
        };
      }
      return {
        verdict: "STUDYING",
        confidence: 0.78,
        distractionTarget: "NONE",
        roastMessageIt: "",
        cacheSeconds: 20
      };
    }

    const hasEduSignal = mentionsGoal || EDUCATIONAL_KEYWORDS.some((kw) => titleLower.includes(kw));
    if (!hasEduSignal) {
      return {
        verdict: "DISTRACTED",
        confidence: 0.84,
        distractionTarget: "BROWSER_TAB",
        roastMessageIt: `Che c'entra «${win.title.slice(0, 45)}» con «${goal}»?! Hai 1.8s per giustificarti o chiudo la scheda!`,
        cacheSeconds: 12
      };
    }

    return {
      verdict: "STUDYING",
      confidence: 0.8,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 25
    };
  }

  if (proc === "explorer.exe" || proc === "applicationframehost.exe") {
    const explorerDistraction = EXPLORER_DISTRACTION_KEYWORDS.find((kw) => titleLower.includes(kw));
    if (explorerDistraction && !mentionsGoal) {
      return {
        verdict: "DISTRACTED",
        confidence: 0.84,
        distractionTarget: "DESKTOP_APP",
        roastMessageIt: `Che ci fai dentro "${win.title.slice(0, 40)}"?! Torna a lavorare su «${goal}»!`,
        cacheSeconds: 12
      };
    }
    return {
      verdict: "NEUTRAL_SYSTEM",
      confidence: 0.75,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 10
    };
  }

  if (mentionsGoal) {
    return {
      verdict: "STUDYING",
      confidence: 0.82,
      distractionTarget: "NONE",
      roastMessageIt: "",
      cacheSeconds: 30
    };
  }

  return {
    verdict: "DISTRACTED",
    confidence: 0.85,
    distractionTarget: "DESKTOP_APP",
    roastMessageIt: `Applicazione sospetta (${win.processName}): non sembra proprio «${goal}»! La porto via io!`,
    cacheSeconds: 15
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
