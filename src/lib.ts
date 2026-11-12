import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'

// name and emoji live only in the library: the audio file on disk is never renamed
export type Sound = { id: string; name: string; file: string; image?: string; emoji?: string; color: string; volume: number; loop: boolean; hotkey?: string; favorite?: boolean }
export type Board = { id: string; name: string; color: string; sounds: Sound[] }
export type TileSize = 'sm' | 'md' | 'lg'
export type Settings = {
  master: number
  monitorGain: number
  micGain: number
  micEnabled: boolean
  overlap: boolean
  hotkeysEnabled: boolean
  tileSize: TileSize
  monitor: string | null
  cable: string | null
  mic: string | null
  setupDone: boolean
}
export type Library = { version: 1; boards: Board[]; active: string; settings: Settings }

export type Devices = { outputs: string[]; inputs: string[]; default_output: string | null; default_input: string | null }
export type AudioStatus = { monitor: string | null; cable: string | null; mic: string | null; errors: string[] }
export type Imported = { name: string; file: string | null; error: string | null }
export type Playing = { id: string; pos: number; dur: number; paused: boolean }
export type TestResult = { ok: boolean; peak: number; message: string }

export const api = {
  libraryDir: () => invoke<string>('library_dir'),
  load: () => invoke<string | null>('load_library'),
  save: (json: string) => invoke('save_library', { json }),
  importAudio: (paths: string[]) => invoke<Imported[]>('import_audio', { paths }),
  importImage: (path: string) => invoke<string>('import_image', { path }),
  deleteFiles: (files: string[]) => invoke('delete_files', { files }),
  missing: (files: string[]) => invoke<string[]>('missing_files', { files }),
  preload: (files: string[]) => invoke('preload', { files }),
  devices: () => invoke<Devices>('list_devices'),
  configure: (cfg: { monitor: string | null; cable: string | null; mic: string | null; mic_enabled: boolean }) =>
    invoke<AudioStatus>('configure_audio', { cfg }),
  levels: (master: number, monitorGain: number, micGain: number) => invoke('set_levels', { master, monitorGain, micGain }),
  play: (id: string, file: string, gain: number, looping: boolean, exclusive: boolean) =>
    invoke<number>('play', { id, file, gain, looping, exclusive }),
  stop: (id: string) => invoke('stop', { id }),
  stopAll: () => invoke('stop_all'),
  pause: (id: string, paused: boolean) => invoke('pause', { id, paused }),
  seek: (id: string, delta: number) => invoke('seek', { id, delta }),
  setTray: (favs: { id: string; label: string }[]) => invoke('set_tray', { favs }),
  test: () => invoke<TestResult>('test_route'),
  exportBoard: (dest: string, board: string, files: string[]) => invoke('export_board', { dest, board, files }),
  importBoard: (src: string) => invoke<string>('import_board', { src }),
}

export const MAX_FAVORITES = 5
export const EMOJIS = ['😂', '💀', '🔥', '👏', '🤡', '😱', '🎉', '💥', '🚨', '🐐', '🗿', '😈', '🥁', '🎺', '🎵', '📢', '👀', '🤯', '😭', '🫡', '💨', '⚡', '🐸', '🤖']
export const COLORS = ['#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a1a1aa']
export const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'mp4']
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']
export const uid = () => crypto.randomUUID()
export const extOf = (p: string) => p.split('.').pop()?.toLowerCase() ?? ''
export const isAudio = (p: string) => AUDIO_EXT.includes(extOf(p))
export const fileUrl = (dir: string, rel: string) => convertFileSrc(`${dir}\\${rel.replace('/', '\\')}`)
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  monitorGain: 1,
  micGain: 1,
  micEnabled: true,
  overlap: true,
  hotkeysEnabled: true,
  tileSize: 'md',
  monitor: null,
  cable: null,
  mic: null,
  setupDone: false,
}

export const newBoard = (name: string, color = COLORS[0]): Board => ({ id: uid(), name, color, sounds: [] })
export const newSound = (name: string, file: string, i: number): Sound => ({
  id: uid(),
  name,
  file,
  color: COLORS[i % COLORS.length],
  volume: 1,
  loop: false,
})

// Library JSON and imported boards are untrusted input: rebuild every field with a default.
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
function cleanSound(x: any, i: number): Sound | null {
  if (!x || typeof x.file !== 'string') return null
  return {
    id: str(x.id, uid()),
    name: str(x.name, 'Son'),
    file: x.file,
    image: typeof x.image === 'string' ? x.image : undefined,
    emoji: typeof x.emoji === 'string' ? x.emoji.slice(0, 16) : undefined,
    favorite: !!x.favorite,
    color: str(x.color, COLORS[i % COLORS.length]),
    volume: typeof x.volume === 'number' ? Math.min(Math.max(x.volume, 0), 2) : 1,
    loop: !!x.loop,
    hotkey: typeof x.hotkey === 'string' ? x.hotkey : undefined,
  }
}
export function cleanBoard(x: any): Board {
  const sounds = (Array.isArray(x?.sounds) ? x.sounds : []).map(cleanSound).filter(Boolean) as Sound[]
  return { id: str(x?.id, uid()), name: str(x?.name, 'Soundboard'), color: str(x?.color, COLORS[0]), sounds }
}
export function parseLibrary(raw: string | null): Library {
  const d = raw ? JSON.parse(raw) : {}
  const boards: Board[] = Array.isArray(d.boards) && d.boards.length ? d.boards.map(cleanBoard) : [newBoard('Mes sons')]
  return {
    version: 1,
    boards,
    active: boards.some((b) => b.id === d.active) ? d.active : boards[0].id,
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
  }
}

/** Accelerator in the global-shortcut plugin format, e.g. "Control+Shift+KeyK". */
export function accelFrom(e: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(e.key)) return null
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  return [...mods, e.code].join('+')
}
export const prettyKey = (acc: string) =>
  acc
    .split('+')
    .map((k) => k.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace('Control', 'Ctrl').replace('Super', 'Win'))
    .join(' + ')

let chain: Promise<string[]> = Promise.resolve([])
/** Re-registers every global shortcut; resolves with those another app already owns. */
export function bindHotkeys(map: Map<string, () => void>) {
  chain = chain.then(async () => {
    await unregisterAll().catch(() => {})
    const failed: string[] = []
    for (const [acc, fn] of map) {
      try {
        await register(acc, (e) => {
          if (e.state === 'Pressed') fn()
        })
      } catch {
        failed.push(acc)
      }
    }
    return failed
  })
  return chain
}
