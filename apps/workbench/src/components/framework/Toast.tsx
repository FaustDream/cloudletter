/** 框架层 · 轻提示（Toast）：全局单例，push 即显，3s 自动消失 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type Kind = 'ok' | 'err'
interface ToastState {
  id: number
  text: string
  kind: Kind
}

const ToastCtx = createContext<{ toast: (text: string, kind?: Kind) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastState[]>([])
  const seq = useRef(0)

  const toast = useCallback((text: string, kind: Kind = 'ok') => {
    const id = ++seq.current
    setList((p) => [...p, { id, text, kind }])
    setTimeout(() => setList((p) => p.filter((t) => t.id !== id)), 3000)
  }, [])

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {list.map((t) => (
        <div key={t.id} className={`wb-toast ${t.kind === 'err' ? 'err' : ''}`}>
          {t.text}
        </div>
      ))}
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用')
  return ctx.toast
}