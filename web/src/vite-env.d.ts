/// <reference types="vite/client" />

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    query_id?: string;
  };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  close(): void;
  showPopup(params: {
    title?: string;
    message: string;
    buttons?: { id: string; type?: string; text: string }[];
  }, callback?: (id: string) => void): void;
  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback?: (ok: boolean) => void): void;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    onClick(fn: () => void): void;
    offClick(fn: () => void): void;
    setText(text: string): void;
  };
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  onEvent(eventType: string, handler: () => void): void;
  offEvent(eventType: string, handler: () => void): void;
}

interface Window {
  Telegram: {
    WebApp: TelegramWebApp;
  };
}
