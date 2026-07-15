import { InlineKeyboard } from "grammy";

export interface ImageControl {
  prompt: string;
  imageUrl?: string;
  ownerUserId: number;
  expiresAt: number;
}

export const IMAGE_CONTROL_TTL_MS = 15 * 60 * 1000;

export function imageControlKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function imageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Variation", "img:var")
    .text("Prompt+", "img:prompt")
    .row()
    .text("Square", "img:square")
    .text("Wide", "img:wide");
}
