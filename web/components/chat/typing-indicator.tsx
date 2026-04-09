export function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 text-muted-foreground"
      aria-label="Skye is typing"
    >
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </div>
  )
}
