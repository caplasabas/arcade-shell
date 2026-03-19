#!/usr/bin/env node
import { createDecipheriv, createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const forceUpdate = args.includes('--force')
const manualCheck = args.includes('--manual') || args.includes('--check-now')

function fail(message) {
  throw new Error(message)
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

function isAbortError(error) {
  return error?.name === 'AbortError'
}

function isNetworkError(error) {
  if (isAbortError(error)) return true
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('fetch failed') ||
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
  const value = String(version || '').trim().toLowerCase()
  if (!value) return false
  if (value.includes('dirty')) return true
  return /^[0-9a-f]{7,}$/.test(value)
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
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
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'Cache-Control': 'no-cache',
      },
    },
    timeoutMs,
  )

  if (!response.ok) {
    throw new Error(`failed to download ${url} (${response.status})`)
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const fileStream = fs.createWriteStream(destination)
  await pipeline(response.body, fileStream)
}

async function listBucketPrefix({ supabaseUrl, bucket, prefix, serviceKey, timeoutMs }) {
  const response = await fetchWithTimeout(
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
    },
    timeoutMs,
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
      const url = String(raw?.url || '').trim() || toPublicStorageUrl(supabaseUrl, bucket, relativePath)

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
    response = await fetchWithTimeout(
      manifestUrl,
      {
        headers: { 'Cache-Control': 'no-cache' },
      },
      networkTimeoutMs,
    )
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
    const manifest = await response.json()
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
    emitStatus({ phase: 'roms-complete', label: 'Games ready', detail: null, completed: 0, total: 0 })
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
  networkTimeoutMs,
}) {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'game-packages'
  const metadataPath = process.env.ARCADE_SHELL_METADATA_PATH || 'arcade-shell/latest.json'
  const downloadDir =
    process.env.ARCADE_SHELL_DOWNLOAD_DIR || path.join(os.tmpdir(), 'arcade-shell-download')
  const metadataUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${metadataPath}`

  emitStatus({ phase: 'shell-check', label: 'Checking for updates', detail: null })
  console.log(
    `[arcade-shell-updater] fetching metadata from ${metadataUrl} (timeout ${networkTimeoutMs}ms)`,
  )

  let metadataResponse
  try {
    metadataResponse = await fetchWithTimeout(
      metadataUrl,
      {
        headers: { 'Cache-Control': 'no-cache' },
      },
      networkTimeoutMs,
    )
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

  const metadata = await metadataResponse.json()
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
    await downloadToFile(packageUrl, encPath, networkTimeoutMs)
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

  if (!(await fileExists(helperSource))) return

  console.log('[arcade-shell-updater] building uinput-helper')
  const compilerCandidates = ['cc', 'gcc', 'clang']
  const compiler = compilerCandidates.find(name => {
    const result = spawnSync('sh', ['-lc', `command -v ${name} >/dev/null 2>&1`], {
      stdio: 'ignore',
    })
    return result.status === 0
  })

  if (!compiler) {
    throw new Error('no C compiler found for uinput-helper (need cc, gcc, or clang)')
  }

  run(compiler, ['-O2', '-s', '-Wall', '-Wextra', '-o', helperTarget, helperSource])
  await fsp.chmod(helperTarget, 0o755)
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
  const networkTimeoutMs = Math.max(
    1000,
    Number.parseInt(process.env.ARCADE_SHELL_NETWORK_TIMEOUT_MS || '12000', 10) || 12000,
  )
  const rebootOnUpdate = String(process.env.ARCADE_SHELL_REBOOT_ON_UPDATE || '0') === '1'
  const serviceNames = String(
    process.env.ARCADE_SHELL_SERVICES || 'arcade-input.service,arcade-ui.service',
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const shellUpdated = await maybeInstallShellUpdate({
    supabaseUrl,
    installDir,
    versionFile,
    systemdTarget,
    updaterDest,
    networkTimeoutMs,
  })

  if (serviceNames.length > 0) {
    console.log(
      `[arcade-shell-updater] skipping in-process restarts for: ${serviceNames.join(', ')}`,
    )
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
