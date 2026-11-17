import { useEffect, useRef } from "react";
import { api } from "./api";

/** Counts only focused, visible, recently-active reading time and flushes in small batches. */
export function useReadingTime(bookId: string, enabled: boolean, onSaved?: (seconds: number) => void): void {
  const pending = useRef(0);
  const lastActivity = useRef(Date.now());
  const saving = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const touch = () => { lastActivity.current = Date.now(); };
    const active = () => document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastActivity.current < 60_000;
    const flush = async () => {
      if (saving.current || pending.current <= 0 || disposed) return;
      const amount = pending.current; pending.current = 0; saving.current = true;
      try { const total = await api.addReadingTime(bookId, amount); if (!disposed) onSaved?.(total); }
      catch { pending.current += amount; }
      finally { saving.current = false; }
    };
    const timer = window.setInterval(() => {
      if (active()) pending.current += 1;
      if (pending.current >= 30) void flush();
    }, 1000);
    for (const event of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const) window.addEventListener(event, touch, { passive: true });
    window.addEventListener("focus", touch);
    const hide = () => { if (document.visibilityState !== "visible") void flush(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", flush);
    return () => {
      disposed = true; window.clearInterval(timer);
      for (const event of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const) window.removeEventListener(event, touch);
      window.removeEventListener("focus", touch); document.removeEventListener("visibilitychange", hide); window.removeEventListener("blur", flush);
      if (pending.current > 0) void api.addReadingTime(bookId, pending.current).catch(() => {});
    };
  }, [bookId, enabled, onSaved]);
}

export function formatReadingTime(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
