// Telegram rich messages support GitHub-flavored Markdown plus Telegram
// extensions. Keep model formatting intact and only normalize common escaping
// artifacts produced for the older MarkdownV2 path.
export function cleanMd(text: string) {
  return text.replace(/\\([.!(){}[\]])/g, "$1").trim();
}

export function unwrapTextEnvelope(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;

  try {
    const value = JSON.parse(fenced) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text;
    }
  } catch {
    return text;
  }

  return text;
}
