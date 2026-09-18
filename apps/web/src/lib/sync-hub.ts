import { api } from "@/lib/api";

type SyncEvent = {
  id: string;
  firm_id: string;
  user_id: string;
  entity: string;
  entity_id: string;
  op: string;
  payload: unknown;
  ts: string;
};

type Listener = (events: SyncEvent[]) => void;

const POLL_INTERVAL_MS = 30000;
let lastSince: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let listeners: Listener[] = [];
let active = false;

async function poll() {
  if (!active) return;
  const url = lastSince ? `/api/push/sync/poll?since=${encodeURIComponent(lastSince)}` : `/api/push/sync/poll`;
  try {
    const data = await api<{ events: SyncEvent[] }>(url);
    const events = data.events;
    if (events.length) {
      lastSince = events[0].ts;
      window.dispatchEvent(new CustomEvent("folio-sync-poll", { detail: events }));
      for (const l of listeners) l(events);
    }
  } catch { /* offline or table not yet migrated — will retry */ }
}

function schedule() {
  if (timer) return;
  timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

export function registerSyncHub(listener: Listener): () => void {
  listeners.push(listener);
  if (!active) {
    active = true;
    void poll();
    schedule();
    const onOnline = () => void poll();
    const onFocus = () => void poll();
    const onVisibility = () => { if (document.visibilityState === "visible") void poll(); };
    const onPushMessage = (e: MessageEvent) => {
      if (e.data?.type === "folio-sync" || e.data?.type === "folio-push" || (typeof e.data?.title === "string" && e.data.title.includes("Sync"))) {
        void poll();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", onPushMessage);
    const unregister = () => {
      listeners = listeners.filter((l) => l !== listener);
      if (listeners.length === 0) {
        active = false;
        if (timer) { clearInterval(timer); timer = null; }
        window.removeEventListener("online", onOnline);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
        if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", onPushMessage);
      }
    };
    return unregister;
  }
  return () => { listeners = listeners.filter((l) => l !== listener); };
}

export async function pushSyncEvent(entity: string, entityId: string, op: "create" | "update" | "delete", payload: unknown = {}) {
  try {
    await api(`/api/push/sync/events`, { method: "POST", body: JSON.stringify({ entity, entity_id: entityId, op, payload }) });
  } catch { /* non-fatal */ }
}