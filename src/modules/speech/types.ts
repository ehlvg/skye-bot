export interface SpeechSynthesisOptions {
  voice?: string;
  style?: string;
  scene?: string;
}

export interface TtsCapabilities {
  defaultVoice: string;
  voices?: readonly string[];
  expressive: boolean;
}

export interface SpeechProvider {
  isSttAvailable(): boolean;
  isTtsAvailable(): boolean;
  recognize(audioBuffer: Buffer, language?: string): Promise<string | null>;
  synthesize(
    text: string,
    options?: SpeechSynthesisOptions,
    signal?: AbortSignal
  ): Promise<Buffer | null>;
  getTtsCapabilities(): TtsCapabilities;
}
