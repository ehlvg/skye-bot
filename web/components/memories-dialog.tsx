"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, Brain01Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

interface Memory {
  id: string
  content: string
  createdAt: string
}

interface MemoriesDialogProps {
  open: boolean
  onClose: () => void
}

export function MemoriesDialog({ open, onClose }: MemoriesDialogProps) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/memories")
      if (!res.ok) throw new Error("Failed to load memories")
      setMemories(await res.json())
    } catch {
      toast.error("Could not load memories")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setMemories((prev) => prev.filter((m) => m.id !== id))
      toast.success("Memory forgotten")
    } catch {
      toast.error("Failed to delete memory")
    } finally {
      setDeleting(null)
    }
  }

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso))

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={Brain01Icon} className="size-5 text-primary" />
            <DialogTitle className="font-heading">Memories</DialogTitle>
          </div>
          <DialogDescription>
            Things Skye has remembered from your conversations.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-96 pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <HugeiconsIcon
                icon={Brain01Icon}
                className="size-8 text-muted-foreground/40"
              />
              <p className="text-sm text-muted-foreground">No memories yet</p>
              <p className="text-xs text-muted-foreground/70">
                Ask Skye to remember something and it will show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed break-words">
                      {m.content}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(m.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                    onClick={() => handleDelete(m.id)}
                    disabled={deleting === m.id}
                    aria-label="Delete memory"
                  >
                    <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
