// Renders the app icons and social preview in public/ from the SVG sources in brand/.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const BRAND = path.resolve('brand')
const PUBLIC = path.resolve('public')

const jobs = [
  ['favicon.svg', 16, 16, 'favicon-16x16.png'],
  ['favicon.svg', 32, 32, 'favicon-32x32.png'],
  ['touch.svg', 180, 180, 'apple-touch-icon.png'],
  ['icon.svg', 192, 192, 'android-chrome-192x192.png'],
  ['icon.svg', 512, 512, 'android-chrome-512x512.png'],
  ['maskable.svg', 512, 512, 'maskable-icon-512x512.png'],
  ['icon.svg', 150, 150, 'mstile-150x150.png'],
  ['social.svg', 1200, 630, 'social-preview.png'],
]

// Render from a high density so small sizes are downsampled rather than rasterized tiny.
const render = (source, width, height) =>
  sharp(fs.readFileSync(path.join(BRAND, source)), {
    density: Math.ceil((72 * 4 * Math.max(width, height)) / 512),
  })
    .resize(width, height)
    .png()
    .toBuffer()

// An .ico is a small header and directory followed by embedded PNG images.
const ico = images => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map(image => image.data)])
}

for (const [source, width, height, name] of jobs) {
  fs.writeFileSync(path.join(PUBLIC, name), await render(source, width, height))
  console.log(`public/${name}`)
}

const favicons = await Promise.all(
  [16, 32, 48].map(async size => ({ size, data: await render('favicon.svg', size, size) }))
)
fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico(favicons))
console.log('public/favicon.ico')

fs.copyFileSync(path.join(BRAND, 'favicon.svg'), path.join(PUBLIC, 'favicon.svg'))
console.log('public/favicon.svg')
