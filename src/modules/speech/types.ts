export interface SpeechProvider {
  isSttAvailable(): boolean;
  isTtsAvailable(): boolean;
  recognize(audioBuffer: Buffer, language?: string): Promise<string | null>;
  synthesize(text: string): Promise<Buffer | null>;
}