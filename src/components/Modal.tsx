import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? "wide" : ""}`} aria-labelledby={id}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}
