export function buildSurrenderPhrase(goal: string): string {
  const cleaned = goal.trim().replace(/\s+/g, " ");
  const topic = cleaned.length > 42 ? `${cleaned.slice(0, 39)}...` : cleaned || "lo studio";
  return `Dichiaro davanti al gatto di arrendermi invece di finire: ${topic}`;
}

export interface SurrenderValidation {
  valid: boolean;
  reason?: string;
}

export function validateSurrenderInput(
  expectedPhrase: string,
  typedPhrase: string,
  elapsedCooldownMs: number,
  requiredCooldownMs = 10_000
): SurrenderValidation {
  if (elapsedCooldownMs < requiredCooldownMs) {
    const remaining = Math.ceil((requiredCooldownMs - elapsedCooldownMs) / 1000);
    return {
      valid: false,
      reason: `Aspetta ancora ${remaining}s prima di poter alzare bandiera bianca.`
    };
  }

  if (typedPhrase.trim() !== expectedPhrase.trim()) {
    return {
      valid: false,
      reason: "La frase non corrisponde carattere per carattere. Scrivila a mano!"
    };
  }

  return { valid: true };
}
