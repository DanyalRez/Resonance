import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Cable, Check, CircleCheck, ExternalLink, Headphones, LoaderCircle, Mic, RefreshCw, Send, TriangleAlert, X } from 'lucide-react'
import { Modal, Slider, Toggle } from './ui'
import { api, type AudioStatus, type Devices, type Settings, type TestResult } from '../lib'

type Props = {
  settings: Settings
  set: (s: Partial<Settings>) => void
  status: AudioStatus | null
  test: TestResult | null
  testing: boolean
  onTest: () => void
  onClose: () => void
}

const STEPS = ['Câble virtuel', 'Périphériques', 'Réglages Discord', 'Test']
const isCableIn = (n: string) => /cable.*input|voicemeeter.*input/i.test(n)
const isCableOut = (n: string) => /cable.*output|voicemeeter.*output/i.test(n)

export function AudioSetup(p: Props) {
  const [step, setStep] = useState(0)
  const [dev, setDev] = useState<Devices | null>(null)
  const [scanning, setScanning] = useState(false)
  const s = p.settings

  const refresh = async () => {
    setScanning(true)
    setDev(await api.devices().catch(() => null))
    setScanning(false)
  }
  useEffect(() => {
    refresh()
  }, [])

  const cableFound = dev?.outputs.find(isCableIn) ?? null
  // pick the cable automatically the first time it shows up
  useEffect(() => {
    if (dev && !s.cable && cableFound) p.set({ cable: cableFound })
  }, [dev])

  const recording = (s.cable ?? cableFound ?? 'CABLE Input (VB-Audio Virtual Cable)').replace('Input', 'Output')
  const defaultIsCable = !!dev?.default_output && isCableIn(dev.default_output)

  return (
    <Modal onClose={p.onClose} className="max-w-[860px]">
      <div className="flex min-h-[520px]">
        <aside className="w-56 shrink-0 border-r border-white/6 p-5">
          <h2 className="text-[15px] font-semibold tracking-tight">Audio & Discord</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">À faire une seule fois.</p>
          <ol className="mt-6 space-y-1">
            {STEPS.map((label, i) => (
              <li key={label}>
                <button onClick={() => setStep(i)} className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition ${step === i ? 'text-white' : 'text-white/50 hover:text-white/80'}`}>
                  {step === i && <motion.span layoutId="setup-step" className="absolute inset-0 rounded-xl bg-white/7" />}
                  <span className={`relative grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${i < step ? 'accent-grad' : step === i ? 'bg-white text-black' : 'bg-white/10'}`}>
                    {i < step ? <Check size={11} /> : i + 1}
                  </span>
                  <span className="relative">{label}</span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col p-7">
          <button aria-label="Fermer" onClick={p.onClose} className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/8 hover:text-white">
            <X size={16} />
          </button>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }} className="flex-1 space-y-5 text-[13.5px] leading-relaxed text-white/70">
              {step === 0 && (
                <>
                  <Title>Installer le câble audio virtuel</Title>
                  <p>
                    Discord n'écoute qu'un seul micro. Resonance fabrique donc un <b className="text-white">micro virtuel</b> qui contient votre voix et vos sons mélangés. Pour cela, Windows a besoin d'un petit pilote gratuit : <b className="text-white">VB-CABLE</b>.
                  </p>
                  <Card tone={cableFound ? 'ok' : 'warn'}>
                    {cableFound ? (
                      <>
                        <CircleCheck size={18} className="shrink-0 text-emerald-400" /> Câble détecté : <b className="text-white">{cableFound}</b>
                      </>
                    ) : (
                      <>
                        <TriangleAlert size={18} className="shrink-0 text-amber-400" /> Aucun câble virtuel détecté sur ce PC.
                      </>
                    )}
                    <button onClick={refresh} className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1 text-[12px] hover:bg-white/14">
                      <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} /> Actualiser
                    </button>
                  </Card>
                  {!cableFound && (
                    <ol className="list-decimal space-y-1.5 pl-5 marker:text-white/35">
                      <li>
                        Téléchargez VB-CABLE (gratuit) :{' '}
                        <button onClick={() => openUrl('https://vb-audio.com/Cable/')} className="inline-flex items-center gap-1 font-medium text-violet-300 hover:underline">
                          vb-audio.com/Cable <ExternalLink size={12} />
                        </button>
                      </li>
                      <li>Extrayez le fichier .zip téléchargé.</li>
                      <li>
                        Clic droit sur <code className="rounded bg-white/8 px-1">VBCABLE_Setup_x64.exe</code> → <i>Exécuter en tant qu'administrateur</i> → <i>Install Driver</i>.
                      </li>
                      <li>Redémarrez le PC, puis revenez ici et cliquez sur « Actualiser ».</li>
                    </ol>
                  )}
                  <p className="text-[12.5px] text-white/45">Déjà Voicemeeter ? Il fonctionne aussi : choisissez « VoiceMeeter Input » à l'étape suivante.</p>
                </>
              )}

              {step === 1 && (
                <>
                  <Title>Choisir les périphériques</Title>
                  <Pick icon={<Mic size={16} />} label="Votre micro" hint="Mélangé aux sons et envoyé à Discord." value={s.mic} options={(dev?.inputs ?? []).filter((n) => !isCableOut(n))} def={dev?.default_input} onChange={(mic) => p.set({ mic })} ok={p.status?.mic} />
                  <Pick icon={<Headphones size={16} />} label="Vos écouteurs" hint="Pour entendre vous-même les sons." value={s.monitor} options={(dev?.outputs ?? []).filter((n) => !isCableIn(n))} def={dev?.default_output} onChange={(monitor) => p.set({ monitor })} ok={p.status?.monitor} />
                  <Pick icon={<Cable size={16} />} label="Sortie vers Discord" hint="Le câble virtuel (CABLE Input)." value={s.cable} options={dev?.outputs ?? []} none="Aucune (sons seulement dans mes écouteurs)" onChange={(cable) => p.set({ cable })} ok={p.status?.cable} />
                  {defaultIsCable && !s.monitor && (
                    <Card tone="warn">
                      <TriangleAlert size={16} className="shrink-0 text-amber-400" /> La sortie Windows par défaut est le câble : choisissez vos vrais écouteurs ci-dessus.
                    </Card>
                  )}
                  <div className="space-y-3 rounded-2xl bg-white/4 p-4">
                    <label className="flex items-center justify-between">
                      <span>Mixer mon micro avec les sons</span>
                      <Toggle on={s.micEnabled} onChange={(micEnabled) => p.set({ micEnabled })} label="Mixer le micro" />
                    </label>
                    <Level label="Volume du micro" value={s.micGain} max={3} onChange={(micGain) => p.set({ micGain })} disabled={!s.micEnabled} />
                    <Level label="Volume dans mes écouteurs" value={s.monitorGain} max={2} onChange={(monitorGain) => p.set({ monitorGain })} />
                  </div>
                  {!!p.status?.errors.length && (
                    <Card tone="warn">
                      <div className="space-y-1">
                        {p.status.errors.map((e) => (
                          <div key={e} className="flex gap-2">
                            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />
                            {e}
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <Title>Régler Discord</Title>
                  <p>
                    Dans Discord : <b className="text-white">Paramètres utilisateur ⚙ → Voix et vidéo</b>.
                  </p>
                  <ol className="space-y-2.5">
                    <Do n={1}>
                      <b className="text-white">Périphérique d'entrée</b> : <Chip>{recording}</Chip>
                    </Do>
                    <Do n={2}>
                      <b className="text-white">Périphérique de sortie</b> : vos écouteurs. Jamais « CABLE Input », sinon vos amis s'entendraient en écho.
                    </Do>
                    <Do n={3}>
                      <b className="text-white">Mode de saisie</b> : <i>Détection de la voix</i>. En <i>Appuyer pour parler</i>, les sons ne passent que touche enfoncée.
                    </Do>
                    <Do n={4}>
                      <b className="text-white">Suppression du bruit</b> : <i>Aucune</i>. Krisp prend la musique et les effets pour du bruit et les coupe.
                    </Do>
                    <Do n={5}>
                      <b className="text-white">Annulation de l'écho</b> : désactivée si vous portez un casque (elle étouffe les sons).
                    </Do>
                  </ol>
                  <p className="text-[12.5px] text-white/45">Utilisez un casque plutôt que des haut-parleurs : votre vrai micro ne captera pas les sons, donc pas d'écho.</p>
                </>
              )}

              {step === 3 && (
                <>
                  <Title>Tester la transmission</Title>
                  <p>Resonance envoie un bip dans le câble et écoute l'autre bout, celui que Discord utilise comme micro. Si le bip arrive, la route fonctionne vraiment.</p>
                  <motion.button whileTap={{ scale: 0.96 }} onClick={p.onTest} disabled={p.testing} className="accent-grad flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-semibold text-white disabled:opacity-60">
                    {p.testing ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
                    {p.testing ? 'Test en cours…' : 'Lancer le test'}
                  </motion.button>
                  {p.test && (
                    <Card tone={p.test.ok ? 'ok' : 'warn'}>
                      {p.test.ok ? <CircleCheck size={18} className="shrink-0 text-emerald-400" /> : <TriangleAlert size={18} className="shrink-0 text-amber-400" />}
                      <span>
                        <b className="text-white">{p.test.ok ? 'Transmission vérifiée.' : 'Échec du test.'}</b> {p.test.message}
                      </span>
                    </Card>
                  )}
                  <p className="text-[12.5px] text-white/45">
                    Ce test ne peut pas lire les réglages de Discord. Pour une dernière vérification : dans Voix et vidéo, bouton <i>Vérifions</i>, puis jouez un son. La jauge doit bouger.
                  </p>
                </>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 flex items-center justify-between">
            <button onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0} className="rounded-xl px-4 py-2 text-[13px] text-white/55 hover:bg-white/6 hover:text-white disabled:invisible">
              Retour
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(step + 1)} className="rounded-xl bg-white px-5 py-2 text-[13px] font-semibold text-black hover:bg-white/90">
                Continuer
              </button>
            ) : (
              <button onClick={() => (p.set({ setupDone: true }), p.onClose())} className="rounded-xl bg-white px-5 py-2 text-[13px] font-semibold text-black hover:bg-white/90">
                Terminer
              </button>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}

const Title = ({ children }: { children: ReactNode }) => <h3 className="text-[20px] font-semibold tracking-tight text-white">{children}</h3>
const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-200">{children}</span>

function Card({ tone, children }: { tone: 'ok' | 'warn'; children: ReactNode }) {
  return <div className={`flex items-center gap-3 rounded-2xl p-3.5 text-[13px] ring-1 ${tone === 'ok' ? 'bg-emerald-400/8 ring-emerald-400/20' : 'bg-amber-400/8 ring-amber-400/20'}`}>{children}</div>
}

function Do({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white">{n}</span>
      <span>{children}</span>
    </li>
  )
}

function Pick({ icon, label, hint, value, options, def, none, onChange, ok }: {
  icon: ReactNode
  label: string
  hint: string
  value: string | null
  options: string[]
  def?: string | null
  none?: string
  onChange: (v: string | null) => void
  ok?: string | null
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/6 text-white/70">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium text-white">
          {label}
          {ok && <CircleCheck size={14} className="text-emerald-400" aria-label="Actif" />}
        </div>
        <div className="text-[12px] text-white/40">{hint}</div>
      </div>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label} className="w-64 truncate rounded-lg bg-white/6 px-3 py-2 text-[12.5px] text-white ring-1 ring-white/8 focus:ring-violet-500/60 focus:outline-none">
        <option value="">{none ?? `Par défaut${def ? ` (${def})` : ''}`}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

function Level({ label, value, max, onChange, disabled }: { label: string; value: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-4 ${disabled ? 'opacity-40' : ''}`}>
      <span className="w-48 shrink-0">{label}</span>
      <Slider label={label} value={value} max={max} onChange={onChange} className="flex-1" />
      <span className="w-10 text-right text-[12px] text-white/45 tabular-nums">{Math.round(value * 100)}%</span>
    </label>
  )
}
