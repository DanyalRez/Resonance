import { useState } from 'react'
import { motion } from 'motion/react'
import { FileAudio, ImagePlus, Keyboard, Play, Repeat, Smile, Star, Trash2, Volume2, X } from 'lucide-react'
import { Modal, Slider, Toggle } from './ui'
import { COLORS, EMOJIS, MAX_FAVORITES, accelFrom, prettyKey, type Board, type Sound } from '../lib'

type Props = {
  sound: Sound
  boardId: string
  boards: Board[]
  img?: string
  missing: boolean
  hotkeyTaken: (acc: string) => string | null
  favoritesFull: boolean
  onChange: (patch: Partial<Sound>) => void
  onMove: (boardId: string) => void
  onReplace: () => void
  onPickImage: () => void
  onClearImage: () => void
  onPreview: () => void
  onDelete: () => void
  onClose: () => void
}

const row = 'flex items-center justify-between gap-4 py-3'
const lbl = 'flex items-center gap-2.5 text-[13px] text-white/70'

export function SoundEditor(p: Props) {
  const s = p.sound
  return (
    <Modal onClose={p.onClose} className="max-w-[520px]">
      <div className="relative h-36 overflow-hidden rounded-t-3xl" style={{ background: `radial-gradient(120% 120% at 0% 0%, ${s.color}66, transparent 60%), linear-gradient(160deg, ${s.color}33, #0f0f16 80%)` }}>
        {p.img && <img src={p.img} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#14141e] to-transparent" />
        <button aria-label="Fermer" onClick={p.onClose} className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white/70 backdrop-blur hover:text-white">
          <X size={16} />
        </button>
        <div className="absolute inset-x-6 bottom-3 flex items-end gap-3">
          <input
            value={s.name}
            onChange={(e) => p.onChange({ name: e.target.value })}
            aria-label="Nom du son"
            className="min-w-0 flex-1 rounded-lg bg-transparent px-1 text-[22px] font-semibold tracking-tight text-white ring-violet-500/60 hover:bg-white/5 focus:bg-black/30 focus:ring-1 focus:outline-none"
          />
          <motion.button whileTap={{ scale: 0.92 }} onClick={p.onPreview} disabled={p.missing} className="accent-grad flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold disabled:opacity-40">
            <Play size={14} fill="currentColor" /> Écouter
          </motion.button>
        </div>
      </div>

      <div className="divide-y divide-white/6 px-6 pb-5">
        <div className={row}>
          <span className={lbl}>Couleur</span>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Couleur ${c}`}
                onClick={() => p.onChange({ color: c })}
                className={`h-5 w-5 rounded-full transition hover:scale-110 ${s.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#14141e]' : ''}`}
                style={{ background: c }}
              />
            ))}
            <input type="color" aria-label="Couleur personnalisée" value={s.color} onChange={(e) => p.onChange({ color: e.target.value })} className="h-5 w-5" />
          </div>
        </div>

        <div className="py-3">
          <div className="flex items-center justify-between gap-4">
            <span className={lbl}>
              <Smile size={16} /> Emoji
            </span>
            <div className="flex items-center gap-2">
              <input
                value={s.emoji ?? ''}
                onChange={(e) => p.onChange({ emoji: e.target.value.trim().slice(0, 16) || undefined })}
                placeholder="Win + ."
                aria-label="Emoji personnalisé"
                className="w-20 rounded-lg bg-white/6 px-2 py-1 text-center text-[16px] ring-1 ring-white/8 placeholder:text-[11px] placeholder:text-white/30 focus:ring-violet-500/60 focus:outline-none"
              />
              {s.emoji && (
                <button onClick={() => p.onChange({ emoji: undefined })} className="rounded-lg px-2 py-1 text-[12px] text-white/50 hover:bg-white/6 hover:text-white">
                  Retirer
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {EMOJIS.map((e) => (
              <button key={e} aria-label={`Emoji ${e}`} onClick={() => p.onChange({ emoji: e })} className={`grid h-8 w-8 place-items-center rounded-lg text-[18px] transition hover:scale-110 hover:bg-white/8 ${s.emoji === e ? 'bg-violet-500/25 ring-1 ring-violet-400/60' : ''}`}>
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className={row}>
          <span className={lbl}>
            <Star size={16} /> Favori
            <span className="text-[11.5px] text-white/35">menu de l'icône dans la barre des tâches (5 max)</span>
          </span>
          <Toggle on={!!s.favorite} onChange={(v) => (!v || !p.favoritesFull) && p.onChange({ favorite: v })} label="Favori" />
        </div>
        {p.favoritesFull && !s.favorite && <p className="-mt-2 pb-2 text-right text-[11.5px] text-amber-300/80">Déjà {MAX_FAVORITES} favoris : retirez-en un d'abord.</p>}

        <div className={row}>
          <span className={lbl}>
            <ImagePlus size={16} /> Image
          </span>
          <div className="flex gap-2">
            <button onClick={p.onPickImage} className="rounded-lg bg-white/6 px-3 py-1.5 text-[12px] font-medium hover:bg-white/10">
              {s.image ? 'Changer' : 'Choisir une image'}
            </button>
            {s.image && (
              <button onClick={p.onClearImage} className="rounded-lg px-2 py-1.5 text-[12px] text-white/50 hover:bg-white/6 hover:text-white">
                Retirer
              </button>
            )}
          </div>
        </div>

        <div className={row}>
          <span className={lbl}>
            <Volume2 size={16} /> Volume
          </span>
          <div className="flex w-56 items-center gap-3">
            <Slider label="Volume du son" value={s.volume} max={2} onChange={(v) => p.onChange({ volume: v })} className="flex-1" />
            <span className="w-10 text-right text-[12px] text-white/50 tabular-nums">{Math.round(s.volume * 100)}%</span>
          </div>
        </div>

        <div className={row}>
          <span className={lbl}>
            <Repeat size={16} /> Lecture en boucle
          </span>
          <Toggle on={s.loop} onChange={(v) => p.onChange({ loop: v })} label="Lecture en boucle" />
        </div>

        <div className={row}>
          <span className={lbl}>
            <Keyboard size={16} /> Raccourci clavier
          </span>
          <HotkeyInput value={s.hotkey} taken={p.hotkeyTaken} onChange={(hotkey) => p.onChange({ hotkey })} />
        </div>

        <div className={row}>
          <span className={lbl}>Soundboard</span>
          <select
            value={p.boardId}
            onChange={(e) => p.onMove(e.target.value)}
            aria-label="Déplacer vers la soundboard"
            className="max-w-56 rounded-lg bg-white/6 px-3 py-1.5 text-[12.5px] ring-1 ring-white/8 focus:outline-none"
          >
            {p.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-3 pt-4">
          <button onClick={p.onReplace} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium ${p.missing ? 'bg-amber-400/15 text-amber-200 hover:bg-amber-400/25' : 'bg-white/6 hover:bg-white/10'}`}>
            <FileAudio size={15} /> {p.missing ? 'Fichier manquant : remplacer' : 'Remplacer le fichier'}
          </button>
          <button onClick={p.onDelete} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-red-300/80 hover:bg-red-500/15 hover:text-red-200">
            <Trash2 size={15} /> Supprimer
          </button>
        </div>
      </div>
    </Modal>
  )
}

function HotkeyInput({ value, taken, onChange }: { value?: string; taken: (acc: string) => string | null; onChange: (v: string | undefined) => void }) {
  const [rec, setRec] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <button
          onClick={() => (setRec(true), setWarn(null))}
          onBlur={() => setRec(false)}
          onKeyDown={(e) => {
            if (!rec) return
            e.preventDefault()
            if (e.key === 'Escape') return setRec(false)
            if (e.key === 'Backspace' || e.key === 'Delete') return onChange(undefined), setRec(false)
            const a = accelFrom(e)
            if (!a) return
            const other = taken(a)
            setWarn(other ? `Déjà utilisé par « ${other} »` : null)
            if (!other) onChange(a)
            setRec(false)
          }}
          className={`min-w-36 rounded-lg px-3 py-1.5 text-[12.5px] font-medium ring-1 transition ${rec ? 'bg-violet-500/20 text-violet-200 ring-violet-400/60' : 'bg-white/6 ring-white/8 hover:bg-white/10'}`}
        >
          {rec ? 'Appuyez sur une touche…' : value ? prettyKey(value) : 'Définir'}
        </button>
        {value && !rec && (
          <button aria-label="Retirer le raccourci" onClick={() => onChange(undefined)} className="grid w-7 place-items-center rounded-lg text-white/45 hover:bg-white/6 hover:text-white">
            <X size={14} />
          </button>
        )}
      </div>
      {warn && <span className="text-[11px] text-amber-300">{warn}</span>}
    </div>
  )
}
