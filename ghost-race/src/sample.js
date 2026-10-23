// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lawrips
//
// Sample runners: fictional run histories generated from a few settings. Not anyone's real runs.
//
// sampleRunner({ level, years, seed }) builds a believable history ending today: easy and hard
// days, seasonal swings, steady improvement, a setback and comeback on longer histories, and a
// mix of short runs, 5Ks, 10Ks and occasional long races.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const LEVELS = {
  beginner: { label: 'Beginner', fiveK: 35 * 60, runsPerYear: 80, hr: 158, long: 0.4 },
  regular: { label: 'Regular', fiveK: 27 * 60, runsPerYear: 130, hr: 152, long: 1 },
  fast: { label: 'Fast', fiveK: 20 * 60, runsPerYear: 190, hr: 148, long: 1.3 },
}
export const HISTORIES = [1, 3, 7]

// Kinds of run: distance range in metres, pace offset from the runner's 5K pace (s/km), share.
const KINDS = [
  { min: 1450, max: 1790, offset: -18, share: 0.13 },  // short and quick: the Mile race
  { min: 4500, max: 5500, offset: 0, share: 0.33 },    // 5K-ish
  { min: 5800, max: 8500, offset: 14, share: 0.17 },   // in-between, races nothing
  { min: 9000, max: 11000, offset: 18, share: 0.2 },   // 10K-ish
  { min: 12500, max: 17000, offset: 30, share: 0.08, long: true }, // long, races nothing
  { min: 19500, max: 22500, offset: 32, share: 0.07, long: true }, // half-ish
  { min: 41500, max: 42800, offset: 48, share: 0.02, long: true }, // marathon
]

// How much slower the runner was at the start of the history, by number of years.
const IMPROVEMENT = { 1: 0.05, 3: 0.12, 7: 0.2 }

export function sampleRunner({ level = 'regular', years = 3, seed = 1, today = new Date() } = {}) {
  const L = LEVELS[level] || LEVELS.regular
  const Y = HISTORIES.includes(years) ? years : 3
  const r = mulberry32(seed)
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const start = end - Y * 365.25 * 86400e3
  const endPace = L.fiveK / 5 // s/km at the end of the history
  const startPace = endPace * (1 + IMPROVEMENT[Y])
  const shares = KINDS.map(k => (k.long ? k.share * L.long : k.share))
  const total = shares.reduce((a, b) => a + b, 0)
  const count = Math.round(L.runsPerYear * Y * (0.9 + r() * 0.2))

  const runs = []
  for (let i = 0; i < count; i++) {
    const f = (i + r() * 0.8) / count // progress through the history, 0..1
    const ms = start + (end - start) * f
    let pick = r() * total, kind = KINDS[0]
    for (let k = 0; k < KINDS.length; k++) { if ((pick -= shares[k]) <= 0) { kind = KINDS[k]; break } }
    // Fitness: improvement that slows over time, a dip in the middle of longer histories, seasons.
    const setback = Y >= 3 ? 0.05 * Math.exp(-(((f - 0.55) / 0.08) ** 2)) : 0
    const base = startPace + (endPace - startPace) * Math.sqrt(f)
    const season = 0.015 * Math.sin((ms / (365.25 * 86400e3)) * Math.PI * 2)
    const effort = r() < 0.22 ? -0.04 : r() < 0.55 ? 0.02 : 0.09 // hard days, steady days, easy days
    const pace = base * (1 + setback + season + effort + (r() - 0.5) * 0.04) + kind.offset * (endPace / 324)
    const distance = Math.round(kind.min + r() * (kind.max - kind.min))
    const indoor = r() < 0.07
    runs.push({
      date: new Date(ms).toISOString().slice(0, 10),
      distance_m: distance,
      time_s: Math.round((pace * distance) / 1000),
      hr: Math.round(L.hr - effort * 120 + (r() - 0.5) * 10),
      climb_m: indoor ? 0 : Math.round(r() * r() * distance * 0.02),
      indoor,
    })
  }
  return { title: `Sample runner · ${L.label} · ${Y} ${Y === 1 ? 'year' : 'years'}`, runs }
}
