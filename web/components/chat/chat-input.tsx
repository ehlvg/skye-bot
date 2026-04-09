"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUp01Icon,
  ImageAdd01Icon,
  Mic01Icon,
  StopIcon,
  SparklesIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface ChatInputProps {
  onSend: (content: string, imageUrl?: string | null) => void
  onGenerateImage: (prompt: string, imageUrl?: string | null) => void
  disabled: boolean
}

export function ChatInput({
  onSend,
  onGenerateImage,
  disabled,
}: ChatInputProps) {
  const [text, setText] = useState("")
  const [imageMode, setImageMode] = useState(false)
  const [attachedImage, setAttachedImage] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Check voice availability
  useEffect(() => {
    fetch("/api/voice")
      .then((r) => r.json())
      .then((d: { available: boolean }) => setVoiceAvailable(d.available))
      .catch(() => {})
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }, [text])

  const reset = useCallback(() => {
    setText("")
    setAttachedImage(null)
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }, [])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    if (imageMode) {
      onGenerateImage(trimmed, attachedImage)
    } else {
      onSend(trimmed, attachedImage)
    }
    reset()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file")
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image must be under 20MB")
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => setAttachedImage(ev.target?.result as string)
    reader.readAsDataURL(file)
    // reset input so same file can be re-selected
    e.target.value = ""
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" })
      chunksRef.current = []
      mr.ondataavailable = (e) => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: "audio/ogg" })
        const fd = new FormData()
        fd.append("audio", blob, "voice.ogg")
        const res = await fetch("/api/voice", { method: "POST", body: fd })
        if (!res.ok) {
          toast.error("Voice recognition failed")
          return
        }
        const { text: recognized } = (await res.json()) as { text: string }
        if (recognized)
          setText((prev) => (prev ? prev + " " + recognized : recognized))
        else toast.warning("No speech detected")
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
    } catch {
      toast.error("Could not access microphone")
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  const canSend = text.trim().length > 0 && !disabled

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur-sm md:px-6">
      {/* Attached image preview */}
      {attachedImage && (
        <div className="mb-2 flex items-start gap-2">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachedImage}
              alt="Attached"
              className="h-20 w-20 rounded-lg border border-border object-cover shadow-sm"
            />
            <button
              onClick={() => setAttachedImage(null)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-opacity hover:opacity-80"
              aria-label="Remove image"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* Mode badge */}
      {imageMode && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            <HugeiconsIcon icon={SparklesIcon} className="size-3" />
            Image generation
          </span>
          <button
            onClick={() => setImageMode(false)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              imageMode
                ? "Describe the image you want to generate…"
                : "Message Skye…"
            }
            disabled={disabled}
            rows={1}
            className="max-h-[200px] min-h-[44px] resize-none rounded-xl py-3 pr-2 text-sm leading-relaxed"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 pb-0.5">
          {/* Attach image */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageAttach}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-xl text-muted-foreground hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                aria-label="Attach image"
              >
                <HugeiconsIcon icon={ImageAdd01Icon} className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach image</TooltipContent>
          </Tooltip>

          {/* Image generation mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={imageMode ? "default" : "ghost"}
                size="icon"
                className={cn(
                  "size-9 rounded-xl",
                  !imageMode && "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setImageMode((v) => !v)}
                disabled={disabled}
                aria-label="Generate image"
              >
                <HugeiconsIcon icon={SparklesIcon} className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Generate image</TooltipContent>
          </Tooltip>

          {/* Voice input */}
          {voiceAvailable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={recording ? "destructive" : "ghost"}
                  size="icon"
                  className={cn(
                    "size-9 rounded-xl",
                    !recording && "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={recording ? stopRecording : startRecording}
                  disabled={disabled && !recording}
                  aria-label={recording ? "Stop recording" : "Voice input"}
                >
                  <HugeiconsIcon
                    icon={recording ? StopIcon : Mic01Icon}
                    className="size-4"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {recording ? "Stop recording" : "Voice input"}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Send */}
          <Button
            size="icon"
            className="size-9 rounded-xl shadow-sm"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} className="size-4" />
          </Button>
        </div>
      </div>

      <p className="mt-2 text-center text-[10px] text-muted-foreground/50">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}
