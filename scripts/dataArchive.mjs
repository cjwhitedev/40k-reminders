// Packs downloaded rules sources into one encrypted archive, and unpacks it again.
//
//   yarn data:archive pack <out.tgz> <candidate-dir>...   archive candidates with the files they reference
//   yarn data:archive encrypt <in> <out>                   AES-256-GCM, passphrase from DATA_ARCHIVE_PASSPHRASE
//   yarn data:archive decrypt <in> <out>
import { spawnSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MAGIC = Buffer.from('W40KENC1')
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const ARTIFACTS = path.join('.cache', 'wh40k11e', 'artifacts')

const fail = message => {
  console.error(message)
  process.exit(1)
}

const passphrase = () => {
  const value = process.env.DATA_ARCHIVE_PASSPHRASE
  if (!value) fail('Set DATA_ARCHIVE_PASSPHRASE to the passphrase stored in the repository secret.')
  return value
}

const deriveKey = (secret, salt) =>
  scryptSync(secret, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })

const pack = (out, directories) => {
  if (!out || !directories.length) fail('Usage: yarn data:archive pack <out.tgz> <candidate-dir>...')
  const entries = []
  for (const directory of directories) {
    const manifestPath = path.join(directory, 'candidate-manifest.json')
    if (!fs.existsSync(manifestPath)) fail(`No candidate-manifest.json in ${directory}`)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    entries.push(directory, ...manifest.artifacts.map(artifact => path.join(ARTIFACTS, artifact.checksum)))
  }
  const unique = Array.from(new Set(entries))
  const missing = unique.filter(entry => !fs.existsSync(entry))
  if (missing.length) fail(`Missing cached files:\n${missing.join('\n')}`)
  const result = spawnSync('tar', ['-czf', out, ...unique], { stdio: 'inherit' })
  if (result.status !== 0) fail('tar failed')
  console.log(`${out}: ${directories.length} candidate(s), ${unique.length - directories.length} file(s)`)
}

const encrypt = (input, output) => {
  if (!input || !output) fail('Usage: yarn data:archive encrypt <in> <out>')
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase(), salt), iv)
  const body = Buffer.concat([cipher.update(fs.readFileSync(input)), cipher.final()])
  fs.writeFileSync(output, Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]))
  console.log(`${output}: encrypted`)
}

const decrypt = (input, output) => {
  if (!input || !output) fail('Usage: yarn data:archive decrypt <in> <out>')
  const data = fs.readFileSync(input)
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) fail(`${input} is not an encrypted data archive`)
  let offset = MAGIC.length
  const take = bytes => data.subarray(offset, (offset += bytes))
  const salt = take(SALT_BYTES)
  const iv = take(IV_BYTES)
  const tag = take(TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase(), salt), iv)
  decipher.setAuthTag(tag)
  try {
    fs.writeFileSync(output, Buffer.concat([decipher.update(data.subarray(offset)), decipher.final()]))
  } catch {
    fail('Decryption failed: wrong passphrase, or the archive was damaged or altered.')
  }
  console.log(`${output}: decrypted`)
}

const [command, ...args] = process.argv.slice(2)
if (command === 'pack') pack(args[0], args.slice(1))
else if (command === 'encrypt') encrypt(args[0], args[1])
else if (command === 'decrypt') decrypt(args[0], args[1])
else fail('Usage: yarn data:archive <pack|encrypt|decrypt> ...')
