"use client"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Edit01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"

export interface Thread {
  id: string
  name: string
  lastMessage: string | null
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

interface ThreadItemProps {
  thread: Thread
  active: boolean
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso))
}

export function ThreadItem({
  thread,
  active,
  onSelect,
  onRename,
  onDelete,
}: ThreadItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "group relative flex cursor-pointer flex-col rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60"
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-sm leading-tight font-medium">
          {thread.name}
        </span>

        {/* Context menu — always rendered, visible on hover/active */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
                active && "opacity-100"
              )}
              aria-label="Thread options"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onRename()
              }}
            >
              <HugeiconsIcon icon={Edit01Icon} className="mr-2 size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <HugeiconsIcon icon={Delete02Icon} className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {thread.lastMessage && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="flex-1 truncate text-xs leading-snug text-muted-foreground">
            {thread.lastMessage}
          </span>
          {thread.lastMessageAt && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60">
              {relativeTime(thread.lastMessageAt)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
