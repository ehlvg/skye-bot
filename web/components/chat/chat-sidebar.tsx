"use client"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { PencilEdit01Icon, AiChat01Icon } from "@hugeicons/core-free-icons"
import { ThreadItem, type Thread } from "./thread-item"
import { ThemeToggle } from "@/components/theme-toggle"

interface ChatSidebarProps {
  threads: Thread[]
  activeThreadId: string | null
  loading: boolean
  onSelectThread: (id: string) => void
  onNewThread: () => void
  onRenameThread: (thread: Thread) => void
  onDeleteThread: (thread: Thread) => void
  onOpenMemories: () => void
}

export function ChatSidebar({
  threads,
  activeThreadId,
  loading,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
  onOpenMemories,
}: ChatSidebarProps) {
  const { setOpenMobile } = useSidebar()

  const handleSelect = (id: string) => {
    onSelectThread(id)
    setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="offcanvas" variant="floating">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 pl-1">
            <HugeiconsIcon
              icon={AiChat01Icon}
              className="size-5 text-primary"
            />
            <span className="font-heading text-base font-semibold text-sidebar-foreground">
              Skye
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={onNewThread}
            aria-label="New conversation"
          >
            <HugeiconsIcon icon={PencilEdit01Icon} className="size-4" />
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {threads.length > 0 && (
            <SidebarGroupLabel className="mb-1 px-3 text-xs font-medium text-muted-foreground/80">
              Conversations
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {loading ? (
                <div className="space-y-1.5 px-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-12 animate-pulse rounded-lg bg-muted/50"
                    />
                  ))}
                </div>
              ) : threads.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No conversations yet
                  </p>
                  <button
                    onClick={onNewThread}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    Start one
                  </button>
                </div>
              ) : (
                <div className="space-y-0.5 px-2">
                  {threads.map((thread) => (
                    <SidebarMenuItem key={thread.id} className="list-none">
                      <ThreadItem
                        thread={thread}
                        active={thread.id === activeThreadId}
                        onSelect={() => handleSelect(thread.id)}
                        onRename={() => onRenameThread(thread)}
                        onDelete={() => onDeleteThread(thread)}
                      />
                    </SidebarMenuItem>
                  ))}
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-2">
        <div className="flex items-center justify-between">
          <button
            onClick={onOpenMemories}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            Memories
          </button>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
