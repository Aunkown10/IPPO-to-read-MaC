import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  book: "M3 5h6a4 4 0 0 1 4 4v12a5 5 0 0 0-4-3H3zm18 0h-4a4 4 0 0 0-4 4v12a5 5 0 0 1 4-3h4z",
  grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  play: "m9 5 11 7-11 7z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1 5 5",
  plus: "M12 5v14M5 12h14",
  folder: "M3 7V5h6l2 3h10v12H3zm0 1h8",
  back: "m14 5-7 7 7 7M7 12h14",
  left: "m15 5-7 7 7 7",
  right: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  lock: "M6 10h12v11H6zm3 0V6a3 3 0 0 1 6 0v4m-3 5v2",
  unlock: "M6 10h12v11H6zm9 0V6a3 3 0 0 0-5.7-1.3M12 15v2",
  settings: "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  scroll: "M6 3h12v18H6zm3 5h6m-6 4h6m-6 4h6",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  help: "M9 8a3 3 0 1 1 5 2.2c-1.3.8-2 1.1-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  image: "M4 5h16v14H4zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-4 7 5-5 3 3 2-2 6 6",
  flip: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zm0 0v13a3 3 0 0 0 3 3M9 8h6m-6 4h6",
  music: "M9 18V5l11-2v13M9 8l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  pause: "M8 5v14M16 5v14",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3",
  repeatone: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3M12 9v6m-2-4 2-2",
  up: "m6 15 6-6 6 6",
  down: "m6 9 6 6 6-6",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  alert: "M12 3v12m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",

};
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 4 : 1.7} strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name] ?? paths.book} /></svg>;
}
