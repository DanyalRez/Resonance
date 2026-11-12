import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import { FileWarning, Pause, Pencil, Plus, Repeat, Star, Upload } from 'lucide-react'
import { Eq } from './ui'
import { prettyKey, type Playing, type Sound, type TileSize } from '../lib'

const MIN_W: Record<TileSize, number> = { sm: 128, md: 168, lg: 220 }

export type TileProps = {
  sound: Sound
  img?: string
  state?: Playing
  missing: boolean
  subtitle?: string
  onPlay: () => void
  onEdit: () => void
}

export function Tile({ sound, img, state, missing, subtitle, onPlay, onEdit }: TileProps) {
  const playing = !!state
  const pct = state && state.dur ? (state.pos / state.dur) * 100 : 0
  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={`Jouer ${sound.name}`}
      onClick={onPlay}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPlay())}
      onContextMenu={(e) => (e.preventDefault(), onEdit())}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.955 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="group relative aspect-[5/4] w-full cursor-pointer overflow-hidden rounded-2xl text-left"
      style={{
        background: `radial-gradient(120% 90% at 0% 0%, ${sound.color}40, transparent 60%), linear-gradient(160deg, ${sound.color}22, #0f0f16 70%)`,
        boxShadow: playing
          ? `0 0 0 1.5px ${sound.color}, 0 14px 40px -10px ${sound.color}aa`
          : 'inset 0 0 0 1px rgba(255,255,255,.06), 0 8px 24px -14px rgba(0,0,0,.9)',
      }}
    >
      {img && <img src={img} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-50 transition-opacity duration-300 group-hover:opacity-70" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      {playing && <div className="halo pointer-events-none absolute inset-0" style={{ background: `radial-gradient(80% 70% at 50% 100%, ${sound.color}55, transparent 70%)` }} />}

      <div className="absolute top-3 left-3 flex items-center gap-1.5" style={{ color: sound.color }}>
        {sound.emoji && <span className="text-[26px] leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,.6)]">{sound.emoji}</span>}
        {state?.paused ? <Pause size={13} fill="currentColor" /> : playing ? <Eq /> : !sound.emoji && <span className="h-2 w-2 rounded-full shadow-[0_0_10px_currentColor]" style={{ background: sound.color }} />}
        {sound.loop && <Repeat size={12} className="text-white/60" />}
        {sound.favorite && <Star size={12} className="text-amber-300" fill="currentColor" />}
      </div>

      <button
        aria-label={`Modifier ${sound.name}`}
        onClick={(e) => (e.stopPropagation(), onEdit())}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-lg bg-black/40 text-white/70 opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/70 hover:text-white focus-visible:opacity-100"
      >
        <Pencil size={13} />
      </button>

      <div className="absolute inset-x-3 bottom-3">
        {subtitle && <div className="mb-0.5 truncate text-[10px] tracking-wide text-white/45 uppercase">{subtitle}</div>}
        <div className="line-clamp-2 text-[13.5px] leading-tight font-semibold text-white drop-shadow">{sound.name}</div>
        {sound.hotkey && <div className="mt-1.5 inline-flex rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/70 backdrop-blur">{prettyKey(sound.hotkey)}</div>}
      </div>

      {missing && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 text-center text-[12px] text-amber-300 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-1.5 px-3">
            <FileWarning size={20} />
            Fichier manquant
            <span className="text-[11px] text-white/50">Clic droit pour le remplacer</span>
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
        <div className="h-full transition-[width] duration-75 ease-linear" style={{ width: `${pct}%`, background: sound.color }} />
      </div>
    </motion.div>
  )
}

function SortableTile(p: TileProps & { sortable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.sound.id, disabled: !p.sortable })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes}
      {...listeners}
      tabIndex={-1}
    >
      <Tile {...p} />
    </div>
  )
}

type BoardViewProps = {
  title: string
  info: string
  items: { sound: Sound; subtitle?: string }[]
  playing: Record<string, Playing>
  missing: Set<string>
  size: TileSize
  sortable: boolean
  img: (rel: string) => string
  onPlay: (s: Sound) => void
  onEdit: (s: Sound) => void
  onAdd?: () => void
  onSize: (s: TileSize) => void
  empty: string
}

export function BoardView(p: BoardViewProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-end gap-4 px-7 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <motion.h1 key={p.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="truncate text-[26px] font-semibold tracking-tight">
            {p.title}
          </motion.h1>
          <p className="mt-0.5 text-[12.5px] text-white/40">{p.info}</p>
        </div>
        <div className="flex rounded-xl bg-white/5 p-0.5 text-[11px] ring-1 ring-white/6" role="radiogroup" aria-label="Taille des boutons">
          {(['sm', 'md', 'lg'] as TileSize[]).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={p.size === s}
              onClick={() => p.onSize(s)}
              className={`relative rounded-lg px-2.5 py-1.5 font-medium transition ${p.size === s ? 'text-white' : 'text-white/45 hover:text-white/80'}`}
            >
              {p.size === s && <motion.span layoutId="size-pill" className="absolute inset-0 rounded-lg bg-white/10" />}
              <span className="relative">{{ sm: 'S', md: 'M', lg: 'L' }[s]}</span>
            </button>
          ))}
        </div>
        {p.onAdd && (
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            onClick={p.onAdd}
            className="accent-grad flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold shadow-[0_8px_24px_-8px_rgba(139,92,246,.7)]"
          >
            <Plus size={16} /> Ajouter des sons
          </motion.button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-7 pt-1 pb-8">
        {p.items.length === 0 ? (
          <button
            onClick={p.onAdd}
            disabled={!p.onAdd}
            className="grid h-full min-h-64 w-full place-items-center rounded-3xl border border-dashed border-white/10 text-white/45 transition enabled:hover:border-violet-400/50 enabled:hover:bg-violet-500/5 enabled:hover:text-white/75"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5">
                <Upload size={22} />
              </div>
              <span className="max-w-xs text-[13.5px] leading-relaxed">{p.empty}</span>
            </div>
          </button>
        ) : (
          <SortableContext items={p.items.map((i) => i.sound.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_W[p.size]}px, 1fr))` }}>
              {p.items.map(({ sound, subtitle }) => (
                <SortableTile
                  key={sound.id}
                  sound={sound}
                  subtitle={subtitle}
                  sortable={p.sortable}
                  img={sound.image ? p.img(sound.image) : undefined}
                  state={p.playing[sound.id]}
                  missing={p.missing.has(sound.file)}
                  onPlay={() => p.onPlay(sound)}
                  onEdit={() => p.onEdit(sound)}
                />
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </div>
  )
}
