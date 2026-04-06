#!/usr/bin/env node
import { createDecipheriv, createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const forceUpdate = args.includes('--force')
const manualCheck = args.includes('--manual') || args.includes('--check-now')

function fail(message) {
  throw new Error(message)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeUrl(base) {
  return String(base || '')
    .trim()
    .replace(/\/+$/, '')
}

function normalizePathFragment(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function parseEnvInt(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === null) return fallback
  const text = String(raw).trim()
  if (!text) return fallback
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toPublicStorageUrl(supabaseUrl, bucket, objectPath) {
  return `${normalizeUrl(supabaseUrl)}/storage/v1/object/public/${normalizePathFragment(
    bucket,
  )}/${normalizePathFragment(objectPath)}`
}

function sanitizeRelativePath(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)

  if (normalized.length === 0) return ''
  if (normalized.some(part => part === '..')) {
    throw new Error(`invalid relative path: ${value}`)
  }

  return normalized.join('/')
}

function emitStatus(patch = {}) {
  console.log(`[arcade-shell-updater:status] ${JSON.stringify(patch)}`)
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function run(cmd, argv, options = {}) {
  const result = spawnSync(cmd, argv, {
    stdio: 'inherit',
    ...options,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`command failed: ${cmd} ${argv.join(' ')}`)
  }
}

function restartManagedServices(serviceNames) {
  const names = Array.isArray(serviceNames)
    ? serviceNames.map(value => String(value || '').trim()).filter(Boolean)
    : []

  if (names.length === 0) return

  console.log(`[arcade-shell-updater] restarting services: ${names.join(', ')}`)
  run('systemctl', ['--no-block', 'restart', ...names])
}

function ensureSystemFonts() {
  console.log('[arcade-shell-updater] ensuring system fonts')

  try {
    run('sh', [
      '-lc',
      `
        apt-get update -y &&
        apt-get install -y --no-install-recommends \
          fonts-dejavu-core \
          fonts-liberation \
          fonts-noto-core
        `,
    ])
  } catch (err) {
    console.warn('[arcade-shell-updater] font install failed:', err.message)
  }
}

function isNetworkError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('fetch failed') ||
    message.includes('curl') ||
    message.includes('network') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('eai_again') ||
    message.includes('connection reset') ||
    message.includes('socket hang up')
  )
}

function isUnmanagedLocalBuild(version) {
  const value = String(version || '')
    .trim()
    .toLowerCase()
  if (!value) return false
  return /^[0-9a-f]{7,}$/.test(value)
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function downloadToFile(url, destination, timeoutMs) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const result = spawnSync(
    'curl',
    [
      '-sS',
      '-L',
      '--fail',
      '--max-time',
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '-H',
      'Cache-Control: no-cache',
      '-o',
      destination,
      url,
    ],
    {
      encoding: 'utf8',
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`curl download failed for ${url}: ${String(result.stderr || '').trim()}`)
  }
}

function requestJsonWithCurl(
  url,
  { method = 'GET', headers = {}, body = null, timeoutMs = 12000 } = {},
) {
  const args = [
    '-sS',
    '-L',
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    '--write-out',
    '\n%{http_code}',
  ]

  if (method && method !== 'GET') {
    args.push('-X', method)
  }

  for (const [key, value] of Object.entries(headers)) {
    args.push('-H', `${key}: ${value}`)
  }

  if (body !== null && body !== undefined) {
    args.push('--data-binary', typeof body === 'string' ? body : JSON.stringify(body))
  }

  args.push(url)

  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`curl request failed for ${url}: ${String(result.stderr || '').trim()}`)
  }

  const output = String(result.stdout || '')
  const splitIndex = output.lastIndexOf('\n')
  const text = splitIndex >= 0 ? output.slice(0, splitIndex) : output
  const statusRaw = splitIndex >= 0 ? output.slice(splitIndex + 1).trim() : ''
  const status = Number.parseInt(statusRaw, 10)

  if (!Number.isFinite(status)) {
    throw new Error(`curl response missing status for ${url}`)
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    text,
    json() {
      return text ? JSON.parse(text) : null
    },
  }
}

async function listBucketPrefix({ supabaseUrl, bucket, prefix, serviceKey, timeoutMs }) {
  const response = requestJsonWithCurl(
    `${normalizeUrl(supabaseUrl)}/storage/v1/object/list/${normalizePathFragment(bucket)}`,
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      }),
      timeoutMs,
    },
  )

  if (!response.ok) {
    throw new Error(`failed to list bucket ${bucket}/${prefix || ''} (${response.status})`)
  }

  return response.json()
}

async function copyFile(src, dest, mode = null) {
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.copyFile(src, dest)
  if (mode !== null) {
    await fsp.chmod(dest, mode)
  }
}

async function copyTreeContents(srcDir, destDir, options = {}) {
  const { deleteMissing = true, excludes = [] } = options

  await fsp.mkdir(destDir, { recursive: true })

  const rsyncArgs = ['-a']
  if (deleteMissing) rsyncArgs.push('--delete')

  for (const exclude of excludes) {
    rsyncArgs.push('--exclude', exclude)
  }

  rsyncArgs.push(`${srcDir}/`, `${destDir}/`)
  run('rsync', rsyncArgs)
}

function decryptPackage(encPath) {
  const keyHex = String(process.env.GAME_PACKAGE_KEY_HEX || '').trim()
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    fail('GAME_PACKAGE_KEY_HEX must be a 64-character hex string')
  }

  const payload = fs.readFileSync(encPath)
  const ivLength = 12
  const tagLength = 16

  if (payload.length <= ivLength + tagLength) {
    fail(`encrypted payload too short: ${encPath}`)
  }

  const key = Buffer.from(keyHex, 'hex')
  const iv = payload.subarray(0, ivLength)
  const tag = payload.subarray(ivLength, ivLength + tagLength)
  const encrypted = payload.subarray(ivLength + tagLength)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()])
  const tarballPath = encPath.replace(/\.enc$/i, '.tar.gz')
  fs.writeFileSync(tarballPath, plain)
  return tarballPath
}

async function installEtcPayload(installDir) {
  const etcSource = path.join(installDir, 'os', 'etc')
  if (!(await fileExists(etcSource))) return

  console.log('[arcade-shell-updater] installing /etc payload')
  const entries = await fsp.readdir(etcSource, { recursive: true })

  for (const entry of entries) {
    const sourcePath = path.join(etcSource, entry)
    const stat = await fsp.stat(sourcePath)
    if (!stat.isFile()) continue

    const targetPath = path.join('/etc', entry)
    await copyFile(sourcePath, targetPath)
  }
}

async function installSystemdUnits(installDir, systemdTarget) {
  const systemdSource = path.join(installDir, 'os', 'systemd')
  if (!(await fileExists(systemdSource))) return

  console.log('[arcade-shell-updater] installing systemd units')
  const entries = await fsp.readdir(systemdSource)

  for (const entry of entries) {
    if (
      !entry.endsWith('.service') &&
      !entry.endsWith('.socket') &&
      !entry.endsWith('.timer') &&
      !entry.endsWith('.path')
    ) {
      continue
    }

    const sourceFile = path.join(systemdSource, entry)
    const targetFile = path.join(systemdTarget, entry)
    await copyFile(sourceFile, targetFile)
  }
}

async function installManagedBootAndSessionFiles(installDir) {
  const osDir = path.join(installDir, 'os')
  const bootDir = process.env.ARCADE_SHELL_BOOT_DIR || '/boot/firmware'
  const userHome = process.env.ARCADE_SHELL_USER_HOME || '/home/arcade1'
  const userName = process.env.ARCADE_SHELL_USER || path.basename(userHome) || 'arcade1'

  const xinitSource = path.join(osDir, '.xinitrc')
  const xinitTarget = path.join(userHome, '.xinitrc')
  if (await fileExists(xinitSource)) {
    console.log(`[arcade-shell-updater] installing session file ${xinitTarget}`)
    await copyFile(xinitSource, xinitTarget, 0o755)
    try {
      run('chown', [`${userName}:${userName}`, xinitTarget])
    } catch (error) {
      console.warn(
        `[arcade-shell-updater] failed to chown ${xinitTarget}: ${error.message || error}`,
      )
    }
  }

  const bootFiles = [
    ['config.txt', path.join(bootDir, 'config.txt')],
    ['cmdline.txt', path.join(bootDir, 'cmdline.txt')],
  ]

  for (const [name, targetPath] of bootFiles) {
    const sourcePath = path.join(osDir, 'boot', name)
    if (!(await fileExists(sourcePath))) continue
    console.log(`[arcade-shell-updater] installing boot file ${targetPath}`)
    await copyFile(sourcePath, targetPath, 0o644)
  }
}

async function installRuntimePayload(stagingDir, installDir) {
  const uiDistSource = path.join(stagingDir, 'apps', 'ui', 'dist')
  const serviceSource = path.join(stagingDir, 'apps', 'service')
  const binSource = path.join(stagingDir, 'apps', 'bin')
  const osSource = path.join(stagingDir, 'os')
  const romsSource = path.join(stagingDir, 'roms')

  if (await fileExists(uiDistSource)) {
    console.log('[arcade-shell-updater] installing UI dist')
    await copyTreeContents(uiDistSource, path.join(installDir, 'ui', 'dist'))
  }

  if (await fileExists(serviceSource)) {
    console.log('[arcade-shell-updater] installing service payload')
    await copyTreeContents(serviceSource, path.join(installDir, 'service'))
  }

  if (await fileExists(binSource)) {
    console.log('[arcade-shell-updater] installing bin payload')
    await copyTreeContents(binSource, path.join(installDir, 'bin'))
  }

  if (await fileExists(osSource)) {
    console.log('[arcade-shell-updater] installing os payload')
    await copyTreeContents(osSource, path.join(installDir, 'os'), {
      excludes: ['.env.arcade-service'],
    })

    const osBinDir = path.join(installDir, 'os', 'bin')
    if (await fileExists(osBinDir)) {
      run('sh', ['-lc', `find '${osBinDir}' -type f -name '*.sh' -exec chmod 0755 {} +`])
    }
  }

  if (await fileExists(romsSource)) {
    console.log('[arcade-shell-updater] installing roms payload')
    await copyTreeContents(romsSource, path.join(installDir, 'roms'))
  }
}

function getRomManifestEntries(manifest, supabaseUrl, bucket) {
  const sourceEntries = Array.isArray(manifest?.files)
    ? manifest.files
    : Array.isArray(manifest?.roms)
      ? manifest.roms
      : []

  return sourceEntries
    .map((entry, index) => {
      const raw = typeof entry === 'string' ? { path: entry } : entry
      const relativePath = sanitizeRelativePath(raw?.path || raw?.key || raw?.name || '')
      if (!relativePath) return null

      const displayName = String(raw?.title || raw?.label || raw?.display_name || '').trim()
      const checksum = String(raw?.sha256 || raw?.checksum || '').trim()
      const url =
        String(raw?.url || '').trim() || toPublicStorageUrl(supabaseUrl, bucket, relativePath)

      return {
        index,
        relativePath,
        displayName: displayName || path.basename(relativePath),
        checksum,
        url,
      }
    })
    .filter(Boolean)
}

async function listBucketRomEntries({ supabaseUrl, bucket, serviceKey, timeoutMs }) {
  const files = []
  const queue = ['']

  while (queue.length > 0) {
    const prefix = queue.shift()
    const entries = await listBucketPrefix({
      supabaseUrl,
      bucket,
      prefix,
      serviceKey,
      timeoutMs,
    })

    for (const entry of entries) {
      const name = String(entry?.name || '').trim()
      if (!name) continue

      const relativePath = sanitizeRelativePath(prefix ? `${prefix}/${name}` : name)
      const isFolder = !entry?.id && !entry?.metadata

      if (isFolder) {
        queue.push(relativePath)
        continue
      }

      if (name === '.emptyFolderPlaceholder') continue

      files.push({
        relativePath,
        displayName: path.basename(relativePath),
        checksum: '',
        url: toPublicStorageUrl(supabaseUrl, bucket, relativePath),
      })
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function syncPublicRoms({ supabaseUrl, installDir, networkTimeoutMs }) {
  const romSyncEnabled = String(process.env.ARCADE_ROMS_AUTO_SYNC || '1') === '1'
  if (!romSyncEnabled) return

  const romBucket = process.env.ARCADE_ROMS_BUCKET || 'roms'
  const manifestPath = process.env.ARCADE_ROMS_MANIFEST_PATH || 'manifest.json'
  const romsDir = process.env.ARCADE_ROMS_DIR || path.join(installDir, 'roms')
  const verifyDownloads = String(process.env.ARCADE_ROMS_VERIFY_DOWNLOADS || '1') === '1'
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const manifestUrl =
    String(process.env.ARCADE_ROMS_MANIFEST_URL || '').trim() ||
    toPublicStorageUrl(supabaseUrl, romBucket, manifestPath)

  emitStatus({ phase: 'roms-check', label: 'Fetching games', detail: null })
  console.log(
    `[arcade-shell-updater] fetching ROM manifest from ${manifestUrl} (timeout ${networkTimeoutMs}ms)`,
  )

  let response
  try {
    response = requestJsonWithCurl(manifestUrl, {
      headers: { 'Cache-Control': 'no-cache' },
      timeoutMs: networkTimeoutMs,
    })
  } catch (error) {
    if (isNetworkError(error)) {
      console.log(
        `[arcade-shell-updater] ROM manifest unavailable; skipping ROM sync (${error.message})`,
      )
      return
    }
    throw error
  }

  let entries = []
  if (response.ok) {
    const manifest = response.json()
    entries = getRomManifestEntries(manifest, supabaseUrl, romBucket)
  } else if (response.status >= 400 && response.status < 500) {
    if (!serviceKey) {
      console.log(
        '[arcade-shell-updater] ROM manifest missing and SUPABASE_SERVICE_ROLE_KEY unavailable; skipping ROM sync',
      )
      return
    }
    console.log(
      `[arcade-shell-updater] ROM manifest unavailable (${response.status}); listing bucket contents instead`,
    )
    entries = await listBucketRomEntries({
      supabaseUrl,
      bucket: romBucket,
      serviceKey,
      timeoutMs: networkTimeoutMs,
    })
  } else if (response.status >= 500 || response.status === 408 || response.status === 429) {
    console.log(
      `[arcade-shell-updater] ROM manifest unavailable (${response.status}); skipping ROM sync`,
    )
    return
  } else {
    throw new Error(`failed to fetch ROM manifest (${response.status})`)
  }

  if (entries.length === 0) {
    console.log('[arcade-shell-updater] ROM manifest is empty; nothing to sync')
    emitStatus({
      phase: 'roms-complete',
      label: 'Games ready',
      detail: null,
      completed: 0,
      total: 0,
    })
    return
  }

  await fsp.mkdir(romsDir, { recursive: true })

  let presentCount = 0
  let downloadedCount = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const targetPath = path.join(romsDir, entry.relativePath)

    if (await fileExists(targetPath)) {
      presentCount += 1
      continue
    }

    emitStatus({
      phase: 'rom-download',
      label: 'Fetching games',
      detail: entry.displayName,
      completed: presentCount + downloadedCount,
      total: entries.length,
    })
    console.log(
      `[arcade-shell-updater] downloading ROM ${index + 1}/${entries.length}: ${entry.relativePath}`,
    )

    await downloadToFile(entry.url, targetPath, networkTimeoutMs)

    if (verifyDownloads && entry.checksum) {
      const actualChecksum = await sha256(targetPath)
      if (actualChecksum !== entry.checksum) {
        await fsp.rm(targetPath, { force: true })
        throw new Error(
          `ROM checksum mismatch for ${entry.relativePath}: expected ${entry.checksum} got ${actualChecksum}`,
        )
      }
    }

    downloadedCount += 1
  }

  const detail =
    downloadedCount > 0
      ? `${downloadedCount} game${downloadedCount === 1 ? '' : 's'} downloaded`
      : `${presentCount} game${presentCount === 1 ? '' : 's'} already present`

  console.log(
    `[arcade-shell-updater] ROM sync complete: downloaded ${downloadedCount}, present ${presentCount}`,
  )
  emitStatus({
    phase: 'roms-complete',
    label: 'Games ready',
    detail,
    completed: presentCount + downloadedCount,
    total: entries.length,
  })
}

async function maybeInstallShellUpdate({
  supabaseUrl,
  installDir,
  versionFile,
  systemdTarget,
  updaterDest,
  metadataTimeoutMs,
  packageDownloadTimeoutMs,
}) {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'game-packages'
  const metadataPath = process.env.ARCADE_SHELL_METADATA_PATH || 'arcade-shell/latest.json'
  const downloadDir =
    process.env.ARCADE_SHELL_DOWNLOAD_DIR || path.join(os.tmpdir(), 'arcade-shell-download')
  const metadataUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${metadataPath}`

  emitStatus({ phase: 'shell-check', label: 'Checking for updates', detail: null })
  console.log(
    `[arcade-shell-updater] fetching metadata from ${metadataUrl} (timeout ${metadataTimeoutMs}ms)`,
  )

  let metadataResponse
  try {
    metadataResponse = requestJsonWithCurl(metadataUrl, {
      headers: { 'Cache-Control': 'no-cache' },
      timeoutMs: metadataTimeoutMs,
    })
  } catch (error) {
    if (isNetworkError(error)) {
      console.log(
        `[arcade-shell-updater] metadata fetch unavailable; skipping update (${error.message})`,
      )
      return false
    }
    throw error
  }

  if (!metadataResponse.ok) {
    if (
      metadataResponse.status >= 500 ||
      metadataResponse.status === 408 ||
      metadataResponse.status === 429
    ) {
      console.log(
        `[arcade-shell-updater] metadata endpoint unavailable (${metadataResponse.status}); skipping update`,
      )
      return false
    }
    throw new Error(`failed to fetch metadata (${metadataResponse.status})`)
  }

  const metadata = metadataResponse.json()
  const requiredVersion = String(metadata.version || '').trim()
  const packageUrl = String(metadata.package_url || metadata.packageUrl || '').trim()
  const expectedChecksum = String(metadata.checksum || metadata.sha256 || '').trim()

  if (!requiredVersion || !packageUrl) {
    throw new Error('metadata is missing version or package_url')
  }

  let installedVersion = ''
  if (await fileExists(versionFile)) {
    installedVersion = String(await fsp.readFile(versionFile, 'utf8')).trim()
  }

  if (!forceUpdate && isUnmanagedLocalBuild(installedVersion)) {
    console.log(
      `[arcade-shell-updater] unmanaged local build detected (${installedVersion}); skipping update check`,
    )
    return false
  }

  if (!forceUpdate && installedVersion === requiredVersion) {
    console.log(`[arcade-shell-updater] already at version ${requiredVersion}`)
    return false
  }

  emitStatus({ phase: 'shell-download', label: 'Updating system', detail: requiredVersion })
  console.log(
    `[arcade-shell-updater] installing version ${requiredVersion} (current: ${installedVersion || 'none'})`,
  )

  await fsp.mkdir(downloadDir, { recursive: true })

  const tarballName = path.basename(new URL(packageUrl).pathname)
  const encPath = path.join(downloadDir, tarballName)

  try {
    await downloadToFile(packageUrl, encPath, packageDownloadTimeoutMs)
  } catch (error) {
    if (isNetworkError(error)) {
      console.log(
        `[arcade-shell-updater] package download unavailable; skipping update (${error.message})`,
      )
      return false
    }
    throw error
  }

  if (expectedChecksum) {
    const actualChecksum = await sha256(encPath)
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`checksum mismatch: expected ${expectedChecksum} got ${actualChecksum}`)
    }
  }

  emitStatus({ phase: 'shell-install', label: 'Installing update', detail: requiredVersion })
  const decryptedTarball = decryptPackage(encPath)
  const extractDir = path.join(downloadDir, `extract-${requiredVersion}-${Date.now()}`)

  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.mkdir(extractDir, { recursive: true })

  run('tar', ['-xzf', decryptedTarball, '-C', extractDir])

  await installRuntimePayload(extractDir, installDir)
  await maybeBuildRemoteHelper(installDir)
  await installEtcPayload(installDir)
  await installManagedBootAndSessionFiles(installDir)
  await installSystemdUnits(extractDir, systemdTarget)
  ensureSystemFonts()
  try {
    run('systemctl', ['restart', 'NetworkManager'])

    run('sh', [
      '-lc',
      `
    nmcli -t -f NAME,TYPE connection show | awk -F: '$2=="wifi"{print $1}' | while read name; do
      nmcli connection modify "$name" wifi.powersave 2 || true
    done

    iw dev wlan0 set power_save off 2>/dev/null || true
  `,
    ])
  } catch (e) {
    console.warn('[arcade-shell-updater] failed to configure wifi powersave:', e.message)
  }
  const envFilePath = path.join(installDir, 'os', '.env.arcade-service')
  if (await fileExists(envFilePath)) {
    console.log(
      '[arcade-shell-updater] preserved local env file at /opt/arcade/os/.env.arcade-service',
    )
  }

  const updaterSource = path.join(extractDir, 'scripts', 'arcade-shell-updater.mjs')
  if (await fileExists(updaterSource)) {
    await copyFile(updaterSource, updaterDest, 0o755)
  }

  run('systemctl', ['daemon-reload'])

  await fsp.mkdir(path.dirname(versionFile), { recursive: true })
  await fsp.writeFile(versionFile, `${requiredVersion}\n`, 'utf8')

  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.rm(decryptedTarball, { force: true })
  await fsp.rm(encPath, { force: true })

  console.log(`[arcade-shell-updater] installed version ${requiredVersion}`)
  emitStatus({ phase: 'shell-complete', label: 'System up to date', detail: requiredVersion })
  return true
}

async function maybeBuildRemoteHelper(installDir) {
  const helperSource = path.join(installDir, 'bin', 'uinput-helper.c')
  const helperTarget = path.join(installDir, 'bin', 'uinput-helper')
  const overlaySource = path.join(installDir, 'bin', 'arcade-retro-overlay.c')
  const overlayTarget = path.join(installDir, 'bin', 'arcade-retro-overlay')

  const compilerCandidates = ['cc', 'gcc', 'clang']
  const compiler = compilerCandidates.find(name => {
    const result = spawnSync('sh', ['-lc', `command -v ${name} >/dev/null 2>&1`], {
      stdio: 'ignore',
    })
    return result.status === 0
  })

  if (!compiler) {
    throw new Error('no C compiler found for native helpers (need cc, gcc, or clang)')
  }

  const buildNativeBinary = async (sourcePath, targetPath, preArgs, postArgs, label) => {
    const tmpTarget = `${targetPath}.tmp`
    await fsp.rm(tmpTarget, { force: true })

    try {
      run(compiler, [...preArgs, '-o', tmpTarget, sourcePath, ...postArgs])
      const stats = await fsp.stat(tmpTarget)
      if (!stats.isFile() || stats.size <= 0) {
        throw new Error(`${label} build produced empty output`)
      }
      await fsp.chmod(tmpTarget, 0o755)
      await fsp.rename(tmpTarget, targetPath)
    } catch (error) {
      await fsp.rm(tmpTarget, { force: true }).catch(() => {})
      throw error
    }
  }

  if (await fileExists(helperSource)) {
    console.log('[arcade-shell-updater] building uinput-helper')
    await buildNativeBinary(
      helperSource,
      helperTarget,
      ['-O2', '-s', '-Wall', '-Wextra'],
      [],
      'uinput-helper',
    )
  }

  if (await fileExists(overlaySource)) {
    console.log('[arcade-shell-updater] building native retro overlay')
    await buildNativeBinary(
      overlaySource,
      overlayTarget,
      ['-O2', '-s', '-Wall', '-Wextra'],
      ['-lX11', '-lXext'],
      'arcade-retro-overlay',
    )
  }
}

async function maybeRepairNativeHelpers(installDir) {
  const helperSource = path.join(installDir, 'bin', 'uinput-helper.c')
  const helperTarget = path.join(installDir, 'bin', 'uinput-helper')
  const overlaySource = path.join(installDir, 'bin', 'arcade-retro-overlay.c')
  const overlayTarget = path.join(installDir, 'bin', 'arcade-retro-overlay')

  const hasNonEmptyFile = async targetPath => {
    try {
      const stats = await fsp.stat(targetPath)
      return stats.isFile() && stats.size > 0
    } catch {
      return false
    }
  }

  const needsHelperRepair =
    (await fileExists(helperSource)) && !(await hasNonEmptyFile(helperTarget))
  const needsOverlayRepair =
    (await fileExists(overlaySource)) && !(await hasNonEmptyFile(overlayTarget))

  if (!needsHelperRepair && !needsOverlayRepair) return false

  console.log('[arcade-shell-updater] repairing missing native helpers')
  await maybeBuildRemoteHelper(installDir)
  return true
}

async function waitForCabinetIdle() {
  const startDelayMs = Math.max(0, parseEnvInt('ARCADE_SHELL_START_DELAY_MS', 45000))
  const idleWaitMs = Math.max(0, parseEnvInt('ARCADE_SHELL_IDLE_WAIT_MS', 180000))
  const pollMs = Math.max(1000, parseEnvInt('ARCADE_SHELL_IDLE_POLL_MS', 5000))
  const idleCheckUrl =
    process.env.ARCADE_SHELL_IDLE_CHECK_URL || 'http://127.0.0.1:5174/arcade-life/overlay-state'

  if (startDelayMs > 0) {
    emitStatus({
      phase: 'startup-delay',
      label: 'Waiting before update check',
      detail: `${Math.round(startDelayMs / 1000)}s boot settle`,
    })
    await sleep(startDelayMs)
  }

  if (idleWaitMs <= 0) return

  const deadline = Date.now() + idleWaitMs

  while (Date.now() < deadline) {
    try {
      const response = requestJsonWithCurl(idleCheckUrl, { timeoutMs: 1500 })
      if (response.ok) {
        const payload = response.json() || {}
        if (payload.retroarchActive !== true && payload.active !== true) {
          return
        }

        emitStatus({
          phase: 'idle-wait',
          label: 'Waiting for cabinet idle',
          detail: payload.gameName || payload.gameId || 'RetroArch active',
        })
      } else {
        emitStatus({
          phase: 'idle-wait',
          label: 'Waiting for cabinet idle',
          detail: `overlay-state ${response.status}`,
        })
      }
    } catch (error) {
      emitStatus({
        phase: 'idle-wait',
        label: 'Waiting for cabinet idle',
        detail: isNetworkError(error) ? 'input service not ready' : 'retrying idle probe',
      })
    }

    await sleep(pollMs)
  }

  console.log('[arcade-shell-updater] idle wait expired; continuing with update check')
}

async function main() {
  const autoUpdateEnabled = String(process.env.ARCADE_SHELL_AUTO_UPDATE || '0') === '1'
  if (!autoUpdateEnabled && !forceUpdate && !manualCheck) {
    console.log('[arcade-shell-updater] auto-update disabled; skipping boot check')
    return
  }

  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL)
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL must be set for the updater')
  }
  const installDir = process.env.ARCADE_SHELL_INSTALL_DIR || '/opt/arcade'
  const versionFile =
    process.env.ARCADE_SHELL_VERSION_FILE || path.join(installDir, 'os', '.arcade-shell-version')
  const systemdTarget = process.env.ARCADE_SHELL_SYSTEMD_DIR || '/etc/systemd/system'
  const updaterDest =
    process.env.ARCADE_SHELL_UPDATER_DEST || '/usr/local/bin/arcade-shell-updater.mjs'
  const metadataTimeoutMs = Math.max(
    1000,
    Number.parseInt(process.env.ARCADE_SHELL_METADATA_TIMEOUT_MS || '4000', 10) || 4000,
  )

  const packageDownloadTimeoutMs = Math.max(
    5000,
    Number.parseInt(process.env.ARCADE_SHELL_PACKAGE_TIMEOUT_MS || '30000', 10) || 30000,
  )

  const networkTimeoutMs = metadataTimeoutMs
  const rebootOnUpdate = String(process.env.ARCADE_SHELL_REBOOT_ON_UPDATE || '0') === '1'
  const serviceNames = String(
    process.env.ARCADE_SHELL_SERVICES ||
      'arcade-input.service,arcade-ui.service,arcade-watchdog.service',
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  if (!manualCheck && !forceUpdate) {
    await waitForCabinetIdle()
  }

  const shellUpdated = await maybeInstallShellUpdate({
    supabaseUrl,
    installDir,
    versionFile,
    systemdTarget,
    updaterDest,
    metadataTimeoutMs,
    packageDownloadTimeoutMs,
  })
  const helpersRepaired = await maybeRepairNativeHelpers(installDir)

  if ((shellUpdated || helpersRepaired) && serviceNames.length > 0) {
    emitStatus({
      phase: 'shell-restart',
      label: 'Restarting services',
      detail: serviceNames.join(', '),
    })
    restartManagedServices(serviceNames)
  }

  await syncPublicRoms({ supabaseUrl, installDir, networkTimeoutMs })

  if (rebootOnUpdate && shellUpdated) {
    console.log('[arcade-shell-updater] update installed; scheduling reboot')
    run('systemctl', ['--no-block', 'reboot'])
  }
}

main().catch(error => {
  console.error('[arcade-shell-updater] failed', error)
  process.exit(1)
})
