import * as nodeFs from 'node:fs'
import type { Stats } from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'

type ElectronAsarProcess = NodeJS.Process & { noAsar?: boolean }

type OriginalFsPromises = {
  stat?: typeof nodeFsPromises.stat
  lstat?: typeof nodeFsPromises.lstat
  open?: typeof nodeFsPromises.open
  realpath?: typeof nodeFsPromises.realpath
  copyFile?: typeof nodeFsPromises.copyFile
}

type OriginalFs = {
  promises?: OriginalFsPromises
  realpathSync?: typeof nodeFs.realpathSync
  openSync?: typeof nodeFs.openSync
}

// A path segment whose extension is exactly `.asar` (not `.asar.unpacked`).
const ASAR_ARCHIVE_SEGMENT = /(?:^|[\\/])[^\\/]+\.asar(?:$|[\\/])/i

export function pathTargetsAsarArchive(filePath: string): boolean {
  return ASAR_ARCHIVE_SEGMENT.test(filePath)
}

let originalFsModule: OriginalFs | null | undefined

function loadOriginalFs(): OriginalFs | null {
  try {
    return require('original-fs') as OriginalFs
  } catch {
    return null
  }
}

function originalFs(): OriginalFs | null {
  if (originalFsModule === undefined) {
    originalFsModule = loadOriginalFs()
  }
  return originalFsModule
}

function originalPromiseMethod<Name extends keyof OriginalFsPromises>(
  name: Name
): OriginalFsPromises[Name] | null {
  const method = originalFs()?.promises?.[name]
  return typeof method === 'function' ? method : null
}

function withElectronAsarDisabled<T>(run: () => T): T {
  const proc = process as ElectronAsarProcess
  const previous = proc.noAsar
  proc.noAsar = true
  try {
    return run()
  } finally {
    proc.noAsar = previous
  }
}

function asarPaths(filePaths: readonly nodeFs.PathLike[]): string[] {
  return filePaths.filter((filePath): filePath is string => typeof filePath === 'string')
}

// Why: Electron caches every .asar opened via patched fs until process exit, so Windows cannot delete temp build archives (#10063).
export function runWorkspaceDiskIO<T>(
  filePaths: readonly string[],
  nodeCall: () => T,
  originalCall: (() => T) | null
): T {
  if (!filePaths.some(pathTargetsAsarArchive)) {
    return nodeCall()
  }
  if (originalCall) {
    return originalCall()
  }
  // splitPath() checks process.noAsar synchronously before the promise yields.
  return withElectronAsarDisabled(nodeCall)
}

export function statWorkspaceDisk(filePath: nodeFs.PathLike): Promise<Stats> {
  const original = originalPromiseMethod('stat')
  return runWorkspaceDiskIO(
    asarPaths([filePath]),
    () => nodeFsPromises.stat(filePath),
    original ? () => original.call(originalFs()?.promises, filePath) : null
  ) as Promise<Stats>
}

export function lstatWorkspaceDisk(filePath: nodeFs.PathLike): Promise<Stats> {
  const original = originalPromiseMethod('lstat')
  return runWorkspaceDiskIO(
    asarPaths([filePath]),
    () => nodeFsPromises.lstat(filePath),
    original ? () => original.call(originalFs()?.promises, filePath) : null
  ) as Promise<Stats>
}

export function openWorkspaceDisk(
  filePath: nodeFs.PathLike,
  flags?: nodeFs.OpenMode,
  mode?: nodeFs.Mode
): ReturnType<typeof nodeFsPromises.open> {
  const original = originalPromiseMethod('open')
  // Why: callers and tests omit mode; passing explicit undefined changes Node's open signature.
  const nodeCall = () =>
    mode === undefined
      ? nodeFsPromises.open(filePath, flags)
      : nodeFsPromises.open(filePath, flags, mode)
  const originalCall = original
    ? () =>
        mode === undefined
          ? original.call(originalFs()?.promises, filePath, flags)
          : original.call(originalFs()?.promises, filePath, flags, mode)
    : null
  return runWorkspaceDiskIO(asarPaths([filePath]), nodeCall, originalCall)
}

export function openSyncWorkspaceDisk(
  filePath: nodeFs.PathLike,
  flags: nodeFs.OpenMode,
  mode?: nodeFs.Mode
): number {
  const original = originalFs()?.openSync
  const nodeCall = () =>
    mode === undefined ? nodeFs.openSync(filePath, flags) : nodeFs.openSync(filePath, flags, mode)
  const originalCall = original
    ? () =>
        mode === undefined
          ? original.call(originalFs(), filePath, flags)
          : original.call(originalFs(), filePath, flags, mode)
    : null
  return runWorkspaceDiskIO(asarPaths([filePath]), nodeCall, originalCall)
}

export function realpathWorkspaceDisk(filePath: string): Promise<string> {
  const original = originalPromiseMethod('realpath')
  return runWorkspaceDiskIO(
    [filePath],
    () => nodeFsPromises.realpath(filePath),
    original ? () => original.call(originalFs()?.promises, filePath) : null
  ) as Promise<string>
}

export function realpathSyncWorkspaceDisk(filePath: string): string {
  const original = originalFs()?.realpathSync
  return runWorkspaceDiskIO(
    [filePath],
    () => nodeFs.realpathSync(filePath),
    original ? () => original.call(originalFs(), filePath) : null
  ) as string
}

export function copyFileWorkspaceDisk(
  src: nodeFs.PathLike,
  dest: nodeFs.PathLike,
  mode?: number
): Promise<void> {
  const original = originalPromiseMethod('copyFile')
  const nodeCall = () =>
    mode === undefined
      ? nodeFsPromises.copyFile(src, dest)
      : nodeFsPromises.copyFile(src, dest, mode)
  const originalCall = original
    ? () =>
        mode === undefined
          ? original.call(originalFs()?.promises, src, dest)
          : original.call(originalFs()?.promises, src, dest, mode)
    : null
  return runWorkspaceDiskIO(asarPaths([src, dest]), nodeCall, originalCall)
}
