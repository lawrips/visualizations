// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lawrips
//
// Ghost Race: every run in a distance band races that distance at its own average pace.
// Runs come from a generated fictional sample runner, a runs file the viewer loads, or data embedded in
// a saved copy of this page. Everything happens in the browser; nothing is sent anywhere.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { buildRaces, champions, embedRuns, parseRunsText, validateRuns } from './runs.js'
import { sampleRunner } from './sample.js'
import { createMusicPlayer, makeTrack } from './music.js'

// The page exactly as delivered, before any script changes it. "Save as HTML" writes a copy of
// this with the loaded runs embedded. This script must be the last element in <body>.
const PRISTINE = `<!doctype html>\n${document.documentElement.outerHTML}`

const $ = id => document.getElementById(id)
const MI = 1.609344
const SPEEDS = [10, 30, 60, 120, 300]
const L = 400 // road length in world units, whatever the distance
const ROAD_W = 36
const WALL_Z = -L - 90
const TRAIL = 6 // points per trail
const TRAIL_LEN = 4 // trail length in world units (the road is L long), the same in every race
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const fmtTime = s => {
  s = Math.max(0, Math.round(s))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
const fmtPace = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const perMile = secPerKm => fmtPace(secPerKm * MI)
const fmtDate = g => { const [y, m, d] = g.iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d} '${String(y).slice(2)}` }
const fmtLongDate = g => new Date(`${g.iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

// Gates: quarter miles for the mile, kilometres for 5K/10K, 5 km for longer races.
const GATES = {
  mile: { every: MI / 4, label: i => `${['', '¼', '½', '¾'][i]} MI` },
  '5k': { every: 1, label: i => `${i} KM` },
  '10k': { every: 1, label: i => `${i} KM` },
  half: { every: 5, label: i => `${i * 5} KM` },
  marathon: { every: 5, label: i => `${i * 5} KM` },
}

// ---------- renderer ----------

const canvas = $('gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setClearColor(0x02030a, 1)
const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x02030a, 0.0022)
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000)
camera.position.set(-150, 150, 80)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.enabled = false
controls.maxDistance = 900

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.0, 0.6, 0.05)
composer.addPass(bloom)
composer.addPass(new OutputPass())

// ---------- road ----------

scene.add(new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_W + 8, L + 260, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, -L / 2 - 40),
  new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uHalf: { value: ROAD_W / 2 }, uLen: { value: L } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying float vDepth;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHalf, uLen;
      varying vec3 vW; varying float vDepth;
      float grid(float c, float w) { float f = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1.0 - min(f / w, 1.0); }
      void main() {
        float inside = step(abs(vW.x), uHalf + 0.3);
        float lanes = grid((vW.x + uHalf) / 4.5, 0.8) * inside;
        float cross = grid(vW.z / 8.0, 0.6) * inside;
        float edge = 1.0 - smoothstep(0.0, 0.5, abs(abs(vW.x) - uHalf));
        float onRoad = step(-uLen, vW.z) * step(vW.z, 0.0);
        vec3 col = vec3(0.1, 0.55, 1.0) * lanes * (0.18 + 0.2 * onRoad)
                 + vec3(0.55, 0.25, 1.0) * cross * 0.07
                 + vec3(0.3, 0.9, 1.0) * edge * 0.9;
        gl_FragColor = vec4(col * exp(-vDepth * 0.0028), 1.0);
      }`,
  }),
))

// Floating dust for depth.
{
  const n = 2200, p = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { p[i * 3] = (hash(i) - 0.5) * 260; p[i * 3 + 1] = hash(i + 9e3) * 70 + 1; p[i * 3 + 2] = 80 - hash(i + 2e4) * (L + 300) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, color: 0x3a4a7a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })))
}

function makeLabel(text, { size = 64, color = '#bfe8ff', scale = 1, weight = 300 } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d')
  const font = `${weight} ${size}px ui-monospace, "SF Mono", Menlo, monospace`
  g.font = font
  c.width = Math.ceil(g.measureText(text).width + size * 0.6); c.height = Math.ceil(size * 1.4)
  g.font = font; g.fillStyle = color; g.textBaseline = 'middle'
  g.fillText(text, size * 0.3, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  s.scale.set((c.width / c.height) * 3.2 * scale, 3.2 * scale, 1)
  return s
}

const disposeAll = group => {
  for (const o of [...group.children]) { group.remove(o); o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose() }
}

const gates = new THREE.Group()
scene.add(gates)
function buildGates(race) {
  disposeAll(gates)
  const { every, label } = GATES[race.key]
  const arch = []
  for (let k = 0; k <= 48; k++) { const a = Math.PI * k / 48; arch.push(new THREE.Vector3(Math.cos(a) * (ROAD_W / 2 + 1.5), Math.sin(a) * 11, 0)) }
  const archGeo = new THREE.BufferGeometry().setFromPoints(arch)
  const addGate = (z, color, text, strong) => {
    const line = new THREE.Line(archGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: strong ? 1 : 0.45, blending: THREE.AdditiveBlending, depthWrite: false }))
    line.position.z = z
    gates.add(line)
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, strong ? 0.8 : 0.25).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: strong ? 0.9 : 0.35, blending: THREE.AdditiveBlending, depthWrite: false }))
    bar.position.set(0, 0.02, z)
    gates.add(bar)
    const s = makeLabel(text, { color: strong ? '#ffffff' : '#7fb8ff', scale: strong ? 1.3 : 0.8 })
    s.position.set(0, 13.5, z)
    gates.add(s)
  }
  addGate(0, 0x39e0ff, 'START', true)
  for (let i = 1; i * every < race.km; i++) {
    if (race.km - i * every < every * 0.3) continue
    addGate(-((i * every) / race.km) * L, 0x2a6cff, label(i), false)
  }
  addGate(-L, 0xff3fb0, 'FINISH', true)
}

// ---------- ghosts ----------

const gGeo = new THREE.BufferGeometry()
const tGeo = new THREE.BufferGeometry()
let capacity = 0, gPos, gCol, gSize, tPos, tCol
function ensureCapacity(n) {
  if (n <= capacity) return
  capacity = n
  gPos = new Float32Array(n * 3); gCol = new Float32Array(n * 3); gSize = new Float32Array(n)
  gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3))
  gGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3))
  gGeo.setAttribute('aSize', new THREE.BufferAttribute(gSize, 1))
  tPos = new Float32Array(n * (TRAIL - 1) * 6); tCol = new Float32Array(n * (TRAIL - 1) * 6)
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3))
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3))
}
ensureCapacity(64)

const ghostPoints = new THREE.Points(gGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uPx: { value: renderer.getPixelRatio() } },
  vertexShader: /* glsl */ `
    attribute float aSize; attribute vec3 color; uniform float uPx; varying vec3 vC;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = min(64.0, aSize * uPx * 260.0 / -mv.z);
      vC = color;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vC;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float core = smoothstep(0.18, 0.0, d), halo = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vC * (halo * halo * 0.9 + core * 1.6), 1.0);
    }`,
}))
ghostPoints.frustumCulled = false
scene.add(ghostPoints)
const trails = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
trails.frustumCulled = false
scene.add(trails)

// Personal-best staircase on the results wall.
const prGeo = new THREE.BufferGeometry()
const prLine = new THREE.Line(prGeo, new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
prLine.frustumCulled = false
scene.add(prLine)
const wallLabels = new THREE.Group()
scene.add(wallLabels)

const ramp = (t, stops) => {
  t = Math.min(1, Math.max(0, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  return stops[i].clone().lerp(stops[i + 1], t - i)
}
const YEAR_STOPS = ['#4d40ff', '#f233bf', '#ff801f', '#ffeb73'].map(c => new THREE.Color(c))
const PACE_STOPS = ['#1a4dff', '#1af2d9', '#ffd933', '#ff1f14'].map(c => new THREE.Color(c))
const HR_STOPS = ['#3fd8ff', '#6bff9a', '#ffd933', '#ff3f7a'].map(c => new THREE.Color(c))
const HR_LO = 120, HR_HI = 180
const NO_DATA = new THREE.Color(0.45, 0.45, 0.55)
const WHITE = new THREE.Color(1.6, 1.6, 1.6)

// ---------- data and race state ----------

const state = {
  race: 'mile', color: 'year', cam: 'overview', speedIdx: 2, champions: false,
  includeIndoor: false, maxPace: null,
  t: 0, playing: false, results: 0, resultsTarget: 0, followId: null, camSettled: false,
}
let started = false
let dataset = null // { title, runs, source: 'sample' | 'file' | 'embedded' }, null until chosen
let races = [], race = null
let field = [], fastest = 0, slowest = 0, latest = null, pr = null, D0 = 0, D1 = 1, paceLo = 0, paceHi = 1

function useDataset(data, source) {
  dataset = { ...data, source }
  const sample = source === 'sample'
  $('title').textContent = (sample ? 'Ghost Race' : data.title || 'Ghost Race').toUpperCase()
  $('source').textContent = sample ? `${data.title} · fictional ·` : source === 'embedded' ? 'Saved race' : 'Your runs · loaded in this browser only'
  $('save').hidden = sample
  $('downloadSample').hidden = !sample
  $('indoorChip').hidden = !data.runs.some(r => r.indoor)
  const dates = data.runs.map(r => r.date).sort()
  const frac = iso => { const [y, m] = iso.split('-').map(Number); return y + (m - 1) / 12 }
  D0 = frac(dates[0]); D1 = Math.max(D0 + 1 / 12, frac(dates.at(-1)) + 1 / 12)
  rebuildRaces()
}

function rebuildRaces() {
  if (!dataset) return
  races = buildRaces(dataset.runs, { includeIndoor: state.includeIndoor, maxPaceSecPerMile: state.maxPace })
  ensureCapacity(Math.max(1, ...races.map(r => r.ghosts.length)))
  $('races').replaceChildren(...races.map(r => {
    const b = document.createElement('button')
    b.dataset.race = r.key
    b.textContent = r.label
    b.title = `${r.ghosts.length} runs within 12% of ${r.label === 'Mile' ? 'a mile' : r.label}`
    b.onclick = () => setupRace(r.key)
    return b
  }))
  $('empty').hidden = races.length > 0
  if (!races.length) {
    field = []; race = null; gGeo.setDrawRange(0, 0); tGeo.setDrawRange(0, 0)
    for (const li of boardRows) { li.hidden = true; li.ghost = null }
    hideCard(); renderControls(); return
  }
  setupRace(races.some(r => r.key === state.race) ? state.race : races[0].key)
}

function setupRace(key) {
  race = races.find(r => r.key === key)
  state.race = key
  const ghosts = state.champions ? champions(race.ghosts) : race.ghosts
  field = ghosts.map(g => ({
    run: g, finish: g.finish, lane: (hash(g.id) - 0.5) * (ROAD_W - 3), d: 0,
    pos: new THREE.Vector3(), wall: new THREE.Vector3(), stagger: hash(g.id + 77),
  }))
  const byFinish = [...field].sort((a, b) => a.finish - b.finish)
  byFinish.forEach((g, i) => { g.rank = i + 1 })
  fastest = byFinish[0].finish
  slowest = byFinish.at(-1).finish
  paceLo = fastest / race.km; paceHi = slowest / race.km
  pr = byFinish[0]
  latest = field.at(-1)
  const median = byFinish[byFinish.length >> 1].finish
  state.speedIdx = SPEEDS.reduce((best, s, i) => (Math.abs(median / s - 40) < Math.abs(median / SPEEDS[best] - 40) ? i : best), 0)
  state.t = 0
  state.playing = started // the field waits on the start line until the viewer presses Start
  state.resultsTarget = 0
  state.followId = null
  buildGates(race)
  buildWall()
  gGeo.setDrawRange(0, field.length)
  tGeo.setDrawRange(0, field.length * (TRAIL - 1) * 2)
  if (state.cam === 'results' || state.cam === 'follow') setCam('overview')
  renderControls()
  hideCard()
}

function buildWall() {
  disposeAll(wallLabels)
  const W = 150, H = 70, y0 = 6
  const span = slowest - fastest || 1
  for (const g of field) {
    const x = ((g.run.date - D0) / (D1 - D0) - 0.5) * W
    g.wall.set(x, y0 + (1 - (g.finish - fastest) / span) * H, WALL_Z + (hash(g.run.id + 5) - 0.5) * 2)
  }
  const pts = []
  let best = Infinity
  for (const g of field) {
    if (g.finish < best) {
      best = g.finish
      if (pts.length) pts.push(new THREE.Vector3(g.wall.x, pts.at(-1).y, WALL_Z + 1.5))
      pts.push(new THREE.Vector3(g.wall.x, g.wall.y, WALL_Z + 1.5))
    }
  }
  pts.push(new THREE.Vector3(W / 2, pts.at(-1).y, WALL_Z + 1.5))
  prGeo.setFromPoints(pts)
  const step = Math.max(1, Math.ceil((D1 - D0) / 6))
  for (let y = Math.ceil(D0); y <= Math.floor(D1); y += step) {
    const s = makeLabel(String(y), { color: '#8fa0c8', scale: 0.8 })
    s.position.set(((y - D0) / (D1 - D0) - 0.5) * W, 1.5, WALL_Z)
    wallLabels.add(s)
  }
  for (let k = 0; k <= 4; k++) {
    const s = makeLabel(fmtTime(fastest + (span * k) / 4), { color: '#8fa0c8', scale: 0.8 })
    s.position.set(-W / 2 - 10, y0 + (1 - k / 4) * H, WALL_Z)
    wallLabels.add(s)
  }
  const title = makeLabel(`${race.label.toUpperCase()} TIMES · FASTER IS HIGHER`, { color: '#cfe0ff', scale: 1 })
  title.position.set(0, y0 + H + 9, WALL_Z)
  wallLabels.add(title)
}

// Ghosts run at a steady pace: their own average pace for the run.
const distAt = (g, t) => race.km * Math.min(1, Math.max(0, t / g.finish))

const tmp = new THREE.Vector3()
function racePos(g, t, out) {
  let z = -(distAt(g, t) / race.km) * L
  if (t > g.finish) z -= Math.min(10, (t - g.finish) * 0.02 * SPEEDS[state.speedIdx] / 30) // drift past the line
  return out.set(g.lane, 0.8, z)
}

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function updateGhosts() {
  if (!race) return
  const r = state.results
  field.forEach((g, i) => {
    g.d = distAt(g, state.t)
    racePos(g, state.t, g.pos)
    const s = ease(Math.min(1, Math.max(0, r * 1.6 - g.stagger * 0.6)))
    const p = tmp.copy(g.pos).lerp(g.wall, s)
    p.y += Math.sin(s * Math.PI) * (8 + g.stagger * 20)
    gPos[i * 3] = p.x; gPos[i * 3 + 1] = p.y; gPos[i * 3 + 2] = p.z

    let c
    if (g === latest) c = WHITE
    else if (state.color === 'year') c = ramp((g.run.date - D0) / (D1 - D0), YEAR_STOPS)
    else if (state.color === 'hr') c = g.run.hr ? ramp((g.run.hr - HR_LO) / (HR_HI - HR_LO), HR_STOPS) : NO_DATA
    else c = ramp(1 - (g.finish / race.km - paceLo) / Math.max(1, paceHi - paceLo), PACE_STOPS)
    const sel = g.run.id === state.followId
    const k = sel ? 1.6 : 1
    gCol[i * 3] = c.r * k; gCol[i * 3 + 1] = c.g * k; gCol[i * 3 + 2] = c.b * k
    gSize[i] = g === latest ? 3.4 : sel ? 3.2 : g === pr ? 2.4 : 1.6

    // A short, faint straight trail behind each running ghost; none once it has started the results
    // morph or finished.
    const running = g.d > 0 && state.t < g.finish ? 1 - r : 0
    const len = Math.min(TRAIL_LEN, (g.d / race.km) * L)
    for (let j = 0; j < TRAIL - 1; j++) {
      const base = (i * (TRAIL - 1) + j) * 6
      const z0 = g.pos.z + (len * j) / (TRAIL - 1), z1 = g.pos.z + (len * (j + 1)) / (TRAIL - 1)
      tPos[base] = g.pos.x; tPos[base + 1] = g.pos.y; tPos[base + 2] = z0
      tPos[base + 3] = g.pos.x; tPos[base + 4] = g.pos.y; tPos[base + 5] = z1
      const f0 = (1 - j / (TRAIL - 1)) ** 2 * 0.35 * running, f1 = (1 - (j + 1) / (TRAIL - 1)) ** 2 * 0.35 * running
      tCol[base] = c.r * f0; tCol[base + 1] = c.g * f0; tCol[base + 2] = c.b * f0
      tCol[base + 3] = c.r * f1; tCol[base + 4] = c.g * f1; tCol[base + 5] = c.b * f1
    }
  })
  for (const a of ['position', 'color', 'aSize']) gGeo.attributes[a].needsUpdate = true
  for (const a of ['position', 'color']) tGeo.attributes[a].needsUpdate = true
  prLine.material.opacity = Math.max(0, r * 2 - 1)
  wallLabels.visible = r > 0.5
  for (const s of wallLabels.children) s.material.opacity = Math.max(0, r * 2 - 1)
}

// ---------- camera ----------

const CAMS = {
  overview: () => ({ pos: [-130, 125, 70], target: [0, 0, -L * 0.55] }),
  leader: () => chase(standings()[0]),
  latest: () => chase(latest),
  follow: () => chase(field.find(g => g.run.id === state.followId) || latest),
  results: () => ({ pos: [0, 44, WALL_Z + 125], target: [0, 40, WALL_Z] }),
}
function chase(g) {
  if (!g) return CAMS.overview()
  const p = g.pos
  return { pos: [p.x * 0.6 + 6, 7, p.z + 24], target: [p.x * 0.4, 1.5, p.z - 26] }
}
function setCam(name) {
  state.cam = name
  state.camSettled = false
  controls.enabled = false
  if (name === 'results') state.resultsTarget = 1
  else if (state.resultsTarget === 1) state.resultsTarget = 0
  renderControls()
}
const camTarget = new THREE.Vector3(0, 0, -L * 0.55), want = new THREE.Vector3(), wantT = new THREE.Vector3()
function updateCamera(dt) {
  if (state.camSettled) { controls.update(); return }
  const d = CAMS[state.cam]()
  want.set(...d.pos); wantT.set(...d.target)
  const k = 1 - Math.exp(-dt * (state.cam === 'overview' || state.cam === 'results' ? 2.2 : 4))
  camera.position.lerp(want, k)
  camTarget.lerp(wantT, k)
  camera.lookAt(camTarget)
  if ((state.cam === 'overview' || state.cam === 'results') && camera.position.distanceTo(want) < 0.5) {
    state.camSettled = true
    controls.target.copy(camTarget)
    controls.enabled = true
  }
}

// ---------- HUD ----------

function standings() {
  return [...field].sort((a, b) => {
    const fa = state.t >= a.finish, fb = state.t >= b.finish
    if (fa && fb) return a.finish - b.finish
    if (fa !== fb) return fa ? -1 : 1
    return b.d - a.d
  })
}

// Leaderboard rows are created once and updated in place, so a click never lands on a row that was
// replaced mid-click. While the pointer is over the board it stops reordering, so rows stay put.
const BOARD_ROWS = 9
const boardRows = Array.from({ length: BOARD_ROWS }, () => {
  const li = document.createElement('li')
  li.tabIndex = 0
  li.setAttribute('role', 'button')
  li.innerHTML = '<span class="pos"></span><span class="when"><span class="date"></span><em class="tag-latest">latest</em><em class="gold">PB</em></span><span class="gap"></span>'
  li.onclick = () => { if (li.ghost) follow(li.ghost) }
  li.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && li.ghost) { e.preventDefault(); follow(li.ghost) } }
  return li
})
$('board').replaceChildren(...boardRows)
let boardHeld = false
$('board').addEventListener('pointerenter', () => { boardHeld = true })
$('board').addEventListener('pointerleave', () => { boardHeld = false })

function renderBoard(st) {
  const leader = st[0]
  const rows = st.slice(0, 8)
  if (st.indexOf(latest) >= 8) rows.push(latest)
  boardRows.forEach((li, i) => {
    const g = rows[i]
    li.hidden = !g
    li.ghost = g || null
    if (!g) return
    const pos = st.indexOf(g) + 1
    const done = state.t >= g.finish
    li.className = [g === latest && 'latest', g === pr && done && 'pr', g.run.id === state.followId && 'sel', pos > 8 && 'pinned'].filter(Boolean).join(' ')
    li.querySelector('.pos').textContent = pos
    li.querySelector('.date').textContent = fmtDate(g.run)
    li.querySelector('.tag-latest').hidden = g !== latest
    li.querySelector('.gold').hidden = !(g === pr && done)
    li.querySelector('.gap').textContent = done ? fmtTime(g.finish) : g === leader ? `${perMile(g.finish / race.km)}/mi` : `−${Math.round((leader.d - g.d) * 1000)} m`
    li.setAttribute('aria-label', `Follow the ${fmtLongDate(g.run)} run`)
  })
}

let hudAt = 0
function renderHUD(now) {
  $('clock').textContent = fmtTime(state.t)
  if (now - hudAt < 120 || !race) return
  hudAt = now
  const st = standings()
  const finished = field.filter(g => state.t >= g.finish).length
  $('fieldInfo').textContent = `${race.label} · ${field.length} ghosts · ${finished} finished`
  if (!boardHeld) renderBoard(st)
  if (state.followId !== null) renderCardLive()
  if (finished === field.length && state.playing) {
    state.playing = false
    renderControls()
    setTimeout(() => { if (!state.playing && state.t >= slowest && state.cam !== 'results') setCam('results') }, 1500)
  }
}

function follow(g) {
  state.followId = g.run.id
  setCam('follow')
  const r = g.run
  $('cardTitle').textContent = fmtLongDate(r)
  const actual = `${(r.distM / 1000 / MI).toFixed(2)} mi in ${fmtTime(r.timeS)} · ${perMile(r.timeS / (r.distM / 1000))}/mi${r.indoor ? ' · indoor' : ''}`
  const extras = [r.hr && `${r.hr} bpm avg`, r.climb != null && `${Math.round(r.climb * 3.28084)} ft climb`].filter(Boolean).join(' · ')
  $('cardMeta').textContent = `Actual run: ${actual}`
  $('cardRace').textContent = `${race.label} at that pace: ${fmtTime(g.finish)} · #${g.rank} of ${field.length}`
  $('cardExtras').textContent = extras
  $('cardExtras').hidden = !extras
  $('card').hidden = false
  renderCardLive()
}
function renderCardLive() {
  const g = field.find(x => x.run.id === state.followId)
  if (!g) return
  $('cardLive').textContent = state.t >= g.finish ? `Finished ${fmtTime(g.finish)}` : `${(g.d / MI).toFixed(2)} mi · position ${standings().indexOf(g) + 1}`
}
function hideCard() {
  $('card').hidden = true
  state.followId = null
}

function renderControls() {
  const pressed = (sel, test) => { for (const b of document.querySelectorAll(sel)) b.setAttribute('aria-pressed', String(test(b))) }
  pressed('[data-race]', b => b.dataset.race === state.race)
  pressed('[data-color]', b => b.dataset.color === state.color)
  pressed('[data-cam]', b => b.dataset.cam === state.cam)
  pressed('[data-speed]', b => Number(b.dataset.speed) === state.speedIdx)
  pressed('[data-field]', b => (b.dataset.field === 'champions') === state.champions)
  $('indoorChip').setAttribute('aria-pressed', String(state.includeIndoor))
  for (const el of document.querySelectorAll('[data-legend]')) el.hidden = el.dataset.legend !== state.color
  $('play').textContent = state.playing ? '❚❚' : '▶'
  $('play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play')
}

// ---------- controls ----------

for (const b of document.querySelectorAll('[data-field]')) b.onclick = () => { state.champions = b.dataset.field === 'champions'; if (race) setupRace(state.race); else renderControls() }
for (const b of document.querySelectorAll('[data-color]')) b.onclick = () => { state.color = b.dataset.color; renderControls() }
for (const b of document.querySelectorAll('[data-cam]')) b.onclick = () => { if (b.dataset.cam !== 'follow') hideCard(); setCam(b.dataset.cam) }
for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => { state.speedIdx = Number(b.dataset.speed); renderControls() }
$('indoorChip').onclick = () => { state.includeIndoor = !state.includeIndoor; rebuildRaces() }
$('maxPace').onchange = e => { state.maxPace = Number(e.target.value) || null; rebuildRaces() }
$('play').onclick = () => {
  if (!race) return
  if (!started) begin()
  else {
    if (!state.playing && state.t >= slowest) state.t = 0
    state.playing = !state.playing
  }
  if (state.playing && state.cam === 'results') setCam('overview')
  renderControls()
}
$('restart').onclick = () => { if (!race) return; state.t = 0; state.playing = true; if (state.cam === 'results') setCam('overview'); renderControls() }
$('cardClose').onclick = () => { hideCard(); setCam('overview') }
controls.addEventListener('start', () => { state.camSettled = true })
addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea')) return
  // Space on a focused button or link presses that control, not play.
  if (e.code === 'Space' && !e.target.closest?.('button, a, summary, [role="button"]')) { e.preventDefault(); $('play').click() }
  if (e.key === 'r') $('restart').click()
})

// Click a ghost to follow it.
const ray = new THREE.Raycaster()
ray.params.Points.threshold = 1.6
let down = null
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY] })
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera)
  const hit = ray.intersectObject(ghostPoints)[0]
  if (hit && field[hit.index]) follow(field[hit.index])
})

// ---------- soundtrack ----------

// "Quiet Pines": generated live from code, no audio files. Off by default; the ♪ button turns it on
// (that click also satisfies the browser rule that sound needs a user gesture).
const music = createMusicPlayer()
const TRACK = makeTrack('downtempo', 41)
let soundOn = false, musicStarted = false // music is off until the viewer turns it on
function syncMusic() {
  if (soundOn && !musicStarted) { music.play(TRACK); musicStarted = true }
  if (musicStarted) music.setVolume(soundOn ? 0.8 : 0, 0.3)
  $('sound').setAttribute('aria-pressed', String(soundOn))
  $('sound').setAttribute('aria-label', soundOn ? 'Mute music' : 'Play music')
}
$('sound').onclick = () => { soundOn = !soundOn; syncMusic() }
// Browsers can suspend audio (for example in a background tab); resume it on the next interaction.
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => { if (musicStarted) music.context?.resume() }, { capture: true })

// ---------- loading, saving and errors ----------

function showErrors(title, list) {
  $('errorsTitle').textContent = title
  $('errorsList').replaceChildren(...list.map(t => Object.assign(document.createElement('li'), { textContent: t })))
  $('errors').hidden = false
}
$('errorsClose').onclick = () => { $('errors').hidden = true }

async function loadFile(file) {
  if (!file) return
  if (file.size > 25e6) return showErrors('That file is too large', ['Runs files are usually well under 5 MB.'])
  const result = parseRunsText(await file.text())
  if (result.errors) return showErrors(`Couldn't load ${file.name}`, result.errors)
  useDataset(result.data, 'file')
  begin()
  if (!races.length) showErrors('No races to show', ['None of your runs fall within 12% of a mile, 5K, 10K, half marathon or marathon (at least 3 runs needed). Check that distance_m is in metres and time_s in seconds.'])
}
$('pickFile').onclick = () => $('file').click()
$('file').onchange =e => { loadFile(e.target.files[0]); e.target.value = '' }

// Sample runners: fictional histories from a level and a length of history.
const sampleOpts = { level: 'regular', years: 3 }
function renderSampleOpts() {
  for (const b of document.querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === sampleOpts.level))
  for (const b of document.querySelectorAll('[data-years]')) b.setAttribute('aria-pressed', String(Number(b.dataset.years) === sampleOpts.years))
}
for (const b of document.querySelectorAll('[data-level]')) b.onclick = () => { sampleOpts.level = b.dataset.level; renderSampleOpts() }
for (const b of document.querySelectorAll('[data-years]')) b.onclick = () => { sampleOpts.years = Number(b.dataset.years); renderSampleOpts() }
function generateSample() {
  const seed = (Math.random() * 2 ** 31) | 0
  useDataset(sampleRunner({ ...sampleOpts, seed }), 'sample')
  begin()
}
$('generate').onclick = generateSample
$('changeRuns').onclick = showChooser
$('keepRuns').onclick = () => begin()
$('downloadSample').onclick = () => {
  const lines = dataset.runs.map(r => `    ${JSON.stringify(r)}`).join(',\n')
  const json = `{\n  "title": ${JSON.stringify(dataset.title)},\n  "runs": [\n${lines}\n  ]\n}\n`
  download(new Blob([json], { type: 'application/json' }), 'sample-runs.json')
}
renderSampleOpts()

function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name })
  document.body.append(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

let dragDepth = 0
addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('drop').hidden = false } })
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true } })
addEventListener('dragover', e => e.preventDefault())
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; loadFile(e.dataTransfer.files[0]) })

// Save as HTML: a copy of this page with the loaded runs embedded, so it opens straight into them.
$('save').onclick = () => {
  if (!confirm('The saved file will contain the dates, distances, times and heart rates you loaded. Anyone you send it to can see them. Save it?')) return
  const html = embedRuns(PRISTINE, dataset)
  const slug = (dataset.title || 'my').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my'
  download(new Blob([html], { type: 'text/html' }), `ghost-race-${slug}.html`)
}

// ---------- start ----------

function resize() {
  const w = innerWidth, h = innerHeight
  renderer.setSize(w, h, false)
  composer.setSize(w, h)
  bloom.resolution.set(w, h)
  camera.aspect = w / h
  camera.fov = w < 700 ? 64 : 50
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

let prev = performance.now()
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000)
  prev = now
  if (state.playing) state.t = Math.min(slowest + 2, state.t + dt * SPEEDS[state.speedIdx])
  state.results += (state.resultsTarget - state.results) * (1 - Math.exp(-dt * 1.4))
  if (Math.abs(state.results - state.resultsTarget) < 0.001) state.results = state.resultsTarget
  updateGhosts()
  updateCamera(dt)
  composer.render()
  renderHUD(now)
  requestAnimationFrame(frame)
}

// The start card: load a file or generate a sample; either one starts the race. Reopening it
// (Change runs…) pauses the race until new runs are chosen or the current ones are kept.
function showChooser() {
  $('keepRuns').hidden = !dataset
  $('intro').classList.remove('gone')
  started = false
  state.playing = false
  renderControls()
}

// Start (or restart) the race with the current runs and close the start card.
function begin() {
  if (started || !race) return
  started = true
  state.t = 0
  state.playing = true
  if (state.cam === 'results') setCam('overview')
  $('intro').classList.add('gone')
  renderControls()
}

// A copy made with "Save as HTML" opens straight into its race; otherwise choose runs first.
const embedded = (() => {
  try { return JSON.parse($('embedded-runs').textContent) } catch { return null }
})()
const fromEmbedded = embedded ? validateRuns(embedded) : null
if (fromEmbedded?.data) {
  useDataset(fromEmbedded.data, 'embedded')
  begin()
} else {
  $('source').textContent = 'No runs loaded yet'
  showChooser()
}
if (fromEmbedded?.errors) showErrors('The runs saved in this file are invalid', fromEmbedded.errors)
document.body.classList.add('ready')
requestAnimationFrame(frame)
