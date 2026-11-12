import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'motion/react'
import { Upload } from 'lucide-react'
import { PlayerBar, Sidebar, TitleBar, type Route } from './components/Chrome'
import { BoardView, Tile } from './components/Board'
import { SoundEditor } from './components/Editor'
import { AudioSetup } from './components/Setup'
import { Toasts, useToasts } from './components/ui'
import {
  AUDIO_EXT, COLORS, MAX_FAVORITES, IMAGE_EXT, api, bindHotkeys, cleanBoard, fileUrl, isAudio, newBoard, newSound, parseLibrary, prettyKey,
  uid, type AudioStatus, type Board, type Library, type Playing, type Settings, type Sound, type TestResult,
} from './lib'

const filesOf = (sounds: Sound[]) => sounds.flatMap((s) => (s.image ? [s.file, s.image] : [s.file]))
const findSound = (l: Library, id: string) => {
  for (const b of l.boards) {
    const s = b.sounds.find((x) => x.id === id)
    if (s) return { board: b, sound: s }
  }
  return null
}

export default function App() {
  const [lib, setLib] = useState<Library | null>(null)
  const [dir, setDir] = useState('')
  const [playing, setPlaying] = useState<Record<string, Playing>>({})
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<AudioStatus | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const { toasts, toast } = useToasts()
  const searchRef = useRef<HTMLInputElement>(null)

  const libRef = useRef(lib)
  libRef.current = lib
  const playingRef = useRef(playing)
  playingRef.current = playing

  const update = useCallback((fn: (l: Library) => Library) => setLib((l) => l && fn(l)), [])
  const setSettings = useCallback((patch: Partial<Settings>) => update((l) => ({ ...l, settings: { ...l.settings, ...patch } })), [update])
  const mapSounds = (fn: (s: Sound) => Sound) => update((l) => ({ ...l, boards: l.boards.map((b) => ({ ...b, sounds: b.sounds.map(fn) })) }))
  const patchSound = (id: string, patch: Partial<Sound>) => mapSounds((s) => (s.id === id ? { ...s, ...patch } : s))
  const img = useCallback((rel: string) => fileUrl(dir, rel), [dir])
  const checkMissing = async (l: Library) => setMissing(new Set(await api.missing(l.boards.flatMap((b) => b.sounds.map((s) => s.file)))))

  // ---- load, autosave
  useEffect(() => {
    ;(async () => {
      setDir(await api.libraryDir())
      const l = parseLibrary(await api.load())
      setLib(l)
      if (!l.settings.setupDone) setSetupOpen(true)
      await checkMissing(l)
      api.preload(l.boards.flatMap((b) => b.sounds.map((s) => s.file)))
    })().catch((e) => toast(`Chargement impossible : ${e}`, 'error'))
  }, [])

  useEffect(() => {
    if (!lib) return
    const t = setTimeout(() => api.save(JSON.stringify(lib)).catch((e) => toast(`Sauvegarde impossible : ${e}`, 'error')), 250)
    return () => clearTimeout(t)
  }, [lib])

  // ---- audio routing
  const s = lib?.settings
  useEffect(() => {
    if (!s) return
    api.configure({ monitor: s.monitor, cable: s.cable, mic: s.mic, mic_enabled: s.micEnabled }).then((st) => {
      setStatus(st)
      setTest(null)
    })
  }, [s?.monitor, s?.cable, s?.mic, s?.micEnabled])

  useEffect(() => {
    if (s) api.levels(s.master, s.monitorGain, s.micGain)
  }, [s?.master, s?.monitorGain, s?.micGain])

  useEffect(() => {
    const un = listen<Playing[]>('playback', (e) => setPlaying(Object.fromEntries(e.payload.map((p) => [p.id, p]))))
    return () => void un.then((f) => f())
  }, [])

  const route: Route = !status?.cable
    ? { label: 'Discord : non configuré', tone: 'warn' }
    : test?.ok
      ? { label: 'Discord : transmission vérifiée', tone: 'ok' }
      : { label: 'Discord : câble actif, non testé', tone: 'info' }

  const runTest = async () => {
    setTesting(true)
    try {
      setTest(await api.test())
    } finally {
      setTesting(false)
    }
  }

  // ---- playback
  const trigger = useCallback(async (snd: Sound) => {
    if (playingRef.current[snd.id]) return void api.stop(snd.id)
    try {
      await api.play(snd.id, snd.file, snd.volume, snd.loop, !libRef.current!.settings.overlap)
    } catch (e) {
      toast(String(e), 'error')
      if (String(e).includes('introuvable')) setMissing((m) => new Set(m).add(snd.file))
    }
  }, [])

  const stopAll = () => api.stopAll()

  // ---- global hotkeys (paused while the editor is open so key capture works)
  const hotkeySig = lib ? lib.boards.flatMap((b) => b.sounds.filter((x) => x.hotkey).map((x) => `${x.id}=${x.hotkey}`)).join('|') : ''
  const hotkeysOn = !!lib?.settings.hotkeysEnabled && editing === null
  useEffect(() => {
    if (!lib) return
    const map = new Map<string, () => void>()
    if (hotkeysOn)
      for (const b of lib.boards)
        for (const x of b.sounds)
          if (x.hotkey)
            map.set(x.hotkey, () => {
              const cur = findSound(libRef.current!, x.id)
              if (cur) trigger(cur.sound)
            })
    bindHotkeys(map).then((failed) => failed.forEach((k) => toast(`Le raccourci ${prettyKey(k)} est déjà pris par une autre application.`, 'error')))
  }, [hotkeySig, hotkeysOn, !!lib])

  // ---- tray favourites
  const favs = lib ? lib.boards.flatMap((b) => b.sounds.filter((x) => x.favorite)).slice(0, MAX_FAVORITES) : []
  const favSig = favs.map((f) => `${f.id}=${f.emoji ?? ''}${f.name}`).join('|')
  useEffect(() => {
    if (lib) api.setTray(favs.map((f) => ({ id: f.id, label: f.emoji ? `${f.emoji}  ${f.name}` : f.name }))).catch(() => {})
  }, [favSig, !!lib])
  useEffect(() => {
    const un = listen<string>('tray-play', (e) => {
      const cur = libRef.current && findSound(libRef.current, e.payload)
      if (cur) trigger(cur.sound)
    })
    return () => void un.then((f) => f())
  }, [])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // ---- import
  const addFiles = async (paths: string[]) => {
    const audio = paths.filter(isAudio)
    if (!audio.length) return toast('Aucun fichier audio reconnu (MP3, WAV, OGG, FLAC, M4A).', 'error')
    if (audio.length > 3) toast(`Importation de ${audio.length} fichiers…`)
    const res = await api.importAudio(audio)
    res.filter((r) => r.error).forEach((r) => toast(`${r.name} : ${r.error}`, 'error'))
    const ok = res.filter((r) => r.file)
    const target = libRef.current!.active
    update((l) => ({
      ...l,
      boards: l.boards.map((b) => (b.id === target ? { ...b, sounds: [...b.sounds, ...ok.map((r, i) => newSound(r.name, r.file!, b.sounds.length + i))] } : b)),
    }))
    if (ok.length) toast(`${ok.length} son${ok.length > 1 ? 's ajoutés' : ' ajouté'}`, 'ok')
  }
  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles

  const pickFiles = async () => {
    const r = await open({ multiple: true, filters: [{ name: 'Audio', extensions: AUDIO_EXT }] })
    if (r) addFiles(Array.isArray(r) ? r : [r])
  }

  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload
      if (p.type === 'enter' || p.type === 'over') setDropping(true)
      else if (p.type === 'leave') setDropping(false)
      else if (p.type === 'drop') {
        setDropping(false)
        addFilesRef.current(p.paths)
      }
    })
    return () => void un.then((f) => f())
  }, [])

  // ---- boards
  const createBoard = () => {
    const b = newBoard('Nouvelle soundboard', COLORS[(lib?.boards.length ?? 0) % COLORS.length])
    update((l) => ({ ...l, boards: [...l.boards, b], active: b.id }))
    setQuery('')
  }

  const deleteBoard = async (b: Board) => {
    if (b.sounds.length && !(await ask(`Supprimer « ${b.name} » et ses ${b.sounds.length} sons ? Cette action est définitive.`, { title: 'Supprimer la soundboard', kind: 'warning', okLabel: 'Supprimer', cancelLabel: 'Annuler' }))) return
    b.sounds.forEach((x) => api.stop(x.id))
    api.deleteFiles(filesOf(b.sounds))
    update((l) => {
      const boards = l.boards.filter((x) => x.id !== b.id)
      if (!boards.length) boards.push(newBoard('Mes sons'))
      return { ...l, boards, active: boards.some((x) => x.id === l.active) ? l.active : boards[0].id }
    })
  }

  const exportBoard = async (b: Board) => {
    const dest = await save({ defaultPath: `${b.name}.resonance`, filters: [{ name: 'Soundboard Resonance', extensions: ['resonance'] }] })
    if (!dest) return
    try {
      await api.exportBoard(dest, JSON.stringify(b), filesOf(b.sounds))
      toast(`« ${b.name} » exportée`, 'ok')
    } catch (e) {
      toast(`Export impossible : ${e}`, 'error')
    }
  }

  const importBoard = async () => {
    const src = await open({ filters: [{ name: 'Soundboard Resonance', extensions: ['resonance', 'zip'] }] })
    if (!src) return
    try {
      const b = cleanBoard(JSON.parse(await api.importBoard(src)))
      const nb: Board = { ...b, id: uid(), sounds: b.sounds.map((x) => ({ ...x, id: uid() })) }
      update((l) => ({ ...l, boards: [...l.boards, nb], active: nb.id }))
      setQuery('')
      toast(`« ${nb.name} » importée (${nb.sounds.length} sons)`, 'ok')
      api.preload(nb.sounds.map((x) => x.file))
      checkMissing({ ...libRef.current!, boards: [...libRef.current!.boards, nb] })
    } catch (e) {
      toast(`Import impossible : ${e}`, 'error')
    }
  }

  const moveSound = (id: string, to: string) =>
    update((l) => {
      const found = findSound(l, id)
      if (!found || found.board.id === to) return l
      return {
        ...l,
        boards: l.boards.map((b) =>
          b.id === found.board.id ? { ...b, sounds: b.sounds.filter((x) => x.id !== id) } : b.id === to ? { ...b, sounds: [...b.sounds, found.sound] } : b,
        ),
      }
    })

  // ---- drag & drop of tiles: reorder in the grid, or drop on a board in the sidebar to move it
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null)
    if (!over) return
    const id = String(active.id)
    const overId = String(over.id)
    if (overId.startsWith('board:')) {
      const to = overId.slice(6)
      moveSound(id, to)
      const b = lib?.boards.find((x) => x.id === to)
      if (b && to !== lib?.active) toast(`Déplacé vers « ${b.name} »`, 'ok')
      return
    }
    if (id === overId) return
    update((l) => ({
      ...l,
      boards: l.boards.map((b) => {
        const i = b.sounds.findIndex((x) => x.id === id)
        const j = b.sounds.findIndex((x) => x.id === overId)
        return i < 0 || j < 0 ? b : { ...b, sounds: arrayMove(b.sounds, i, j) }
      }),
    }))
  }

  // ---- sound editor actions
  const edited = lib && editing ? findSound(lib, editing) : null
  const closeEditor = useCallback(() => setEditing(null), [])

  const replaceFile = async (snd: Sound) => {
    const r = await open({ filters: [{ name: 'Audio', extensions: AUDIO_EXT }] })
    if (!r) return
    const [res] = await api.importAudio([r])
    if (!res.file) return toast(`${res.name} : ${res.error}`, 'error')
    api.stop(snd.id)
    api.deleteFiles([snd.file])
    patchSound(snd.id, { file: res.file })
    setMissing((m) => {
      const n = new Set(m)
      n.delete(snd.file)
      return n
    })
    toast('Fichier remplacé', 'ok')
  }

  const pickImage = async (snd: Sound) => {
    const r = await open({ filters: [{ name: 'Image', extensions: IMAGE_EXT }] })
    if (!r) return
    try {
      const rel = await api.importImage(r)
      if (snd.image) api.deleteFiles([snd.image])
      patchSound(snd.id, { image: rel })
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const deleteSound = async (snd: Sound) => {
    if (!(await ask(`Supprimer « ${snd.name} » ? Cette action est définitive.`, { title: 'Supprimer le son', kind: 'warning', okLabel: 'Supprimer', cancelLabel: 'Annuler' }))) return
    setEditing(null)
    api.stop(snd.id)
    api.deleteFiles(filesOf([snd]))
    update((l) => ({ ...l, boards: l.boards.map((b) => ({ ...b, sounds: b.sounds.filter((x) => x.id !== snd.id) })) }))
  }

  const hotkeyTaken = (acc: string) => {
    for (const b of lib!.boards) for (const x of b.sounds) if (x.hotkey === acc && x.id !== editing) return x.name
    return null
  }

  // ---- view
  const items = useMemo(() => {
    if (!lib) return []
    const q = query.trim().toLowerCase()
    if (q) return lib.boards.flatMap((b) => b.sounds.filter((x) => x.name.toLowerCase().includes(q)).map((sound) => ({ sound, subtitle: b.name })))
    return (lib.boards.find((b) => b.id === lib.active)?.sounds ?? []).map((sound) => ({ sound }))
  }, [lib, query])

  const now = useMemo(() => {
    const ids = Object.keys(playing)
    if (!lib || !ids.length) return null
    const f = findSound(lib, ids[ids.length - 1])
    return f ? { sound: f.sound, p: playing[f.sound.id] } : null
  }, [playing, lib])

  if (!lib) return <div className="h-full bg-ink" />
  const board = lib.boards.find((b) => b.id === lib.active)!
  const dragged = dragId ? findSound(lib, dragId)?.sound : null

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute -right-40 -bottom-48 h-[560px] w-[560px] rounded-full bg-blue-600/15 blur-[130px]" />
        <div className="absolute top-1/3 left-1/2 h-72 w-72 rounded-full bg-fuchsia-500/8 blur-[110px]" />
      </div>

      <TitleBar route={route} onSetup={() => setSetupOpen(true)} />

      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={(e) => setDragId(String(e.active.id))} onDragCancel={() => setDragId(null)} onDragEnd={onDragEnd}>
        <div className="relative flex min-h-0 flex-1">
          <Sidebar
            boards={lib.boards}
            active={lib.active}
            searching={!!query.trim()}
            query={query}
            setQuery={setQuery}
            searchRef={searchRef}
            onSelect={(id) => (update((l) => ({ ...l, active: id })), setQuery(''))}
            onCreate={createBoard}
            onRename={(id, name) => update((l) => ({ ...l, boards: l.boards.map((b) => (b.id === id ? { ...b, name } : b)) }))}
            onDelete={deleteBoard}
            onExport={exportBoard}
            onImport={importBoard}
            onSetup={() => setSetupOpen(true)}
          />
          <main className="glass mr-2 mb-2 min-w-0 flex-1 overflow-hidden rounded-3xl">
            {query.trim() ? (
              <BoardView
                title={`« ${query.trim()} »`}
                info={`${items.length} résultat${items.length > 1 ? 's' : ''} dans toutes les soundboards`}
                items={items}
                playing={playing}
                missing={missing}
                size={lib.settings.tileSize}
                sortable={false}
                img={img}
                onPlay={trigger}
                onEdit={(x) => setEditing(x.id)}
                onSize={(tileSize) => setSettings({ tileSize })}
                empty="Aucun son ne correspond à cette recherche."
              />
            ) : (
              <BoardView
                title={board.name}
                info={`${board.sounds.length} son${board.sounds.length > 1 ? 's' : ''} · clic pour jouer, clic droit pour modifier, glisser pour réorganiser`}
                items={items}
                playing={playing}
                missing={missing}
                size={lib.settings.tileSize}
                sortable
                img={img}
                onPlay={trigger}
                onEdit={(x) => setEditing(x.id)}
                onAdd={pickFiles}
                onSize={(tileSize) => setSettings({ tileSize })}
                empty="Glissez vos fichiers audio ici, ou cliquez pour en choisir. Plusieurs fichiers à la fois, c'est possible."
              />
            )}
          </main>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragged && (
            <div className="w-44 rotate-2 opacity-90 shadow-2xl">
              <Tile sound={dragged} img={dragged.image ? img(dragged.image) : undefined} missing={false} onPlay={() => {}} onEdit={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <PlayerBar now={now} count={Object.keys(playing).length} settings={lib.settings} set={setSettings} onStopAll={stopAll} onPause={(id, paused) => api.pause(id, paused)} onSeek={(id, d) => api.seek(id, d)} />

      <AnimatePresence>
        {dropping && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-30 grid place-items-center bg-black/55 backdrop-blur-md">
            <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} className="flex flex-col items-center gap-4 rounded-[32px] border-2 border-dashed border-violet-400/60 px-20 py-14 text-center">
              <div className="accent-grad grid h-16 w-16 place-items-center rounded-2xl shadow-[0_10px_40px_-8px_rgba(139,92,246,.8)]">
                <Upload size={26} />
              </div>
              <div className="text-[18px] font-semibold">Déposez pour ajouter à « {board.name} »</div>
              <div className="text-[13px] text-white/50">MP3, WAV, OGG, FLAC, M4A</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {edited && (
          <SoundEditor
            key={edited.sound.id}
            sound={edited.sound}
            boardId={edited.board.id}
            boards={lib.boards}
            img={edited.sound.image ? img(edited.sound.image) : undefined}
            missing={missing.has(edited.sound.file)}
            hotkeyTaken={hotkeyTaken}
            favoritesFull={favs.length >= MAX_FAVORITES}
            onChange={(patch) => patchSound(edited.sound.id, patch)}
            onMove={(to) => moveSound(edited.sound.id, to)}
            onReplace={() => replaceFile(edited.sound)}
            onPickImage={() => pickImage(edited.sound)}
            onClearImage={() => (api.deleteFiles([edited.sound.image!]), patchSound(edited.sound.id, { image: undefined }))}
            onPreview={() => trigger(edited.sound)}
            onDelete={() => deleteSound(edited.sound)}
            onClose={closeEditor}
          />
        )}
        {setupOpen && (
          <AudioSetup settings={lib.settings} set={setSettings} status={status} test={test} testing={testing} onTest={runTest} onClose={() => setSetupOpen(false)} />
        )}
      </AnimatePresence>

      <Toasts toasts={toasts} />
    </div>
  )
}
