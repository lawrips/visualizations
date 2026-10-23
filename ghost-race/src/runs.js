// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lawrips
//
// Runs file validation and race building.
//
// Input: { "title"?: string, "runs": [ { date, distance_m, time_s, hr?, climb_m?, indoor? } ] }
// Each race distance collects the runs within ±TOLERANCE of it. A run races that exact distance
// at its own average pace, so its ghost moves at a steady pace and finishes in
// time_s * race_distance / distance_m.

export const RACE_DISTANCES = [
  { key: 'mile', label: 'Mile', meters: 1609.344 },
  { key: '5k', label: '5K', meters: 5000 },
  { key: '10k', label: '10K', meters: 10000 },
  { key: 'half', label: 'Half marathon', meters: 21097.5 },
  { key: 'marathon', label: 'Marathon', meters: 42195 },
]
export const TOLERANCE = 0.12
export const MIN_RUNS = 3
export const MAX_RUNS = 50000

const MAX_ERRORS = 12

export function parseRunsText(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { errors: [`This isn't valid JSON: ${e.message}`] }
  }
  return validateRuns(data)
}

// Returns { data: { title, runs } } or { errors: [...] }. Unknown fields are ignored.
export function validateRuns(data) {
  const errors = []
  const add = msg => { if (errors.length < MAX_ERRORS) errors.push(msg); else errors.extra = (errors.extra || 0) + 1 }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { errors: ['The file must contain one JSON object with a "runs" list.'] }
  if (data.title !== undefined && typeof data.title !== 'string') add('"title" must be text.')
  if (!Array.isArray(data.runs)) return { errors: ['The file needs a "runs" list.'] }
  if (data.runs.length === 0) return { errors: ['"runs" is empty.'] }
  if (data.runs.length > MAX_RUNS) return { errors: [`Too many runs (${data.runs.length}); the limit is ${MAX_RUNS}.`] }

  const runs = []
  data.runs.forEach((r, i) => {
    const at = `Run ${i + 1}`
    if (!r || typeof r !== 'object') return add(`${at} isn't an object.`)
    const ok = []
    if (!isDate(r.date)) ok.push('"date" must look like 2024-05-31')
    if (!isNum(r.distance_m) || r.distance_m <= 0 || r.distance_m > 500000) ok.push('"distance_m" must be metres, above 0')
    if (!isNum(r.time_s) || r.time_s <= 0 || r.time_s > 7 * 86400) ok.push('"time_s" must be seconds, above 0')
    if (r.hr != null && (!isNum(r.hr) || r.hr < 30 || r.hr > 250)) ok.push('"hr" must be beats per minute (30–250) or left out')
    if (r.climb_m != null && (!isNum(r.climb_m) || r.climb_m < 0 || r.climb_m > 20000)) ok.push('"climb_m" must be metres (0 or more) or left out')
    if (r.indoor != null && typeof r.indoor !== 'boolean') ok.push('"indoor" must be true or false or left out')
    if (ok.length) return add(`${at}: ${ok.join('; ')}.`)
    runs.push({
      date: r.date, distance_m: r.distance_m, time_s: r.time_s,
      hr: r.hr ?? null, climb_m: r.climb_m ?? null, indoor: r.indoor === true,
    })
  })
  if (errors.length) {
    if (errors.extra) errors.push(`…and ${errors.extra} more.`)
    return { errors }
  }
  runs.sort((a, b) => a.date.localeCompare(b.date))
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 60) : ''
  return { data: { title, runs } }
}

const isNum = v => typeof v === 'number' && Number.isFinite(v)
// A real calendar date: 2024-02-31 would otherwise roll over to 2 March.
const isDate = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

const yearFraction = iso => {
  const [y, m, d] = iso.split('-').map(Number)
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1)
  return y + (Date.UTC(y, m - 1, d) - start) / (end - start)
}

// Races with at least MIN_RUNS ghosts after filters, in RACE_DISTANCES order.
// filters: { includeIndoor: boolean, maxPaceSecPerMile: number | null }
export function buildRaces(runs, { includeIndoor = false, maxPaceSecPerMile = null } = {}) {
  let id = 0
  const races = []
  for (const race of RACE_DISTANCES) {
    const lo = race.meters * (1 - TOLERANCE), hi = race.meters * (1 + TOLERANCE)
    const ghosts = []
    for (const r of runs) {
      if (r.distance_m < lo || r.distance_m > hi) continue
      if (r.indoor && !includeIndoor) continue
      const secPerMile = (r.time_s / r.distance_m) * 1609.344
      if (maxPaceSecPerMile && secPerMile > maxPaceSecPerMile) continue
      ghosts.push({
        id: id++, iso: r.date, date: yearFraction(r.date),
        hr: r.hr, climb: r.climb_m, indoor: r.indoor,
        distM: r.distance_m, timeS: r.time_s,
        finish: (r.time_s * race.meters) / r.distance_m,
      })
    }
    if (ghosts.length >= MIN_RUNS) races.push({ ...race, km: race.meters / 1000, ghosts })
  }
  return races
}

// A copy of the page with the runs embedded in its <script id="embedded-runs"> element. The page's
// own element comes before any script text, so the first match is always the real one.
export function embedRuns(html, data) {
  const json = JSON.stringify({ title: data.title, runs: data.runs }).replace(/</g, '\\u003c')
  const pattern = /(<script type="application\/json" id="embedded-runs">)[\s\S]*?(<\/script>)/
  if (!pattern.test(html)) throw new Error('page has no embedded-runs element')
  return html.replace(pattern, (_, open, close) => `${open}${json}${close}`)
}

// Yearly champions: the fastest ghost of each calendar year, in date order.
export function champions(ghosts) {
  const best = new Map()
  for (const g of ghosts) {
    const y = g.iso.slice(0, 4)
    if (!best.has(y) || g.finish < best.get(y).finish) best.set(y, g)
  }
  return [...best.values()].sort((a, b) => a.date - b.date)
}
