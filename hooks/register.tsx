// Merge panel: open pull requests across your GitHub account and organizations, CI status, one-press merge.
// Everything goes through your own signed-in `gh`; the mod never sees, stores or sends a token.
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Activity, Pr } from '../types'
import { isLang, LANGS, tr } from './i18n'

const PANE = 'merge-panel'
const REFRESH_MS = 60_000
const MAX_PRS = 30

// Everything that came from GitHub is checked before it reaches a command line or a link:
// argv has no shell, but a repo name or number is still never passed unless it has the expected form.
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
const URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/\d{1,9}$/

const PRS = { plugin: 'merge-panel', key: 'prs' } as const
const ACT = { plugin: 'merge-panel', key: 'activity' } as const
const IDLE: Activity = { merging: null, note: '', syncedAt: 0, owners: [], lang: 'en' }
const LANG_KEY = 'lang'

async function getPrs($: Engine): Promise<Pr[]> {
  return (await $.state.get(PRS)).value ?? []
}

async function getAct($: Engine): Promise<Activity> {
  return (await $.state.get(ACT)).value ?? IDLE
}

async function setAct($: Engine, change: Partial<Activity>) {
  await $.state.set(ACT, { ...(await getAct($)), ...change })
}

type Check = { status?: string; conclusion?: string; state?: string }

function ciOf(checks: Check[]): Pr['ci'] {
  if (!checks.length) return 'none'
  const bad = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR', 'STARTUP_FAILURE']
  if (checks.some(c => bad.includes(c.conclusion ?? '') || bad.includes(c.state ?? ''))) return 'failing'
  if (checks.some(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED'))
    return 'pending'
  return 'passing'
}

const idOf = (pr: Pr) => `${pr.repo}#${pr.number}`
const ready = (pr: Pr) => !pr.isDraft && pr.canMerge && pr.ci !== 'failing' && pr.ci !== 'pending'

function gh($: Engine, args: string[], timeoutMs = 60_000) {
  return $.process.run(['gh', ...args], { timeoutMs })
}

function parse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}

// Whose pull requests to show: the signed-in account and its organizations, as gh reports them
async function owners($: Engine): Promise<string[]> {
  const me = await gh($, ['api', 'user', '--jq', '.login'])
  if (me.exitCode !== 0) return []
  const orgs = await gh($, ['api', 'user/orgs', '--jq', '.[].login'])
  const names = [me.stdout, orgs.exitCode === 0 ? orgs.stdout : '']
    .join('\n').split('\n').map(s => s.trim()).filter(s => LOGIN_RE.test(s))
  return [...new Set(names)].slice(0, 10)
}

async function refresh($: Engine) {
  const who = await owners($)
  if (!who.length) {
    await setAct($, { note: tr((await getAct($)).lang, 'ghError') })
    return
  }
  type Found = { repository: { nameWithOwner: string }; number: number; title: string; url: string; isDraft: boolean }
  const found: Found[] = []
  for (const owner of who) {
    const res = await gh($, ['search', 'prs', '--owner', owner, '--state', 'open', '--limit', String(MAX_PRS),
      '--json', 'repository,number,title,url,isDraft'])
    if (res.exitCode === 0) found.push(...parse<Found[]>(res.stdout || '[]', []))
  }
  const out: Pr[] = []
  for (const it of found.slice(0, MAX_PRS)) {
    const repo = it?.repository?.nameWithOwner ?? ''
    const number = Number(it?.number)
    const url = String(it?.url ?? '')
    if (!REPO_RE.test(repo) || !Number.isInteger(number) || number < 1 || !URL_RE.test(url)) continue
    const view = await gh($, ['pr', 'view', String(number), '-R', repo, '--json', 'mergeable,statusCheckRollup'])
    const info = parse<{ mergeable?: string; statusCheckRollup?: Check[] }>(view.exitCode === 0 ? view.stdout : '', {})
    out.push({
      repo, number, url, isDraft: Boolean(it.isDraft),
      title: String(it.title ?? '').slice(0, 200),
      ci: ciOf(Array.isArray(info.statusCheckRollup) ? info.statusCheckRollup : []),
      canMerge: info.mergeable === 'MERGEABLE',
    })
  }
  const now = await $.clock.now()
  await $.state.set(PRS, out)
  const cur = await getAct($)
  await setAct($, { syncedAt: now, owners: who, note: cur.merging ? cur.note : '' })
}

async function merge($: Engine, pr: Pr) {
  const id = idOf(pr)
  if ((await getAct($)).merging) return // one merge at a time: a second press does nothing
  // Merge only what the last refresh listed as ready, re-checked against the same patterns
  const listed = (await getPrs($)).find(p => idOf(p) === id)
  if (!listed || !ready(listed) || !REPO_RE.test(listed.repo) || !Number.isInteger(listed.number)) return
  const lang = (await getAct($)).lang
  await setAct($, { merging: id, note: `${tr(lang, 'merging')} ${id}` })
  const res = await gh($, ['pr', 'merge', String(listed.number), '-R', listed.repo, '--squash', '--delete-branch'], 180_000)
  const reason = (res.stderr || res.stdout).trim().split('\n').pop()?.slice(0, 160) || 'gh error'
  const note = res.exitCode === 0 ? tr(lang, 'merged', { id }) : tr(lang, 'notMerged', { r: reason })
  await setAct($, { merging: null, note })
  $.ui.toast(note)
  await refresh($)
}

function ciLine(pr: Pr, lang: string): { text: string; color: string } {
  if (pr.isDraft) return { text: tr(lang, 'draft'), color: 'subtle' }
  if (!pr.canMerge) return { text: tr(lang, 'conflict'), color: 'error' }
  if (pr.ci === 'failing') return { text: tr(lang, 'failed'), color: 'error' }
  if (pr.ci === 'pending') return { text: tr(lang, 'running'), color: 'warning' }
  if (pr.ci === 'passing') return { text: tr(lang, 'passed'), color: 'success' }
  return { text: tr(lang, 'noChecks'), color: 'subtle' }
}

// The little companion: a square orange critter with stubby legs and claws.
// idle - bobs and blinks, busy - legs scuttle, sleepy - eyes shut and a "z" floats up
type Mood = 'idle' | 'busy' | 'sleepy'
const BODY = '#D97757'
const INK = '#2B1A12'

export function critterSvg(mood: Mood) {
  const bob = mood === 'sleepy' ? '' :
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="${mood === 'busy' ? '0.35s' : '1.8s'}" repeatCount="indefinite"/>`
  const legs = [14, 23, 41, 50].map((x, i) => {
    const wiggle = mood === 'busy'
      ? `<animateTransform attributeName="transform" type="rotate" values="-12 ${x + 1.5} 48;12 ${x + 1.5} 48;-12 ${x + 1.5} 48" dur="0.3s" begin="${i * 0.07}s" repeatCount="indefinite"/>`
      : ''
    return `<rect x="${x}" y="47" width="3.5" height="9" rx="1.75" fill="${BODY}">${wiggle}</rect>`
  }).join('')
  const claws = `<rect x="2" y="27" width="9" height="7" rx="3" fill="${BODY}"/><rect x="53" y="27" width="9" height="7" rx="3" fill="${BODY}"/>`
  const eyes = mood === 'sleepy'
    ? `<path d="M22 33 h7 M35 33 h7" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`
    : `<g fill="${INK}"><rect x="22.5" y="28" width="5" height="8" rx="1.5"/><rect x="36.5" y="28" width="5" height="8" rx="1.5"/>${
      mood === 'idle'
        ? '<animate attributeName="opacity" values="1;1;0;1" keyTimes="0;0.92;0.96;1" dur="4s" repeatCount="indefinite"/>'
        : ''}</g>`
  const zzz = mood === 'sleepy'
    ? `<text x="48" y="14" font-family="sans-serif" font-size="10" font-weight="700" fill="${BODY}">z<animate attributeName="y" values="16;6;16" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="2.6s" repeatCount="indefinite"/></text>`
    : ''
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
    `<g>${claws}${legs}<rect x="10" y="14" width="44" height="36" rx="8" fill="${BODY}"/>${eyes}${bob}</g>${zzz}</svg>`
}

function clockText(ms: number, lang: string) {
  if (!ms) return tr(lang, 'notSynced')
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return tr(lang, 'synced', { t: `${two(d.getHours())}:${two(d.getMinutes())}` })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'merges', description: 'Open the Merges pane: your open pull requests, merged with one press' })
    // The chosen language survives restarts; anything unknown in the store falls back to English
    const saved = await $.store.get(LANG_KEY)
    await setAct($, { lang: isLang(saved) ? saved : 'en' })
    void $.ui.open({ id: PANE, title: tr((await getAct($)).lang, 'title') })
    void refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'merges' }, async $ => {
    await $.ui.open({ id: PANE, title: tr((await getAct($)).lang, 'title') })
    void refresh($)
    return { text: 'Merges pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Link } = ui
    const list = await getPrs($)
    const act = await getAct($)
    const lang = act.lang
    const readyCount = list.filter(ready).length
    const waiting = list.filter(pr => pr.ci === 'pending').length
    const other = list.length - readyCount - waiting
    const mood: Mood = act.merging ? 'busy' : readyCount ? 'idle' : 'sleepy'
    const summary = list.length === 0 ? tr(lang, 'nothing')
      : [readyCount && tr(lang, 'ready', { n: readyCount }), waiting && tr(lang, 'waiting', { n: waiting }),
        other > 0 && tr(lang, 'attention', { n: other })]
        .filter(Boolean).join(' · ')
    // Svg exists on the desktop, mobile and editor surfaces; the terminal gets a glyph instead
    const mascot = 'Svg' in ui
      ? <ui.Svg source={critterSvg(mood)} alt={mood === 'busy' ? tr(lang, 'merging') : mood === 'idle' ? tr(lang, 'merge') : tr(lang, 'nothing')}
        width={44} height={44} isInteractive />
      : <Text color="claude" bold>✻</Text>
    return (
      <Box flexDirection="column" gap="md" padding="sm">
        <Box flexDirection="row" alignItems="center" justifyContent="space-between">
          <Box flexDirection="row" alignItems="center" gap="sm">
            {mascot}
            <Box flexDirection="column">
              <Text size="heading" weight="semibold" color="claude">{tr(lang, 'title')}</Text>
              <Text size="caption" color="subtle">{summary} · {clockText(act.syncedAt, lang)}</Text>
            </Box>
          </Box>
          <Button dimColor onPress={() => void refresh($)}>{tr(lang, 'refresh')}</Button>
        </Box>
        {/* Select is drawn on the desktop, terminal and editor; mobile keeps the saved language */}
        {'Select' in ui ? (
          <ui.Select key="lang" label={tr(lang, 'language')} options={LANGS} value={lang}
            onSelect={async code => {
              if (!isLang(code)) return
              await setAct($, { lang: code })
              await $.store.set(LANG_KEY, code)
            }} />
        ) : null}
        {act.note ? <Text size="footnote" color={act.merging ? 'warning' : 'text'} wrap="wrap">{act.note}</Text> : null}
        {list.length === 0 ? <Text color="subtle" wrap="wrap">{tr(lang, 'empty')}</Text> : null}
        {list.map(pr => {
          const id = idOf(pr)
          const ci = ciLine(pr, lang)
          return (
            <Box key={id} flexDirection="column" gap="xs" padding="sm" borderStyle="round"
              borderColor={ready(pr) ? 'claude' : 'promptBorder'}>
              <Text size="caption" color="subtle">{pr.repo} · #{pr.number}</Text>
              <Text weight="semibold" wrap="wrap">{pr.title}</Text>
              <Text size="footnote" color={ci.color}>{ci.text}</Text>
              <Box flexDirection="row" gap="sm" alignItems="center">
                {act.merging === id ? (
                  <Text color="warning">{tr(lang, 'merging')}</Text>
                ) : ready(pr) ? (
                  <Button variant="primary" onPress={() => void merge($, pr)}>{tr(lang, 'merge')}</Button>
                ) : null}
                <Link href={pr.url} label={tr(lang, 'open')} />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
