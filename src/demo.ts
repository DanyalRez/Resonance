// Dev-only fake Tauri backend used to render README screenshots (demo.html#main | #setup | #editor).
const view = location.hash.slice(1) || 'main'

const s = (name: string, emoji: string, color: string, extra: object = {}) => ({ id: name, name, emoji, color, file: 'sounds/demo.mp3', volume: 1, loop: false, ...extra })
const library = {
  version: 1,
  active: 'memes',
  boards: [
    {
      id: 'memes',
      name: 'Memes',
      color: '#8b5cf6',
      sounds: [
        s('Vine boom', '💥', '#8b5cf6', { hotkey: 'Control+Digit1', favorite: true }),
        s('Bruh', '🗿', '#6366f1', { hotkey: 'Control+Digit2' }),
        s('Sad violin', '😭', '#3b82f6', { favorite: true }),
        s('Airhorn', '📢', '#f97316', { hotkey: 'Control+Digit3', favorite: true }),
        s('Applaudissements', '👏', '#22c55e'),
        s('Drum roll', '🥁', '#eab308', { loop: true }),
        s('Suspense', '😱', '#ef4444'),
        s('Mission failed', '💀', '#a1a1aa'),
        s('Victoire', '🎉', '#ec4899', { favorite: true }),
        s('Alarme', '🚨', '#ef4444'),
        s('Rire', '😂', '#14b8a6'),
        s('Ba dum tss', '🎺', '#0ea5e9'),
      ],
    },
    { id: 'troll', name: 'Troll', color: '#6366f1', sounds: [s('Notification', '🔔', '#6366f1')] },
    { id: 'music', name: 'Musiques', color: '#3b82f6', sounds: [s('Intro', '🎵', '#3b82f6')] },
    { id: 'fx', name: 'Effets sonores', color: '#0ea5e9', sounds: [s('Whoosh', '💨', '#0ea5e9')] },
  ],
  settings: { master: 0.8, monitorGain: 1, micGain: 1, micEnabled: true, overlap: true, hotkeysEnabled: true, tileSize: 'md', monitor: null, cable: 'CABLE Input (VB-Audio Virtual Cable)', mic: null, setupDone: view !== 'setup' },
}

const callbacks = new Map<number, (e: unknown) => void>()
const listeners = new Map<string, number[]>()
let next = 1
const emit = (event: string, payload: unknown) => (listeners.get(event) ?? []).forEach((h) => callbacks.get(h)?.({ event, id: 0, payload }))

const outputs = ['Casque (USB Audio)', 'Haut-parleurs (Realtek(R) Audio)', 'CABLE Input (VB-Audio Virtual Cable)']
const inputs = ['Microphone (USB Audio)', 'CABLE Output (VB-Audio Virtual Cable)']
const handlers: Record<string, (a: any) => unknown> = {
  library_dir: () => 'C:\\demo',
  load_library: () => JSON.stringify(library),
  missing_files: () => [],
  list_devices: () => ({ outputs, inputs, default_output: outputs[0], default_input: inputs[0] }),
  configure_audio: () => ({ monitor: outputs[0], cable: outputs[2], mic: inputs[0], errors: [] }),
  test_route: () => ({ ok: true, peak: 0.57, message: "Signal reçu dans le câble : ce que vous jouez arrive bien à l'entrée que Discord utilise." }),
  'plugin:event|listen': (a) => {
    listeners.set(a.event, [...(listeners.get(a.event) ?? []), a.handler])
    return a.handler
  },
}

;(window as any).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  transformCallback: (cb: (e: unknown) => void) => (callbacks.set(next, cb), next++),
  unregisterCallback: (id: number) => callbacks.delete(id),
  convertFileSrc: (p: string) => p,
  invoke: async (cmd: string, args: unknown) => handlers[cmd]?.(args) ?? null,
}

const click = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))?.click()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

import('./main').then(async () => {
  await wait(500)
  if (view === 'main') {
    // run the (fake) transmission test so the title bar shows the verified state
    click('Discord :')
    await wait(300)
    click('Test')
    await wait(300)
    click('Lancer le test')
    await wait(300)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  }
  if (view === 'editor') document.querySelector('[aria-label="Jouer Vine boom"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  let t = 0
  setInterval(() => {
    t += 0.05
    emit('playback', [
      { id: 'Airhorn', pos: 1.2 + t, dur: 3.4, paused: false },
      { id: 'Drum roll', pos: 0.8 + t, dur: 2.5, paused: false },
      { id: 'Victoire', pos: 7.4 + t, dur: 12.0, paused: false },
    ])
  }, 50)
})
