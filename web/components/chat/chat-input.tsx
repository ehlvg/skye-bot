"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  PlusSignIcon,
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
  const speechRecognitionRef = useRef<{
    start: () => void
    stop: () => void
    abort?: () => void
    lang?: string
    interimResults?: boolean
    continuous?: boolean
    onresult?: ((ev: unknown) => void) | null
    onerror?: ((ev: unknown) => void) | null
    onend?: (() => void) | null
  } | null>(null)

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
    e.target.value = ""
  }

  const startRecording = async () => {
    try {
      const hasOggOpus =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")

      const SR =
        typeof window !== "undefined"
          ? ((window as unknown as { SpeechRecognition?: unknown })
              .SpeechRecognition ??
              (window as unknown as { webkitSpeechRecognition?: unknown })
                .webkitSpeechRecognition)
          : undefined

      if (!hasOggOpus && SR) {
        const recognition = new (SR as new () => {
          start: () => void
          stop: () => void
          abort?: () => void
          lang?: string
          interimResults?: boolean
          continuous?: boolean
          onresult?: (ev: unknown) => void
          onerror?: (ev: unknown) => void
          onend?: () => void
        })()

        recognition.lang = "ru-RU"
        recognition.interimResults = false
        recognition.continuous = false

        recognition.onresult = (ev) => {
          const e = ev as {
            results?: ArrayLike<
              ArrayLike<{ transcript?: string }> & { isFinal?: boolean }
            >
          }
          const r0 = e.results?.[0]
          const alt0 = r0?.[0]
          const transcript = alt0?.transcript?.trim() ?? ""
          if (transcript) {
            setText((prev) => (prev ? prev + " " + transcript : transcript))
          } else {
            toast.warning("No speech detected")
          }
        }

        recognition.onerror = () => {
          toast.error("Voice recognition failed")
        }

        recognition.onend = () => {
          speechRecognitionRef.current = null
          setRecording(false)
        }

        speechRecognitionRef.current = recognition
        setRecording(true)
        recognition.start()
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredTypes = [
        "audio/ogg;codecs=opus",
        "audio/webm;codecs=opus",
        "audio/webm",
      ]
      const selectedType =
        preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
      const mr = selectedType
        ? new MediaRecorder(stream, { mimeType: selectedType })
        : new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blobType =
          chunksRef.current[0]?.type || selectedType || "application/octet-stream"
        const blob = new Blob(chunksRef.current, { type: blobType })
        const fd = new FormData()
        const ext = blobType.includes("ogg")
          ? "ogg"
          : blobType.includes("webm")
            ? "webm"
            : "bin"
        fd.append("audio", blob, `voice.${ext}`)
        const res = await fetch("/api/voice", { method: "POST", body: fd })
        if (!res.ok) {
          const msg = await res
            .json()
            .then((d: { error?: string }) => d.error)
            .catch(() => "")
          toast.error(msg || "Voice recognition failed")
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
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop()
      return
    }
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  const hasText = text.trim().length > 0
  const canSend = hasText && !disabled

  return (
    <div className="relative z-10 px-4 pb-4 md:px-6 bg-transparent">
      <div className="relative mx-auto w-full max-w-3xl">
        {/* Floating elements above InputGroup — absolute, no background */}
        {(attachedImage || imageMode) && (
          <div className="absolute bottom-full left-0 mb-2 flex flex-col gap-1.5">
            {/* Attached image preview */}
            {attachedImage && (
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachedImage}
                  alt="Attached"
                  className="h-20 w-20 rounded-lg border border-border object-cover shadow-md bg-white"
                />
                <button
                  onClick={() => setAttachedImage(null)}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-opacity hover:opacity-80"
                  aria-label="Remove image"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                </button>
              </div>
            )}

            {/* Image mode badge */}
            {imageMode && (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary backdrop-blur-sm">
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
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageAttach}
        />

        <InputGroup className="rounded-2xl">
          {/* Textarea */}
          <InputGroupTextarea
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
            className="max-h-[200px] min-h-[44px] leading-relaxed"
          />

          {/* Bottom row: plus menu left, voice/send right */}
          <InputGroupAddon align="block-end" className="justify-between pb-2 px-2">
            {/* Left: plus menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label="More options"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2"
                >
                  <HugeiconsIcon icon={ImageAdd01Icon} className="size-4" />
                  Attach image
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setImageMode((v) => !v)}
                  className="gap-2"
                >
                  <HugeiconsIcon icon={SparklesIcon} className="size-4" />
                  {imageMode ? "Cancel image gen" : "Generate image"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Right: voice (empty) or send (has text) */}
            <div className="flex items-center">
              {voiceAvailable && !hasText && !recording && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      size="icon-sm"
                      variant="ghost"
                      onClick={startRecording}
                      disabled={disabled}
                      aria-label="Voice input"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <HugeiconsIcon icon={Mic01Icon} className="size-4" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Voice input</TooltipContent>
                </Tooltip>
              )}

              {recording && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      size="icon-sm"
                      variant="destructive"
                      onClick={stopRecording}
                      aria-label="Stop recording"
                    >
                      <HugeiconsIcon icon={StopIcon} className="size-4" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Stop recording</TooltipContent>
                </Tooltip>
              )}

              {hasText && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      size="icon-sm"
                      variant="default"
                      onClick={handleSend}
                      disabled={!canSend}
                      aria-label="Send message"
                    >
                      <HugeiconsIcon icon={ArrowUp01Icon} className="size-4" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Send</TooltipContent>
                </Tooltip>
              )}
            </div>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}
