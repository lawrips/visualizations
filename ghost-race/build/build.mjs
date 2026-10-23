// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lawrips
//
// Builds ../ghost-race.html: bundles src/main.js with three.js (unminified, license comments kept)
// and inlines it and src/boot.js into src/page.html, giving one self-contained file.
// Usage: npm ci && npm run build   (from this folder)

import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'src')
const out = join(here, '..', 'ghost-race.html')

const result = await build({
  entryPoints: [join(src, 'main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  legalComments: 'inline', // keeps three.js's @license notice next to its code
  nodePaths: [join(here, 'node_modules')],
  write: false,
})

// A literal "</script" inside inline code would end the script element early.
const inline = code => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`

let page = readFileSync(join(src, 'page.html'), 'utf8')
const replace = (marker, code) => {
  if (!page.includes(marker)) throw new Error(`page.html is missing ${marker}`)
  page = page.replace(marker, () => inline(code))
}
replace('<!-- inline:boot.js -->', readFileSync(join(src, 'boot.js'), 'utf8'))
replace('<!-- inline:app.js (must stay the last element in body) -->', result.outputFiles[0].text)
writeFileSync(out, page)
console.log(`wrote ghost-race.html (${Math.round(page.length / 1024)} KB)`)
