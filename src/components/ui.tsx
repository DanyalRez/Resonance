import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck, Info, TriangleAlert } from 'lucide-react'

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        <linearGradient id="lg-bar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect x="32" y="32" width="960" height="960" rx="224" fill="#16122a" stroke="rgba(255,255,255,.15)" strokeWidth="8" />
      <g fill="url(#lg-bar)">
        <rect x="232" y="432" width="88" height="160" rx="44" />
        <rect x="364" y="312" width="88" height="400" rx="44" />
        <rect x="496" y="232" width="88" height="560" rx="44" />
        <rect x="628" y="352" width="88" height="320" rx="44" />
        <rect x="760" y="452" width="88" height="120" rx="44" opacity=".75" />
      </g>
    </svg>
  )
}

export function Modal({ onClose, children, className = 'max-w-lg' }: { onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <motion.div className="fixed inset-0 z-40 flex items-center justify-center p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-modal
        initial={{ y: 18, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 10, scale: 0.98, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className={`glass-strong relative max-h-full w-full overflow-y-auto rounded-3xl ${className}`}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.01, label, className = '' }: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  className?: string
}) {
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ['--p' as string]: `${((value - min) / (max - min)) * 100}%` }}
      className={className}
    />
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'accent-grad' : 'bg-white/12'}`}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 35 }} className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${on ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  )
}

export type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' }

export function useToasts() {
  const [toasts, set] = useState<Toast[]>([])
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    set((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => set((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6500 : 3500)
  }, [])
  return { toasts, toast }
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed right-5 bottom-24 z-50 flex flex-col items-end gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            className="glass-strong flex max-w-sm items-start gap-2.5 rounded-2xl px-4 py-3 text-[13px] leading-snug"
          >
            {t.tone === 'ok' ? (
              <CircleCheck size={16} className="mt-px shrink-0 text-emerald-400" />
            ) : t.tone === 'error' ? (
              <TriangleAlert size={16} className="mt-px shrink-0 text-amber-400" />
            ) : (
              <Info size={16} className="mt-px shrink-0 text-violet-300" />
            )}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Eq({ className = '' }: { className?: string }) {
  return (
    <span className={`eq flex h-3.5 items-end gap-[2px] ${className}`} aria-hidden>
      <span className="h-full" />
      <span className="h-full" />
      <span className="h-full" />
      <span className="h-full" />
    </span>
  )
}
