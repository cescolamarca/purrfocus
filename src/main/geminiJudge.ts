import type {
  AiVerdict,
  ExcuseJudgment,
  ModelId,
  QuotaStatus,
  WindowSnapshot
} from "../shared/types";
import { evaluateExcuseLocally, evaluateLocally } from "./localFallbackJudge";

export interface JudgeOutcome<T> {
  data: T;
  usedFallback: boolean;
  quotaStatus: QuotaStatus;
}

const VERDICT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: {
      type: "STRING",
      enum: ["STUDYING", "DISTRACTED", "NEUTRAL_SYSTEM"]
    },
    confidence: { type: "NUMBER" },
    distractionTarget: {
      type: "STRING",
      enum: ["BROWSER_TAB", "DESKTOP_APP", "SPLIT_SCREEN", "NONE"]
    },
    roastMessageIt: { type: "STRING" },
    cacheSeconds: { type: "INTEGER" }
  },
  required: ["verdict", "confidence", "distractionTarget", "roastMessageIt", "cacheSeconds"]
};

const EXCUSE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    approved: { type: "BOOLEAN" },
    grantMinutes: { type: "INTEGER" },
    replyMessageIt: { type: "STRING" }
  },
  required: ["approved", "grantMinutes", "replyMessageIt"]
};

export function resolveApiKey(override?: string): string {
  const fromOverride = override?.trim();
  if (fromOverride) {
    return fromOverride;
  }
  return (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").trim();
}

function extractJsonObject(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function classifyHttpStatus(status: number): QuotaStatus {
  if (status === 402) return "BILLING_402";
  if (status === 429) return "RATE_LIMIT_429";
  return "ERROR";
}

function buildGenerationConfig(modelId: ModelId, schema: Record<string, unknown>) {
  if (modelId.startsWith("gemma-")) {
    return {
      temperature: 0.2,
      maxOutputTokens: 220
    };
  }

  const config: Record<string, unknown> = {
    temperature: 0.2,
    maxOutputTokens: 200,
    responseMimeType: "application/json",
    responseSchema: schema
  };

  if (modelId.startsWith("gemini-2.5")) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  return config;
}

async function callModelJson<T>(
  modelId: ModelId,
  apiKey: string,
  prompt: string,
  screenshotBase64: string | null,
  schema: Record<string, unknown>
): Promise<{ parsed?: T; quotaStatus: QuotaStatus }> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (screenshotBase64) {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: screenshotBase64
      }
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: buildGenerationConfig(modelId, schema)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return { quotaStatus: classifyHttpStatus(response.status) };
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!rawText) {
      return { quotaStatus: "ERROR" };
    }

    const parsed = JSON.parse(extractJsonObject(rawText)) as T;
    return { parsed, quotaStatus: "OK" };
  } catch {
    return { quotaStatus: "ERROR" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function evaluateActivityWithAi(options: {
  modelId: ModelId;
  apiKeyOverride?: string;
  goal: string;
  windowSnapshot: WindowSnapshot;
  screenshotBase64: string | null;
  approvedExceptions: string[];
}): Promise<JudgeOutcome<AiVerdict>> {
  const apiKey = resolveApiKey(options.apiKeyOverride);
  if (!apiKey) {
    return {
      data: evaluateLocally(options.goal, options.windowSnapshot),
      usedFallback: true,
      quotaStatus: "NO_KEY"
    };
  }

  const exceptionsText =
    options.approvedExceptions.length > 0
      ? options.approvedExceptions.join("; ")
      : "none";

  const prompt = [
    "You are a sarcastic, strict retro desktop cat supervising a student on Windows.",
    `Student goal: "${options.goal}".`,
    `Active foreground window: process="${options.windowSnapshot.processName}", title="${options.windowSnapshot.title}", isBrowser=${options.windowSnapshot.isBrowser}.`,
    `Temporary approved exceptions: ${exceptionsText}.`,
    "Analyze the active window and screenshot carefully (including any split-screen half showing games, social media, anime, unrelated YouTube videos, chats, or shopping).",
    "Do NOT mark legitimate study tools as distracted (IDE, terminals, PDFs, slides, docs, technical search, or educational videos relevant to the goal).",
    "Return ONLY valid JSON with keys: verdict (STUDYING|DISTRACTED|NEUTRAL_SYSTEM), confidence (0..1), distractionTarget (BROWSER_TAB|DESKTOP_APP|SPLIT_SCREEN|NONE), roastMessageIt (witty sarcastic Italian 1-2 sentence scolding if DISTRACTED, else empty string), cacheSeconds (15..60).",
    "If the foreground window is a browser tab showing distraction, set distractionTarget='BROWSER_TAB'. If a split-screen half shows distraction, set distractionTarget='SPLIT_SCREEN'. If a standalone non-browser app is distracting, set distractionTarget='DESKTOP_APP'."
  ].join("\n");

  const outcome = await callModelJson<AiVerdict>(
    options.modelId,
    apiKey,
    prompt,
    options.screenshotBase64,
    VERDICT_RESPONSE_SCHEMA
  );

  if (!outcome.parsed) {
    return {
      data: evaluateLocally(options.goal, options.windowSnapshot),
      usedFallback: true,
      quotaStatus: outcome.quotaStatus
    };
  }

  const safeVerdict: AiVerdict = {
    verdict:
      outcome.parsed.verdict === "DISTRACTED" || outcome.parsed.verdict === "NEUTRAL_SYSTEM"
        ? outcome.parsed.verdict
        : "STUDYING",
    confidence: Math.min(1, Math.max(0, Number(outcome.parsed.confidence) || 0.75)),
    distractionTarget:
      outcome.parsed.distractionTarget === "BROWSER_TAB" ||
      outcome.parsed.distractionTarget === "DESKTOP_APP" ||
      outcome.parsed.distractionTarget === "SPLIT_SCREEN"
        ? outcome.parsed.distractionTarget
        : "NONE",
    roastMessageIt: String(outcome.parsed.roastMessageIt || "").slice(0, 220),
    cacheSeconds: Math.min(90, Math.max(10, Math.round(Number(outcome.parsed.cacheSeconds) || 30)))
  };

  return {
    data: safeVerdict,
    usedFallback: false,
    quotaStatus: "OK"
  };
}

export async function evaluateExcuseWithAi(options: {
  modelId: ModelId;
  apiKeyOverride?: string;
  goal: string;
  windowSnapshot: WindowSnapshot;
  screenshotBase64: string | null;
  excuseText: string;
}): Promise<JudgeOutcome<ExcuseJudgment>> {
  const apiKey = resolveApiKey(options.apiKeyOverride);
  if (!apiKey) {
    return {
      data: evaluateExcuseLocally(options.goal, options.excuseText),
      usedFallback: true,
      quotaStatus: "NO_KEY"
    };
  }

  const prompt = [
    "You are the Feline Study Court (Tribunale Felino). The user was caught distracting themselves and is pleading their case.",
    `Student goal: "${options.goal}".`,
    `Active window: process="${options.windowSnapshot.processName}", title="${options.windowSnapshot.title}".`,
    `User excuse: "${options.excuseText}".`,
    "Check the screenshot against their excuse! If they lie (e.g. claim it's a lecture when the screenshot clearly shows gaming, memes, reels, or entertainment), reject firmly.",
    "If plausible and genuinely helpful for completing the study goal, approve for 2 to 10 minutes.",
    "Return ONLY valid JSON with keys: approved (boolean), grantMinutes (integer 0..10), replyMessageIt (short sarcastic Italian reply in character as a strict cat)."
  ].join("\n");

  const outcome = await callModelJson<ExcuseJudgment>(
    options.modelId,
    apiKey,
    prompt,
    options.screenshotBase64,
    EXCUSE_RESPONSE_SCHEMA
  );

  if (!outcome.parsed) {
    return {
      data: evaluateExcuseLocally(options.goal, options.excuseText),
      usedFallback: true,
      quotaStatus: outcome.quotaStatus
    };
  }

  const approved = Boolean(outcome.parsed.approved);
  return {
    data: {
      approved,
      grantMinutes: approved ? Math.min(10, Math.max(2, Math.round(Number(outcome.parsed.grantMinutes) || 4))) : 0,
      replyMessageIt: String(outcome.parsed.replyMessageIt || "").slice(0, 240)
    },
    usedFallback: false,
    quotaStatus: "OK"
  };
}
