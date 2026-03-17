#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { execSync } from 'node:child_process'

function fail(message) {
  console.error(`[encrypt-arcade-shell] ${message}`)
  process.exit(1)
}

const gameId = process.env.ARCADE_SHELL_ID || 'arcade-shell'
const version =
  process.env.ARCADESHELL_VERSION ||
  process.argv[2] ||
  (() => {
    try {
      return execSync('git describe --tags --always --dirty', {
        encoding: 'utf8',
      }).trim()
    } catch (error) {
      return null
    }
  })()

if (!version) fail('Missing ARCADESHELL_VERSION or git describe failed')

const keyHex = process.env.GAME_PACKAGE_KEY_HEX
if (!keyHex || keyHex.length !== 64) {
  fail('GAME_PACKAGE_KEY_HEX must be a 64-character hex string')
}

const key = Buffer.from(keyHex, 'hex')
const packageDir = path.resolve(`dist-package/${gameId}/${version}`)
if (!fs.existsSync(packageDir)) {
  fail(`Package directory not found: ${packageDir}`)
}

const tarballName = `${gameId}-${version}.tar.gz`
const tarballPath = path.join(packageDir, tarballName)
if (!fs.existsSync(tarballPath)) {
  fail(`Tarball not found: ${tarballPath}`)
}

const outDir = path.resolve(`dist-package/encrypted/${gameId}/${version}`)
fs.mkdirSync(outDir, { recursive: true })

const encPath = path.join(outDir, `${gameId}-${version}.enc`)
const manifestPath = path.join(outDir, 'manifest.enc.json')

const plain = fs.readFileSync(tarballPath)
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
const tag = cipher.getAuthTag()
const payload = Buffer.concat([iv, tag, encrypted])

fs.writeFileSync(encPath, payload)

const manifest = {
  format: 'arcade-shell-encrypted-v1',
  cipher: 'aes-256-gcm',
  ivLength: iv.length,
  tagLength: tag.length,
  gameId,
  version,
  entry: 'apps/ui/public/index.html',
  plaintext: {
    file: path.basename(tarballPath),
    bytes: plain.length,
    sha256: createHash('sha256').update(plain).digest('hex'),
  },
  encrypted: {
    file: path.basename(encPath),
    bytes: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'),
  },
  generatedAt: new Date().toISOString(),
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
fs.rmSync(tarballPath)

console.log(`[encrypt-arcade-shell] wrote ${encPath}`)
console.log(`[encrypt-arcade-shell] wrote ${manifestPath}`)
