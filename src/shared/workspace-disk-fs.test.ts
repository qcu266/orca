import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pathTargetsAsarArchive, runWorkspaceDiskIO, statWorkspaceDisk } from './workspace-disk-fs'

type ElectronAsarProcess = NodeJS.Process & { noAsar?: boolean }

function asarFlag(): boolean | undefined {
  return (process as ElectronAsarProcess).noAsar
}

describe('pathTargetsAsarArchive', () => {
  it('matches archive files and paths inside them on Windows and POSIX', () => {
    expect(pathTargetsAsarArchive('C:\\build\\.op-1\\payload\\app\\resources\\app.asar')).toBe(true)
    expect(pathTargetsAsarArchive('/tmp/resources/app.asar/index.js')).toBe(true)
    expect(pathTargetsAsarArchive('/tmp/APP.ASAR')).toBe(true)
    expect(pathTargetsAsarArchive('app.asar')).toBe(true)
  })

  it('does not match unpacked trees or names that only contain the substring', () => {
    expect(pathTargetsAsarArchive('/tmp/app.asar.unpacked/out/main.js')).toBe(false)
    expect(pathTargetsAsarArchive('/tmp/app.asar.unpacked')).toBe(false)
    expect(pathTargetsAsarArchive('/tmp/file.asar.txt')).toBe(false)
    expect(pathTargetsAsarArchive('/tmp/src/main.ts')).toBe(false)
  })
})

describe('runWorkspaceDiskIO', () => {
  afterEach(() => {
    Reflect.deleteProperty(process, 'noAsar')
  })

  it('keeps ordinary paths on node fs', () => {
    expect(
      runWorkspaceDiskIO(
        ['/repo/src/main.ts'],
        () => 'node',
        () => 'original'
      )
    ).toBe('node')
    expect(asarFlag()).toBeUndefined()
  })

  it('prefers original-fs for asar paths', () => {
    let sawDisabled = false
    const result = runWorkspaceDiskIO(
      ['C:\\build\\app.asar'],
      () => {
        sawDisabled = asarFlag() === true
        return 'node'
      },
      () => 'original'
    )
    expect(result).toBe('original')
    expect(sawDisabled).toBe(false)
    expect(asarFlag()).toBeUndefined()
  })

  it('disables Electron asar support only for the synchronous fs hook', () => {
    let sawDisabled = false
    const result = runWorkspaceDiskIO(
      ['/tmp/resources/app.asar'],
      () => {
        sawDisabled = asarFlag() === true
        return 'node'
      },
      null
    )
    expect(result).toBe('node')
    expect(sawDisabled).toBe(true)
    expect(asarFlag()).toBeUndefined()
  })
})

describe('statWorkspaceDisk', () => {
  it('reports an asar archive as a file and restores asar handling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orca-asar-stat-'))
    try {
      const asarPath = join(dir, 'app.asar')
      await writeFile(asarPath, 'not-an-archive')
      const stats = await statWorkspaceDisk(asarPath)
      expect(stats.isFile()).toBe(true)
      expect(stats.isDirectory()).toBe(false)
      expect(asarFlag()).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
