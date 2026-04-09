import { HugeiconsIcon } from "@hugeicons/react"
import { WavingHand01Icon } from "@hugeicons/core-free-icons"

export function EmptyState({ onNewThread }: { onNewThread: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <HugeiconsIcon icon={WavingHand01Icon} className="size-8 text-primary" />
      </div>
      <div className="max-w-sm space-y-2">
        <h2 className="font-heading text-xl font-semibold">Welcome to Skye</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Start a new conversation, ask questions, generate images, or just
          think out loud.
        </p>
      </div>
      <button
        onClick={onNewThread}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        Start a conversation
      </button>
    </div>
  )
}

export function EmptyThread() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="max-w-xs space-y-2">
        <p className="font-heading text-base font-medium">
          What&apos;s on your mind?
        </p>
        <p className="text-sm text-muted-foreground">
          Type a message below to start the conversation.
        </p>
      </div>
    </div>
  )
}
