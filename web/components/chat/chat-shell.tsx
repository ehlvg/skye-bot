"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import { Brain01Icon, Delete02Icon } from "@hugeicons/core-free-icons"

import { ChatSidebar } from "./chat-sidebar"
import { MessageList, type Message } from "./message-list"
import { ChatInput } from "./chat-input"
import { EmptyState, EmptyThread } from "./empty-state"
import { MemoriesDialog } from "@/components/memories-dialog"
import { RenameDialog } from "@/components/rename-dialog"
import { ThemeToggle } from "@/components/theme-toggle"
import type { Thread } from "./thread-item"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ── Types ─────────────────────────────────────────────────────────────────────

// ── Chat shell ────────────────────────────────────────────────────────────────

export function ChatShell() {
  // Sidebar / thread state
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [loadingThreads, setLoadingThreads] = useState(true)

  // Message state
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  // Streaming
  const [streamingContent, setStreamingContent] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)

  // Dialogs
  const [memoriesOpen, setMemoriesOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Thread | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Thread | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads")
      if (!res.ok) throw new Error()
      const data: Thread[] = await res.json()
      setThreads(data)
    } catch {
      toast.error("Failed to load conversations")
    } finally {
      setLoadingThreads(false)
    }
  }, [])

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true)
    setMessages([])
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`)
      if (!res.ok) throw new Error()
      setMessages(await res.json())
    } catch {
      toast.error("Failed to load messages")
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  useEffect(() => {
    if (activeThreadId) loadMessages(activeThreadId)
    else setMessages([])
  }, [activeThreadId, loadMessages])

  // ── Thread actions ─────────────────────────────────────────────────────────

  const handleNewThread = async () => {
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Chat" }),
      })
      if (!res.ok) throw new Error()
      const thread: Thread = await res.json()
      setThreads((prev) => [thread, ...prev])
      setActiveThreadId(thread.id)
    } catch {
      toast.error("Failed to create conversation")
    }
  }

  const handleRenameThread = async (name: string) => {
    if (!renameTarget) return
    const res = await fetch(`/api/threads/${renameTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error("Failed to rename")
    setThreads((prev) =>
      prev.map((t) => (t.id === renameTarget.id ? { ...t, name } : t))
    )
    toast.success("Conversation renamed")
  }

  const confirmDeleteThread = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/threads/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      setThreads((prev) => prev.filter((t) => t.id !== deleteTarget.id))
      if (activeThreadId === deleteTarget.id) {
        setActiveThreadId(null)
        setMessages([])
      }
      toast.success("Conversation deleted")
    } catch {
      toast.error("Failed to delete conversation")
    } finally {
      setDeleteTarget(null)
    }
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  const streamResponse = async (
    threadId: string,
    content: string,
    imageUrl?: string | null
  ) => {
    // Optimistically add user message to UI
    const tempUserMsg: Message = {
      id: "temp-user-" + Date.now(),
      threadId,
      role: "user",
      content,
      imageUrl: imageUrl ?? null,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])
    setStreamingContent("")
    setIsStreaming(true)

    // Update thread preview
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              lastMessage: content,
              lastMessageAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : t
      )
    )

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch(`/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, imageUrl: imageUrl ?? null }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        const err = (await res
          .json()
          .catch(() => ({ error: "Request failed" }))) as { error?: string }
        throw new Error(err.error ?? "Request failed")
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        accumulated += dec.decode(value, { stream: true })
        const lines = accumulated.split("\n")
        accumulated = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          let event: {
            type: string
            content?: string
            messageId?: string
            message?: string
          }
          try {
            event = JSON.parse(raw)
          } catch {
            continue
          }

          if (event.type === "chunk" && event.content) {
            setStreamingContent((prev) => prev + event.content)
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Stream error")
          }
        }
      }

      // Refresh messages from server (gets real IDs and persisted data)
      const refreshed: Message[] = await fetch(
        `/api/threads/${threadId}/messages`
      ).then((r) => r.json())
      setMessages(refreshed)

      // Update thread preview with assistant response
      const lastMsg = refreshed.at(-1)
      if (lastMsg) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  lastMessage: lastMsg.content,
                  lastMessageAt: lastMsg.createdAt,
                  updatedAt: lastMsg.createdAt,
                }
              : t
          )
        )
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return
      const msg = err instanceof Error ? err.message : "Something went wrong"
      toast.error(msg)
      // Remove optimistic user message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id))
    } finally {
      setIsStreaming(false)
      setStreamingContent("")
      abortRef.current = null
    }
  }

  const handleSend = async (content: string, imageUrl?: string | null) => {
    if (!activeThreadId || isStreaming) return
    await streamResponse(activeThreadId, content, imageUrl)
  }

  const handleGenerateImage = async (
    prompt: string,
    imageUrl?: string | null
  ) => {
    if (!activeThreadId || isStreaming) return

    const tempUserMsg: Message = {
      id: "temp-user-" + Date.now(),
      threadId: activeThreadId,
      role: "user",
      content: prompt,
      imageUrl: imageUrl ?? null,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])
    setIsStreaming(true)

    try {
      const res = await fetch(`/api/threads/${activeThreadId}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, imageUrl: imageUrl ?? null }),
      })

      if (!res.ok) {
        const err = (await res
          .json()
          .catch(() => ({ error: "Image generation failed" }))) as {
          error?: string
        }
        throw new Error(err.error)
      }

      const refreshed: Message[] = await fetch(
        `/api/threads/${activeThreadId}/messages`
      ).then((r) => r.json())
      setMessages(refreshed)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Image generation failed"
      toast.error(msg)
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id))
    } finally {
      setIsStreaming(false)
    }
  }

  // ── Active thread info ─────────────────────────────────────────────────────

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SidebarProvider>
      <ChatSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        loading={loadingThreads}
        onSelectThread={setActiveThreadId}
        onNewThread={handleNewThread}
        onRenameThread={setRenameTarget}
        onDeleteThread={setDeleteTarget}
        onOpenMemories={() => setMemoriesOpen(true)}
      />

      {/* Main area */}
      <div className="flex min-h-svh flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5" />

          <div className="min-w-0 flex-1 px-1">
            {activeThread ? (
              <h1 className="truncate font-heading text-sm font-semibold">
                {activeThread.name}
              </h1>
            ) : (
              <h1 className="font-heading text-sm font-semibold text-muted-foreground">
                Skye
              </h1>
            )}
          </div>

          <div className="flex items-center gap-1">
            {activeThread && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => setDeleteTarget(activeThread)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete conversation</TooltipContent>
                </Tooltip>
              </>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setMemoriesOpen(true)}
                >
                  <HugeiconsIcon icon={Brain01Icon} className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Memories</TooltipContent>
            </Tooltip>

            <ThemeToggle />
          </div>
        </header>

        {/* Body */}
        {!activeThreadId ? (
          <div className="flex flex-1 flex-col">
            <EmptyState onNewThread={handleNewThread} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {loadingMessages ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Loading…
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-1 flex-col">
                <EmptyThread />
              </div>
            ) : (
              <MessageList
                messages={messages}
                streamingContent={streamingContent}
                isStreaming={isStreaming}
                className="flex-1"
              />
            )}

            <ChatInput
              onSend={handleSend}
              onGenerateImage={handleGenerateImage}
              disabled={isStreaming || loadingMessages}
            />
          </div>
        )}
      </div>

      {/* Dialogs */}
      <MemoriesDialog
        open={memoriesOpen}
        onClose={() => setMemoriesOpen(false)}
      />

      <RenameDialog
        open={Boolean(renameTarget)}
        currentName={renameTarget?.name ?? ""}
        onClose={() => setRenameTarget(null)}
        onRename={handleRenameThread}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading">
              Delete conversation?
            </AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; and all its messages will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
              onClick={confirmDeleteThread}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}
