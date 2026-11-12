import { useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDroppable } from '@dnd-kit/core'
import { motion } from 'motion/react'
import { AudioLines, Download, FolderInput, Keyboard, Layers, Minus, Pause, Pencil, Play, Plus, RotateCcw, RotateCw, Search, Square, Trash2, Volume2, X } from 'lucide-react'
import { Eq, Logo, Slider, Toggle } from './ui'
import { fmtTime, type Board, type Playing, type Settings, type Sound } from '../lib'

export type Route = { label: string; tone: 'ok' | 'info' | 'warn' }

export function TitleBar({ route, onSetup }: { route: Route; onSetup: () => void }) {
  const w = getCurrentWindow()
  const tone = {
    ok: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/20',
    info: 'text-sky-300 bg-sky-400/10 ring-sky-400/20',
    warn: 'text-amber-300 bg-amber-400/10 ring-amber-400/25',
  }[route.tone]
  const dot = { ok: 'bg-emerald-400', info: 'bg-sky-400', warn: 'bg-amber-400' }[route.tone]
  const btn = 'grid h-10 w-11 place-items-center text-white/50 transition-colors hover:bg-white/8 hover:text-white'
  return (
    <header data-tauri-drag-region className="relative z-10 flex h-10 shrink-0 items-center gap-2.5 pl-4">
      <Logo size={18} />
      <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-white/85">
        Resonance
      </span>
      <div data-tauri-drag-region className="h-full flex-1" />
      <button onClick={onSetup} className={`flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition hover:brightness-125 ${tone}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dot} ${route.tone === 'ok' ? 'halo' : ''}`} />
        {route.label}
      </button>
      <div className="ml-2 flex">
        <button aria-label="Réduire" className={btn} onClick={() => w.minimize()}>
          <Minus size={15} />
        </button>
        <button aria-label="Agrandir" className={btn} onClick={() => w.toggleMaximize()}>
          <Square size={12} />
        </button>
        <button aria-label="Fermer" className={`${btn} hover:!bg-red-500/90`} onClick={() => w.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}

type SidebarProps = {
  boards: Board[]
  active: string
  searching: boolean
  query: string
  setQuery: (q: string) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (b: Board) => void
  onExport: (b: Board) => void
  onImport: () => void
  onSetup: () => void
  searchRef: React.RefObject<HTMLInputElement | null>
}

export function Sidebar(p: SidebarProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 px-3 pt-1 pb-3 xl:w-64">
      <label className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-white/40 transition focus-within:text-white/80 focus-within:ring-1 focus-within:ring-violet-500/50">
        <Search size={15} />
        <input
          ref={p.searchRef}
          value={p.query}
          onChange={(e) => p.setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && p.setQuery('')}
          placeholder="Rechercher un son"
          className="w-full bg-transparent text-[13px] text-white placeholder:text-white/35 focus:outline-none"
        />
        <kbd className="shrink-0 rounded bg-white/6 px-1.5 text-[10px] whitespace-nowrap text-white/35">Ctrl F</kbd>
      </label>

      <div className="flex items-center justify-between px-2">
        <span className="text-[11px] font-medium tracking-[.14em] text-white/35 uppercase">Soundboards</span>
        <button
          aria-label="Nouvelle soundboard"
          onClick={() => {
            p.onCreate()
          }}
          className="grid h-6 w-6 place-items-center rounded-md text-white/50 transition hover:bg-white/8 hover:text-white"
        >
          <Plus size={15} />
        </button>
      </div>

      <nav className="-mx-1 flex-1 space-y-0.5 overflow-y-auto px-1">
        {p.boards.map((b) => (
          <BoardItem
            key={b.id}
            board={b}
            active={!p.searching && b.id === p.active}
            renaming={renaming === b.id}
            onSelect={() => p.onSelect(b.id)}
            onStartRename={() => setRenaming(b.id)}
            onRename={(name) => {
              setRenaming(null)
              if (name.trim()) p.onRename(b.id, name.trim())
            }}
            onDelete={() => p.onDelete(b)}
            onExport={() => p.onExport(b)}
          />
        ))}
      </nav>

      <div className="space-y-1">
        <button onClick={p.onImport} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-white/55 transition hover:bg-white/5 hover:text-white">
          <FolderInput size={16} /> Importer une soundboard
        </button>
        <button onClick={p.onSetup} className="glass flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-white/85 transition hover:bg-white/8">
          <AudioLines size={16} className="text-violet-300" /> Audio & Discord
        </button>
      </div>
    </aside>
  )
}

function BoardItem({ board, active, renaming, onSelect, onStartRename, onRename, onDelete, onExport }: {
  board: Board
  active: boolean
  renaming: boolean
  onSelect: () => void
  onStartRename: () => void
  onRename: (n: string) => void
  onDelete: () => void
  onExport: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `board:${board.id}` })
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      onDoubleClick={onStartRename}
      className={`group relative flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition ${
        isOver ? 'bg-violet-500/20 ring-1 ring-violet-400/60' : active ? 'text-white' : 'text-white/55 hover:bg-white/4 hover:text-white/90'
      }`}
    >
      {active && <motion.div layoutId="active-board" className="absolute inset-0 rounded-xl bg-white/7 ring-1 ring-white/8" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
      <Layers size={15} className="relative shrink-0" style={{ color: board.color }} />
      {renaming ? (
        <input
          ref={input}
          autoFocus
          defaultValue={board.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') input.current?.blur()
            if (e.key === 'Escape') {
              e.preventDefault()
              onRename('')
            }
          }}
          className="relative w-full rounded bg-black/40 px-1.5 py-0.5 text-white ring-1 ring-violet-500/60 focus:outline-none"
        />
      ) : (
        <span className="relative flex-1 truncate">{board.name}</span>
      )}
      {!renaming && (
        <>
          <span className="relative text-[11px] text-white/30 tabular-nums group-hover:hidden">{board.sounds.length}</span>
          <span className="relative hidden gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
            {[
              { icon: Pencil, label: 'Renommer', fn: onStartRename },
              { icon: Download, label: 'Exporter', fn: onExport },
              { icon: Trash2, label: 'Supprimer', fn: onDelete },
            ].map(({ icon: I, label, fn }) => (
              <button key={label} aria-label={label} title={label} onClick={fn} className="grid h-6 w-6 place-items-center rounded-md text-white/45 hover:bg-white/10 hover:text-white">
                <I size={13} />
              </button>
            ))}
          </span>
        </>
      )}
    </div>
  )
}

export function PlayerBar({ now, count, settings, set, onStopAll, onPause, onSeek }: {
  now: { sound: Sound; p: Playing } | null
  count: number
  settings: Settings
  set: (s: Partial<Settings>) => void
  onStopAll: () => void
  onPause: (id: string, paused: boolean) => void
  onSeek: (id: string, delta: number) => void
}) {
  const pct = now && now.p.dur ? (now.p.pos / now.p.dur) * 100 : 0
  return (
    <footer className="glass relative z-10 mx-2 mb-2 flex h-[68px] shrink-0 items-center gap-5 rounded-2xl px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: now ? `${now.sound.color}33` : 'rgba(255,255,255,.05)', color: now?.sound.color }}>
          {now?.sound.emoji ? <span className="text-[20px]">{now.sound.emoji}</span> : now ? <Eq /> : <AudioLines size={17} className="text-white/25" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13px] font-medium">{now ? now.sound.name : 'Rien en lecture'}</span>
            {count > 1 && <span className="shrink-0 text-[11px] text-white/40">+{count - 1} autre{count > 2 ? 's' : ''}</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/40 tabular-nums">
            <span className="w-8">{now ? fmtTime(now.p.pos) : '0:00'}</span>
            <div className="h-1 max-w-80 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full transition-[width] duration-75" style={{ width: `${pct}%`, background: now?.sound.color ?? '#8b5cf6' }} />
            </div>
            <span className="w-8">{now ? fmtTime(now.p.dur) : '0:00'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button aria-label="Reculer de 5 secondes" title="Reculer de 5 s" disabled={!now} onClick={() => now && onSeek(now.sound.id, -5)} className="grid h-9 w-9 place-items-center rounded-full text-white/60 transition enabled:hover:bg-white/8 enabled:hover:text-white disabled:opacity-30">
          <RotateCcw size={17} />
        </button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          aria-label={now?.p.paused ? 'Reprendre' : 'Pause'}
          disabled={!now}
          onClick={() => now && onPause(now.sound.id, !now.p.paused)}
          className="grid h-10 w-10 place-items-center rounded-full bg-white text-black transition hover:scale-105 disabled:opacity-30"
        >
          {now?.p.paused ? <Play size={17} fill="currentColor" className="ml-0.5" /> : <Pause size={17} fill="currentColor" />}
        </motion.button>
        <button aria-label="Avancer de 5 secondes" title="Avancer de 5 s" disabled={!now} onClick={() => now && onSeek(now.sound.id, 5)} className="grid h-9 w-9 place-items-center rounded-full text-white/60 transition enabled:hover:bg-white/8 enabled:hover:text-white disabled:opacity-30">
          <RotateCw size={17} />
        </button>
      </div>

      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={onStopAll}
        disabled={!count}
        className="flex items-center gap-2 rounded-xl bg-white/6 px-4 py-2 text-[13px] font-medium transition enabled:hover:bg-red-500/85 disabled:opacity-35"
      >
        <Square size={13} fill="currentColor" /> Tout arrêter
      </motion.button>

      <div className="hidden items-center gap-4 lg:flex">
        <label className="flex items-center gap-2 text-[12px] text-white/55" title="Plusieurs sons en même temps, ou chaque son coupe le précédent">
          <Toggle on={settings.overlap} onChange={(v) => set({ overlap: v })} label="Superposer les sons" />
          Superposer
        </label>
        <label className="flex items-center gap-2 text-[12px] text-white/55" title="Désactive tous les raccourcis clavier globaux">
          <Toggle on={settings.hotkeysEnabled} onChange={(v) => set({ hotkeysEnabled: v })} label="Raccourcis clavier" />
          <Keyboard size={14} />
        </label>
      </div>

      <div className="flex w-44 items-center gap-2.5">
        <Volume2 size={16} className="shrink-0 text-white/55" />
        <Slider label="Volume général" value={settings.master} max={1.5} onChange={(v) => set({ master: v })} className="w-full" />
        <span className="w-9 text-right text-[11px] text-white/40 tabular-nums">{Math.round(settings.master * 100)}%</span>
      </div>
    </footer>
  )
}
