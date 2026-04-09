import type { Metadata } from "next"
import { Geist_Mono, Golos_Text, Lora } from "next/font/google"
import "./globals.css"

import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

const golosText = Golos_Text({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
})

const lora = Lora({
  subsets: ["latin", "cyrillic"],
  variable: "--font-heading",
  display: "swap",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Skye",
  description: "Your personal AI assistant",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(golosText.variable, lora.variable, fontMono.variable)}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider delayDuration={400}>
            {children}
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
