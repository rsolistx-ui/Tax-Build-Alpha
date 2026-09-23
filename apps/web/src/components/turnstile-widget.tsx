import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_ID = "cf-turnstile-script";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? Object.assign(document.createElement("script"), {
      id: SCRIPT_ID,
      src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      async: true,
    });
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Could not load the Cloudflare security check.")));
    if (!existing) document.head.appendChild(script);
  });
}

/** Cloudflare Turnstile box. Change `resetKey` to get a fresh check after a token is spent. */
export function TurnstileWidget({ siteKey, onToken, resetKey = 0 }: { siteKey: string; onToken: (token: string | null) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    onTokenRef.current(null);
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widgetId = window.turnstile.render(box.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* already gone */ }
      }
    };
  }, [siteKey, resetKey]);

  return <div ref={box} className="min-h-[65px]" />;
}
