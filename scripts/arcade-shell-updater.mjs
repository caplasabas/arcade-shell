#!/usr/bin/env node
import { createDecipheriv, createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const args = process.argv.slice(2)
const forceUpdate = args.includes('--force')

function normalizeUrl(base) {
  return base.replace(/\/+$/, '')
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(' ')}`)
  }
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
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

async function copyFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.copyFile(src, dest)
}

function decryptPackage(encPath) {
  const keyHex = process.env.GAME_PACKAGE_KEY_HEX
  if (!keyHex || keyHex.length !== 64) {
    fail('GAME_PACKAGE_KEY_HEX (64 hex chars) must be set for updater decryption')
  }

  const payload = fs.readFileSync(encPath)
  const ivLength = 12
  const tagLength = 16
  if (payload.length <= ivLength + tagLength) {
    fail(`encrypted payload too short: ${encPath}`)
  }

  const key = Buffer.from(keyHex, 'hex')
  const iv = payload.slice(0, ivLength)
  const tag = payload.slice(ivLength, ivLength + tagLength)
  const encrypted = payload.slice(ivLength + tagLength)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()])
  const tarballPath = encPath.replace(/\.enc$/, '.tar.gz')
  fs.writeFileSync(tarballPath, plain)
  return tarballPath
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL must be set for the updater')
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'game-packages'
  const metadataPath = process.env.ARCADE_SHELL_METADATA_PATH || 'arcade-shell/latest.json'
  const downloadDir =
    process.env.ARCADE_SHELL_DOWNLOAD_DIR || path.join(os.homedir(), '.cache', 'arcade-shell')
  const installDir =
    process.env.ARCADE_SHELL_INSTALL_DIR || path.join(os.homedir(), 'arcade')
  const versionFile = process.env.ARCADE_SHELL_VERSION_FILE || path.join(installDir, '.installed-version')
  const xinitrcPath =
    process.env.ARCADE_SHELL_XINITRC_PATH || path.join(os.homedir(), '.xinitrc')
  const bootConfigPath = process.env.ARCADE_SHELL_BOOT_CONFIG_PATH || '/boot/config.txt'
  const systemdTarget = process.env.ARCADE_SHELL_SYSTEMD_DIR || '/etc/systemd/system'
  const updaterDest = process.env.ARCADE_SHELL_UPDATER_DEST || '/usr/local/bin/arcade-shell-updater.mjs'
  const serviceNames =
    (process.env.ARCADE_SHELL_SERVICES || 'arcade-input.service,arcade-ui.service')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

  const cleanSupabaseUrl = normalizeUrl(supabaseUrl)
  const metadataUrl = `${cleanSupabaseUrl}/storage/v1/object/public/${bucket}/${metadataPath}`

  console.log(`[arcade-shell-updater] fetching metadata from ${metadataUrl}`)
  const metadataResponse = await fetch(metadataUrl, { headers: { 'Cache-Control': 'no-cache' } })
  if (!metadataResponse.ok) {
    throw new Error(`failed to fetch metadata (${metadataResponse.status})`)
  }

  const metadata = await metadataResponse.json()
  const requiredVersion = metadata.version
  const packageUrl = metadata.package_url || metadata.packageUrl
  const expectedChecksum = metadata.checksum || metadata.sha256
  if (!requiredVersion || !packageUrl) {
    throw new Error('metadata is missing version or package_url')
  }

  let installedVersion = ''
  if (await fileExists(versionFile)) {
    installedVersion = (await fsp.readFile(versionFile, 'utf8')).trim()
  }

  if (!forceUpdate && installedVersion === requiredVersion) {
    console.log(`[arcade-shell-updater] already at version ${requiredVersion}`)
    return
  }

  console.log(`[arcade-shell-updater] installing version ${requiredVersion} (current: ${installedVersion || 'none'})`)

  const tarballName = path.basename(new URL(packageUrl).pathname)
  const tarballPath = path.join(downloadDir, tarballName)
  await downloadToFile(packageUrl, tarballPath)

  if (expectedChecksum) {
    const actualChecksum = await sha256(tarballPath)
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`checksum mismatch: expected ${expectedChecksum} got ${actualChecksum}`)
    }
  }

  await fsp.rm(installDir, { recursive: true, force: true })
  await fsp.mkdir(installDir, { recursive: true })

  const decryptedTarball = decryptPackage(tarballPath)
  run('tar', ['-xzf', decryptedTarball, '-C', installDir])
  await fsp.rm(decryptedTarball, { force: true })
  await fsp.rm(tarballPath, { force: true })

  const servicePath = path.join(installDir, 'apps', 'service')
  if (await fileExists(path.join(servicePath, 'package.json'))) {
    run('npm', ['install', '--omit=dev'], { cwd: servicePath })
  }

  const xinitSource = path.join(installDir, 'os', '.xinitrc')
  if (await fileExists(xinitSource)) {
    await copyFile(xinitSource, xinitrcPath)
  }

  const bootSource = path.join(installDir, 'os', 'boot', 'config.txt')
  if (await fileExists(bootSource)) {
    await copyFile(bootSource, bootConfigPath)
  }

  const systemdSource = path.join(installDir, 'os', 'systemd')
  if (await fileExists(systemdSource)) {
    const entries = await fsp.readdir(systemdSource)
    for (const entry of entries) {
      const sourceFile = path.join(systemdSource, entry)
      const targetFile = path.join(systemdTarget, entry)
      await copyFile(sourceFile, targetFile)
    }
  }

  const updaterSource = path.join(installDir, 'scripts', 'arcade-shell-updater.mjs')
  if (await fileExists(updaterSource)) {
    await copyFile(updaterSource, updaterDest)
    await fsp.chmod(updaterDest, 0o755)
  }

  run('systemctl', ['daemon-reload'])
  for (const service of serviceNames) {
    run('systemctl', ['restart', service])
  }

  await fsp.writeFile(versionFile, requiredVersion, 'utf8')
  console.log(`[arcade-shell-updater] installed version ${requiredVersion}`)
}

main().catch((error) => {
  console.error('[arcade-shell-updater] failed', error)
  process.exit(1)
})
