import type { ReactNode } from "react";
import { Icon, icons } from "./Icons";

export function Modal({ title, onClose, children, width = "max-w-3xl" }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <div
        className={`w-full ${width} relative rounded-2xl border border-[#2a2a2a] bg-[#151515] p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="absolute right-4 top-4 text-[#7a7a7a] hover:text-white" onClick={onClose} aria-label="Close">
          <Icon path={icons.close} size={18} />
        </button>
        <div className="mb-4 text-[15px] font-bold">{title}</div>
        {children}
      </div>
    </div>
  );
}
