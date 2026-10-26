"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Modal panel built on the native <dialog>: focus moves in and is contained,
 * Escape closes, the page behind is inert, and focus returns to the opener.
 * A right-hand side panel from the `md` breakpoint up; a bottom sheet on phones.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const opener = document.activeElement as HTMLElement | null;
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
      return () => {
        document.documentElement.style.overflow = "";
        if (dialog.open) dialog.close();
        opener?.focus?.();
      };
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the dialog box itself (not its content) is a click on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
      className="cm-sheet fixed inset-x-0 bottom-0 top-auto m-0 flex max-h-[92dvh] w-full max-w-none flex-col overflow-hidden rounded-t-[18px] bg-white p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-navy-950/45 md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:max-h-none md:w-[440px] md:rounded-none md:rounded-l-[18px] [&:not([open])]:hidden"
    >
      {open ? (
        <>
          <div className="flex justify-center pt-2 md:hidden" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
          <header className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-3 md:pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-component font-semibold text-navy-900">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-1 text-small leading-relaxed text-ink-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="btn-quiet -mr-2 -mt-1 h-9 w-9 justify-center p-0">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 scrollbar-thin">{children}</div>
        </>
      ) : null}
    </dialog>
  );
}
