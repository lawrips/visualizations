// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lawrips
//
// Run from build/: npm test   (build first, so the saved-copy test can use ghost-race.html)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRaces, champions, embedRuns, parseRunsText, validateRuns } from '../src/runs.js'
import { sampleRunner } from '../src/sample.js'

const run = (date, distance_m, time_s, extra = {}) => ({ date, distance_m, time_s, ...extra })

test('rejects malformed files with readable errors', () => {
  assert.match(parseRunsText('{oops').errors[0], /isn't valid JSON/)
  assert.match(validateRuns({ runs: [] }).errors[0], /empty/)
  const { errors } = validateRuns({ runs: [run('2024-13-01', -5, 100), run('2024-01-01', 5000, 1500, { hr: 999 }), run('2024-02-31', 5000, 1500)] })
  assert.equal(errors.length, 3)
  assert.match(errors[0], /^Run 1: "date".*"distance_m"/)
  assert.match(errors[1], /^Run 2: "hr"/)
  assert.match(errors[2], /^Run 3: "date"/)
})

test('races collect runs within 12% and normalise them at average pace', () => {
  const { data } = validateRuns({ runs: [
    run('2024-01-01', 5400, 1620), // 5.4 km at 300 s/km -> 5K in 1500 s
    run('2024-02-01', 4600, 1380), // 4.6 km at 300 s/km -> 5K in 1500 s
    run('2024-03-01', 5000, 1450),
    run('2024-04-01', 6000, 1800), // outside every band
  ] })
  const races = buildRaces(data.runs)
  assert.deepEqual(races.map(r => r.key), ['5k'])
  assert.deepEqual(races[0].ghosts.map(g => Math.round(g.finish)), [1500, 1500, 1450])
})

test('filters drop indoor and slow runs, and races need three runs', () => {
  const { data } = validateRuns({ runs: [
    run('2024-01-01', 5000, 1500), run('2024-02-01', 5000, 1500), run('2024-03-01', 5000, 1500, { indoor: true }),
    run('2024-04-01', 5000, 3000), // 9:39/km = 15:32/mi
  ] })
  assert.equal(buildRaces(data.runs)[0].ghosts.length, 3)
  assert.equal(buildRaces(data.runs, { includeIndoor: true })[0].ghosts.length, 4)
  assert.equal(buildRaces(data.runs, { maxPaceSecPerMile: 900 }).length, 0)
})

test('yearly champions keep the fastest run per year', () => {
  const { data } = validateRuns({ runs: [run('2023-01-01', 5000, 1600), run('2023-06-01', 5000, 1500), run('2024-01-01', 5000, 1550)] })
  assert.deepEqual(champions(buildRaces(data.runs)[0].ghosts).map(g => g.iso), ['2023-06-01', '2024-01-01'])
})

test('sample runners are valid, and scale with level and history', () => {
  const today = new Date('2026-10-22T12:00:00Z')
  const best5k = level => {
    const { data } = validateRuns(sampleRunner({ level, years: 3, seed: 7, today }))
    return Math.min(...buildRaces(data.runs).find(r => r.key === '5k').ghosts.map(g => g.finish))
  }
  assert.ok(best5k('fast') < best5k('regular') && best5k('regular') < best5k('beginner'))

  const one = sampleRunner({ level: 'regular', years: 1, seed: 7, today })
  const seven = sampleRunner({ level: 'regular', years: 7, seed: 7, today })
  assert.ok(seven.runs.length > 5 * one.runs.length)
  assert.equal(seven.runs.at(-1).date <= '2026-10-22', true)
  assert.ok(seven.runs[0].date < '2020-01-01')
  assert.match(seven.title, /^Sample runner · Regular · 7 years$/)
  const { data } = validateRuns(seven)
  assert.deepEqual(buildRaces(data.runs).map(r => r.key), ['mile', '5k', '10k', 'half', 'marathon'])
})

test('a saved copy embeds the runs in the page element only, safely escaped', () => {
  const page = readFileSync(new URL('../ghost-race.html', import.meta.url), 'utf8')
  const data = { title: 'Tricky </script> title', runs: [run('2024-01-01', 5000, 1500)] }
  const saved = embedRuns(page, data)
  const json = saved.match(/<script type="application\/json" id="embedded-runs">([\s\S]*?)<\/script>/)[1]
  assert.deepEqual(JSON.parse(json), data)
  assert.ok(!json.includes('</'))
  assert.equal(saved.length - page.length, json.length - 'null'.length)
})
