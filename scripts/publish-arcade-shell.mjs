#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function fail(message, code = 1) {
  console.error(`[publish-arcade-shell] ${message}`)
  process.exit(code)
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'game-packages'
const metadataPath = process.env.ARCADE_SHELL_METADATA_PATH || 'arcade-shell/latest.json'
const version =
  process.env.ARCADESHELL_VERSION ||
  (() => {
    const result = spawnSync('git', ['describe', '--tags', '--always', '--dirty'], {
      encoding: 'utf8',
    })
    if (result.status !== 0)
      return fail('unable to determine version via git describe', result.status)
    return result.stdout.trim()
  })()

if (!supabaseUrl) fail('SUPABASE_URL is required')
if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is required')

const env = {
  ...process.env,
  ARCADESHELL_VERSION: version,
}

const packageCmd = spawnSync('bash', ['scripts/package-arcade-shell.sh'], {
  stdio: 'inherit',
  env,
})

if (packageCmd.status !== 0) {
  fail('package-arcade-shell failed', packageCmd.status || 1)
}

const encryptCmd = spawnSync('node', ['scripts/encrypt-arcade-shell.mjs'], {
  stdio: 'inherit',
  env,
})

if (encryptCmd.status !== 0) {
  fail('encrypt-arcade-shell failed', encryptCmd.status || 1)
}

const releaseDir = path.resolve(`dist-package/encrypted/arcade-shell/${version}`)
const encName = `arcade-shell-${version}.enc`
const encPath = path.join(releaseDir, encName)
const manifestPath = path.join(releaseDir, 'manifest.enc.json')

if (!fs.existsSync(encPath)) {
  fail(`Encrypted package not found: ${encPath}`)
}

if (!fs.existsSync(manifestPath)) {
  fail(`Manifest not found: ${manifestPath}`)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const checksum = manifest.encrypted?.sha256

if (!checksum) {
  fail('Encrypted manifest missing checksum')
}

const objectPath = `arcade-shell/${version}/${encName}`
const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`

console.log(`[publish-arcade-shell] uploading ${encName} to ${uploadUrl}`)
const uploadRes = await fetch(uploadUrl, {
  method: 'POST',
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/octet-stream',
    'x-upsert': 'true',
  },
  body: fs.readFileSync(encPath),
})

if (!uploadRes.ok) {
  const body = await uploadRes.text()
  fail(`storage upload failed (${uploadRes.status}): ${body}`)
}

const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
const metadata = {
  version,
  package_url: publicUrl,
  checksum,
  published_at: new Date().toISOString(),
  notes: process.env.ARCADE_SHELL_RELEASE_NOTES || null,
}

const metadataJson = JSON.stringify(metadata, null, 2)
fs.writeFileSync(path.join(releaseDir, 'metadata.json'), metadataJson)

const metadataUploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${metadataPath}`
console.log(`[publish-arcade-shell] updating metadata at ${metadataUploadUrl}`)
const metadataRes = await fetch(metadataUploadUrl, {
  method: 'POST',
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'x-upsert': 'true',
  },
  body: metadataJson,
})

if (!metadataRes.ok) {
  const body = await metadataRes.text()
  fail(`metadata upload failed (${metadataRes.status}): ${body}`)
}

console.log(`[publish-arcade-shell] published version ${version}`)
console.log(`[publish-arcade-shell] package url: ${publicUrl}`)
console.log(`[publish-arcade-shell] checksum: ${checksum}`)
