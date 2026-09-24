import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, close, children, className = '' }: {
  title: string; close: () => void; children: ReactNode; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog ref={dialog} className={'dialog ' + className} aria-label={title}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <header className="dialog-header"><h2>{title}</h2><button className="icon-button" aria-label={'关闭' + title} title="关闭 (Esc)" onClick={close}><X size={16} /></button></header>
      {children}
    </dialog>
  );
}
