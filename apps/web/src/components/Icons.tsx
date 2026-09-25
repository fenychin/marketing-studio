import { type ReactNode } from "react";

export function Icon({ path, size = 16, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

export const icons = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  heart: "M12 20.5S4 15 4 9.6C4 6.9 6.1 5 8.6 5c1.5 0 2.6.7 3.4 1.9C12.8 5.7 13.9 5 15.4 5 17.9 5 20 6.9 20 9.6c0 5.4-8 10.9-8 10.9Z",
  play: "M9 6.5v11l9-5.5-9-5.5Z",
  cursor: "M5 4l7.5 16 2-6.5L21 11 5 4Z",
  plus: "M12 5v14M5 12h14",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 3.5 3.5 3-3L19 15M9.5 9.2a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0Z",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3ZM12 12l8-4.5M12 12L4 7.5M12 12v9",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4L15 12l-3-3 2.7-2.7Z",
  close: "M6 6l12 12M18 6 6 18",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
  uploadCloud: "M7 16.5A4.5 4.5 0 0 1 7.3 7.6a5.5 5.5 0 0 1 10.6 1.2A3.9 3.9 0 0 1 17.5 16.5M12 12v8M8.8 15.2 12 12l3.2 3.2",
  sort: "M4 7h12M4 12h9M4 17h6M18 10v8M18 18l-2.5-2.5M18 18l2.5-2.5",
  stack: "M8 4h11v11M5 8h11v11H5z",
};

export function Section({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-[#565656]">{children}</div>;
}
