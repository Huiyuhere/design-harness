"use client";

import { useEffect, useRef, type ReactNode } from 'react';

/** Native modality keeps the canvas inert and restores the opening control. */
export function CanvasDialog({ label, className = '', children, onDismiss }: {
  label: string; className?: string; children: ReactNode; onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>('[data-dialog-focus]') ?? dialog.querySelector<HTMLButtonElement>('button:not([tabindex="-1"])'))?.focus();
    const wrapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,summary,[tabindex]'))
        .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', wrapFocus);
    return () => { dialog.removeEventListener('keydown', wrapFocus); dialog.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`modal-backdrop canvas-dialog ${className}`} aria-label={label}
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <button className="canvas-dialog-dismiss" type="button" tabIndex={-1} aria-label={`Dismiss ${label}`} onClick={onDismiss} />
    {children}
  </dialog>;
}
