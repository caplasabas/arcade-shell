#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function fail(message, code = 1) {
  console.error(`[publish-arcade-shell] ${message}`)
  process.exit(code)
}

function normalizeUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
  })

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`)
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed`, result.status || 1)
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`failed to read ${label}: ${error.message}`)
  }
}

function readPackageVersion() {
  const packageJsonPath = path.resolve('package.json')
  const packageJson = readJson(packageJsonPath, 'package.json')
  return String(packageJson?.version || '').trim()
}

async function uploadFile({ url, body, contentType, serviceKey, label }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    fail(`${label} failed (${response.status}): ${errorBody}`)
  }

  return response
}

const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL)
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'game-packages'
const metadataPath = process.env.ARCADE_SHELL_METADATA_PATH || 'arcade-shell/latest.json'
const shellId = process.env.ARCADE_SHELL_ID || 'arcade-shell'
const version =
  process.env.ARCADESHELL_VERSION ||
  readPackageVersion()

if (!supabaseUrl) fail('SUPABASE_URL is required')
if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is required')
if (!version) fail('ARCADESHELL_VERSION or package.json version is required')

const env = {
  ...process.env,
  ARCADESHELL_VERSION: version,
}

run('bash', ['scripts/package-arcade-shell.sh'], env)
run('node', ['scripts/encrypt-arcade-shell.mjs'], env)

const packagedReleaseDir = path.resolve(`dist-package/${shellId}/${version}/release`)
const packagedBundlePath = path.join(packagedReleaseDir, 'apps', 'service', 'input.bundle.cjs')
const packagedUiDistDir = path.join(packagedReleaseDir, 'apps', 'ui', 'dist')
const packagedUiBuildMetadataPath = path.join(packagedUiDistDir, 'arcade-shell-build.json')

if (!fs.existsSync(packagedBundlePath)) {
  fail(`missing packaged service bundle: ${packagedBundlePath}`)
}

if (!fs.existsSync(packagedUiDistDir)) {
  fail(`missing packaged UI dist: ${packagedUiDistDir}`)
}

if (!fs.existsSync(packagedUiBuildMetadataPath)) {
  fail(`missing packaged UI build metadata: ${packagedUiBuildMetadataPath}`)
}

const encryptedReleaseDir = path.resolve(`dist-package/encrypted/${shellId}/${version}`)
const encName = `${shellId}-${version}.enc`
const encPath = path.join(encryptedReleaseDir, encName)
const manifestPath = path.join(encryptedReleaseDir, 'manifest.enc.json')

if (!fs.existsSync(encPath)) {
  fail(`encrypted package not found: ${encPath}`)
}

if (!fs.existsSync(manifestPath)) {
  fail(`manifest not found: ${manifestPath}`)
}

const manifest = readJson(manifestPath, 'encrypted manifest')
const checksum = String(manifest?.encrypted?.sha256 || '').trim()

if (!checksum) {
  fail('encrypted manifest missing checksum')
}

const objectPath = `${shellId}/${version}/${encName}`
const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`

console.log(`[publish-arcade-shell] verified service bundle: ${packagedBundlePath}`)
console.log(`[publish-arcade-shell] verified UI dist: ${packagedUiDistDir}`)
console.log(`[publish-arcade-shell] verified UI build metadata: ${packagedUiBuildMetadataPath}`)
console.log(`[publish-arcade-shell] uploading ${encName} to ${uploadUrl}`)

await uploadFile({
  url: uploadUrl,
  body: fs.readFileSync(encPath),
  contentType: 'application/octet-stream',
  serviceKey,
  label: 'storage upload',
})

const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
const metadata = {
  version,
  package_url: publicUrl,
  checksum,
  published_at: new Date().toISOString(),
  notes: process.env.ARCADE_SHELL_RELEASE_NOTES || null,
  runtime: {
    service_bundle: 'apps/service/input.bundle.cjs',
    ui_dist: 'apps/ui/dist',
    ui_build_metadata: 'apps/ui/dist/arcade-shell-build.json',
  },
}

const metadataJson = JSON.stringify(metadata, null, 2)
const localMetadataPath = path.join(encryptedReleaseDir, 'metadata.json')
fs.writeFileSync(localMetadataPath, metadataJson)

const metadataUploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${metadataPath}`
console.log(`[publish-arcade-shell] updating metadata at ${metadataUploadUrl}`)

await uploadFile({
  url: metadataUploadUrl,
  body: metadataJson,
  contentType: 'application/json',
  serviceKey,
  label: 'metadata upload',
})

console.log(`[publish-arcade-shell] published version ${version}`)
console.log(`[publish-arcade-shell] package url: ${publicUrl}`)
console.log(`[publish-arcade-shell] checksum: ${checksum}`)
console.log(`[publish-arcade-shell] metadata file: ${localMetadataPath}`)
