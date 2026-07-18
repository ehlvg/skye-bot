/**
 * Wrapper around the Telegram WebApp SDK with safe fallbacks so the panel
 * also renders in a normal browser during development.
 */
type Tg = typeof window.Telegram & { WebApp?: any };

export const tg = (window as Tg).WebApp;

export type ColorScheme = "light" | "dark";

export function colorScheme(): ColorScheme {
  if (tg?.colorScheme) return tg.colorScheme as ColorScheme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Reflect Telegram's scheme onto <html data-color-scheme>. */
export function applyScheme() {
  document.documentElement.setAttribute("data-color-scheme", colorScheme());
}

/** Sync Telegram header/background colors with the panel's surfaces. */
export function syncTelegramChrome() {
  if (!tg) return;
  try {
    tg.setHeaderColor?.("secondary_bg_color");
    tg.setBackgroundColor?.("secondary_bg_color");
    tg.setBottomBarColor?.("secondary_bg_color");
  } catch {
    /* older clients reject named colors — non-fatal */
  }
}

export const haptic = {
  selection: () => tg?.HapticFeedback?.selectionChanged?.(),
  light: () => tg?.HapticFeedback?.impactOccurred?.("light"),
  medium: () => tg?.HapticFeedback?.impactOccurred?.("medium"),
  soft: () => tg?.HapticFeedback?.impactOccurred?.("soft"),
  success: () => tg?.HapticFeedback?.notificationOccurred?.("success"),
  warning: () => tg?.HapticFeedback?.notificationOccurred?.("warning"),
  error: () => tg?.HapticFeedback?.notificationOccurred?.("error"),
};

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, (ok: boolean) => resolve(!!ok));
    else resolve(window.confirm(message));
  });
}

export function alertDialog(message: string): void {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}

/** Wire the native back button to a callback; returns an unsubscribe fn. */
export function useBackButton(onClick: () => void): () => void {
  if (!tg?.BackButton) return () => {};
  tg.BackButton.show();
  tg.BackButton.onClick(onClick);
  return () => {
    tg.BackButton.offClick(onClick);
    tg.BackButton.hide();
  };
}

export function openInvoice(url: string): Promise<string> {
  return new Promise((resolve) => {
    if (tg?.openInvoice) {
      tg.openInvoice(url, (status: string) => resolve(status));
    } else {
      window.open(url, "_blank");
      resolve("fallback");
    }
  });
}

export function openLink(url: string): void {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function ready() {
  tg?.ready?.();
  tg?.expand?.();
}

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function currentUser(): TgUser | null {
  return (tg?.initDataUnsafe?.user as TgUser) ?? null;
}

export function onThemeChanged(cb: () => void): () => void {
  if (!tg?.onEvent) return () => {};
  tg.onEvent("themeChanged", cb);
  return () => tg.offEvent?.("themeChanged", cb);
}
