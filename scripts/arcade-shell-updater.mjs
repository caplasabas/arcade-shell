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

function fail(message) {
  throw new Error(message)
}

function normalizeUrl(base) {
  return String(base || '')
    .trim()
    .replace(/\/+$/, '')
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

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function downloadToFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
    },
  })

  if (!response.ok) {
    throw new Error(`failed to download ${url} (${response.status})`)
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const fileStream = fs.createWriteStream(destination)
  await pipeline(response.body, fileStream)
}

async function copyFile(src, dest, mode = null) {
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.copyFile(src, dest)
  if (mode !== null) {
    await fsp.chmod(dest, mode)
  }
}

// Helper to copy directory trees using rsync, with options for delete and excludes
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

async function maybeBuildRemoteHelper(installDir) {
  const helperSource = path.join(installDir, 'apps', 'bin', 'uinput-helper.c')
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
  const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL)
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL must be set for the updater')
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'game-packages'
  const metadataPath = process.env.ARCADE_SHELL_METADATA_PATH || 'arcade-shell/latest.json'
  const downloadDir =
    process.env.ARCADE_SHELL_DOWNLOAD_DIR || path.join(os.tmpdir(), 'arcade-shell-download')
  const installDir = process.env.ARCADE_SHELL_INSTALL_DIR || '/opt/arcade'
  const versionFile =
    process.env.ARCADE_SHELL_VERSION_FILE || path.join(installDir, 'os', '.arcade-shell-version')
  const systemdTarget = process.env.ARCADE_SHELL_SYSTEMD_DIR || '/etc/systemd/system'
  const updaterDest =
    process.env.ARCADE_SHELL_UPDATER_DEST || '/usr/local/bin/arcade-shell-updater.mjs'
  const serviceNames = String(
    process.env.ARCADE_SHELL_SERVICES || 'arcade-input.service,arcade-ui.service',
  )
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  const metadataUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${metadataPath}`

  console.log(`[arcade-shell-updater] fetching metadata from ${metadataUrl}`)
  const metadataResponse = await fetch(metadataUrl, {
    headers: { 'Cache-Control': 'no-cache' },
  })

  if (!metadataResponse.ok) {
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

  if (!forceUpdate && installedVersion === requiredVersion) {
    console.log(`[arcade-shell-updater] already at version ${requiredVersion}`)
    return
  }

  console.log(
    `[arcade-shell-updater] installing version ${requiredVersion} (current: ${installedVersion || 'none'})`,
  )

  await fsp.mkdir(downloadDir, { recursive: true })

  const tarballName = path.basename(new URL(packageUrl).pathname)
  const encPath = path.join(downloadDir, tarballName)

  await downloadToFile(packageUrl, encPath)

  if (expectedChecksum) {
    const actualChecksum = await sha256(encPath)
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`checksum mismatch: expected ${expectedChecksum} got ${actualChecksum}`)
    }
  }

  const decryptedTarball = decryptPackage(encPath)
  const extractDir = path.join(downloadDir, `extract-${requiredVersion}-${Date.now()}`)

  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.mkdir(extractDir, { recursive: true })

  run('tar', ['-xzf', decryptedTarball, '-C', extractDir])

  await installRuntimePayload(extractDir, installDir)
  await maybeBuildRemoteHelper(installDir)
  await installEtcPayload(installDir)
  await installSystemdUnits(installDir, systemdTarget)

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

  if (serviceNames.length > 0) {
    console.log(
      `[arcade-shell-updater] skipping in-process restarts for: ${serviceNames.join(', ')}`,
    )
  }
  await fsp.mkdir(path.dirname(versionFile), { recursive: true })
  await fsp.writeFile(versionFile, `${requiredVersion}\n`, 'utf8')

  await fsp.rm(extractDir, { recursive: true, force: true })
  await fsp.rm(decryptedTarball, { force: true })
  await fsp.rm(encPath, { force: true })

  console.log(`[arcade-shell-updater] installed version ${requiredVersion}`)
}

main().catch(error => {
  console.error('[arcade-shell-updater] failed', error)
  process.exit(1)
})
