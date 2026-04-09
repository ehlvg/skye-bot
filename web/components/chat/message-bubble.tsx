"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { Button } from "@/components/ui/button"

interface MessageBubbleProps {
  role: "user" | "assistant"
  content: string
  imageUrl?: string | null
  isStreaming?: boolean
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      onClick={handleCopy}
      aria-label="Copy message"
    >
      <HugeiconsIcon
        icon={copied ? Tick01Icon : Copy01Icon}
        className={cn(
          "size-3.5",
          copied ? "text-green-500" : "text-muted-foreground"
        )}
      />
    </Button>
  )
}

export function MessageBubble({
  role,
  content,
  imageUrl,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = role === "user"

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-xs font-semibold text-primary select-none">
          S
        </div>
      )}

      <div
        className={cn(
          "group relative flex max-w-[85%] flex-col gap-2",
          isUser ? "items-end" : "items-start"
        )}
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={isUser ? "Attached image" : "Generated image"}
            className={cn(
              "max-w-full rounded-xl object-cover shadow-sm",
              isUser ? "max-h-60" : "max-h-96 w-full"
            )}
          />
        )}

        {content && content !== "Generated image" && (
          <div
            className={cn(
              "relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm border border-border bg-card shadow-xs"
            )}
          >
            {isUser ? (
              <p className="break-words whitespace-pre-wrap">{content}</p>
            ) : (
              <div className="markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // Open links in new tab safely
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                    // Custom code block with copy button
                    pre: ({ children }) => (
                      <div className="group/code relative">
                        <pre>{children}</pre>
                        <button
                          className="absolute top-2 right-2 rounded bg-background/80 px-2 py-1 text-[10px] text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity group-hover/code:opacity-100 hover:text-foreground"
                          onClick={async (e) => {
                            const code =
                              e.currentTarget.parentElement?.querySelector(
                                "code"
                              )?.textContent ?? ""
                            await navigator.clipboard.writeText(code)
                            e.currentTarget.textContent = "Copied!"
                            setTimeout(() => {
                              if (e.currentTarget)
                                e.currentTarget.textContent = "Copy"
                            }, 2000)
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    ),
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            )}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current" />
            )}
          </div>
        )}

        {!isUser &&
          !isStreaming &&
          content &&
          content !== "Generated image" && (
            <div className="flex items-center gap-1 px-1">
              <CopyButton text={content} />
            </div>
          )}
      </div>
    </div>
  )
}
