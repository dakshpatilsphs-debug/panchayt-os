import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconClose } from "./Icons";

type Tone = "ok" | "err" | "info";

interface ToastItem {
  id: number;
  msg: string;
  tone: Tone;
}

interface PushToast {
  (msg: string, tone?: Tone): void;
}

const ToasterCtx = createContext<{ toast: PushToast }>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const toast = useCallback<PushToast>((msg: string, tone: Tone = "ok") => {
    const id = ++next.current;
    setItems((v) => [...v, { id, msg, tone }]);
    setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToasterCtx.Provider value={{ toast }}>
      {children}
      <div className="toaster" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span className="toast-ico">
              {t.tone === "ok" ? <IconCheck size={15} /> : t.tone === "err" ? <IconAlert size={15} /> : <IconClose size={15} />}
            </span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToasterCtx.Provider>
  );
}

export const useToast = () => useContext(ToasterCtx);
