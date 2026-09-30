import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.resolve(process.cwd(), 'src')
const wh40kRoot = path.join(sourceRoot, 'wh40k11e')
const aos4Domain = path.join(sourceRoot, 'aos4', 'domain')
const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const children = await Promise.all(
    entries.map(async entry => {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(child)
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [child] : []
    })
  )
  return children.flat()
}

const within = (resolved: string, root: string) =>
  resolved === root || resolved.startsWith(`${root}${path.sep}`)

// Inner layers may import only these roots; generic AoS identity types are shared domain vocabulary.
const LAYERS: Record<string, string[]> = {
  domain: [path.join(wh40kRoot, 'domain'), aos4Domain],
  select: [path.join(wh40kRoot, 'domain'), path.join(wh40kRoot, 'select'), aos4Domain],
  reminders: [
    path.join(wh40kRoot, 'domain'),
    path.join(wh40kRoot, 'select'),
    path.join(wh40kRoot, 'reminders'),
    aos4Domain,
  ],
}

describe('40K architecture boundaries', () => {
  it('keeps the domain, selection, and reminder layers free of source and data dependencies', async () => {
    const violations: string[] = []
    for (const [layer, allowed] of Object.entries(LAYERS)) {
      for (const file of await sourceFiles(path.join(wh40kRoot, layer))) {
        const source = await readFile(file, 'utf8')
        for (const [, specifier] of Array.from(source.matchAll(importPattern))) {
          if (!specifier.startsWith('.')) continue
          const resolved = path.resolve(path.dirname(file), specifier)
          if (!allowed.some(root => within(resolved, root))) {
            violations.push(`${path.relative(sourceRoot, file)} -> ${specifier}`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })
})
