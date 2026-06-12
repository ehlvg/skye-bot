// Telegram rich messages support GitHub-flavored Markdown plus Telegram
// extensions. Keep model formatting intact and only normalize common escaping
// artifacts produced for the older MarkdownV2 path.
export function cleanMd(text: string) {
  return text.replace(/\\([.!(){}[\]])/g, "$1").trim();
}
