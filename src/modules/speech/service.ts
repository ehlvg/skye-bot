import type {
  SpeechProvider,
  SpeechSynthesisOptions,
  TtsCapabilities,
} from "./types.js";

/**
 * Public speech facade exposed to the rest of the bot. Delegates to a
 * provider-specific adapter (Yandex SpeechKit or OpenRouter) chosen at module
 * init time based on config.voice.provider. Keeping the facade stable means
 * telegram/panel do not need to know which backend is active.
 */
export class SpeechService {
  constructor(private provider: SpeechProvider) {}

  isSttAvailable(): boolean {
    return this.provider.isSttAvailable();
  }

  isTtsAvailable(): boolean {
    return this.provider.isTtsAvailable();
  }

  recognize(audioBuffer: Buffer, language: string = "ru-RU"): Promise<string | null> {
    return this.provider.recognize(audioBuffer, language);
  }

  synthesize(text: string, options?: SpeechSynthesisOptions): Promise<Buffer | null> {
    return this.provider.synthesize(text, options);
  }

  getTtsCapabilities(): TtsCapabilities {
    return this.provider.getTtsCapabilities();
  }
}
