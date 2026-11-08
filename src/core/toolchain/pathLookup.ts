import * as path from 'node:path';

/**
 * 在 PATH 里查找可执行文件。
 *
 * 为什么不用 `where` / `which`：那又是一次外部进程（Windows 上 ~50 ms 起），
 * 而探测本身已经够慢了。纯文件系统检查够用，且可离线单测。
 */

export interface PathLookupOptions {
  names: string[];
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  isFile: (p: string) => Promise<boolean>;
}

export interface PathLookupHit {
  name: string;
  exePath: string;
  dir: string;
}

/** PATH 分隔符：Windows 用 `;`，其余用 `:` */
export function splitPathEnv(
  raw: string | undefined,
  platform: NodeJS.Platform
): string[] {
  if (!raw) {
    return [];
  }
  const sep = platform === 'win32' ? ';' : ':';
  return raw
    .split(sep)
    .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
    .filter((s) => s.length > 0);
}

export async function findOnPath(opts: PathLookupOptions): Promise<PathLookupHit | undefined> {
  const dirs = splitPathEnv(opts.env.PATH ?? opts.env.Path, opts.platform);
  for (const dir of dirs) {
    for (const name of opts.names) {
      const candidate = path.join(dir, name);
      if (await opts.isFile(candidate)) {
        return { name, exePath: candidate, dir };
      }
    }
  }
  return undefined;
}
