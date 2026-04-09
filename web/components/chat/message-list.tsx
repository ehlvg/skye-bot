"use client"

import { useEffect, useRef } from "react"
import { MessageBubble } from "./message-bubble"
import { TypingIndicator } from "./typing-indicator"
import { cn } from "@/lib/utils"

export interface Message {
  id: string
  threadId: string
  role: "user" | "assistant"
  content: string
  imageUrl: string | null
  createdAt: string
}

interface MessageListProps {
  messages: Message[]
  streamingContent: string
  isStreaming: boolean
  className?: string
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  className,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom on new messages / streaming chunks
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, streamingContent])

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col gap-6 overflow-y-auto px-4 py-6 md:px-6",
        className
      )}
    >
      {messages.map((msg, i) => {
        // If this is the last assistant message and we're streaming, show streaming version
        const isLastAssistant =
          msg.role === "assistant" &&
          i === messages.length - 1 &&
          isStreaming &&
          !streamingContent

        return (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            imageUrl={msg.imageUrl}
            isStreaming={isLastAssistant}
          />
        )
      })}

      {/* Streaming response */}
      {isStreaming && streamingContent && (
        <MessageBubble
          role="assistant"
          content={streamingContent}
          isStreaming
        />
      )}

      {/* Typing indicator (before first chunk arrives) */}
      {isStreaming && !streamingContent && (
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-xs font-semibold text-primary">
            S
          </div>
          <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 shadow-xs">
            <TypingIndicator />
          </div>
        </div>
      )}

      <div ref={bottomRef} className="h-px shrink-0" />
    </div>
  )
}
