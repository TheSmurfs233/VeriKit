import * as path from 'node:path';
import { expandPath } from '../path/expand';
import type { ToolAdapter } from './adapter';
import { findOnPath } from './pathLookup';

/**
 * 探测"工具链在哪"。纯函数 + 依赖注入，不 import vscode，可在 vitest 里覆盖三平台。
 *
 * 三级级联：配置 → PATH → 环境变量/扫描目录
 * 每一次尝试都记进 attempts[]，失败时才能告诉用户"我找过哪些地方"。
 */

export type ProbeSource = 'config' | 'path' | 'env' | 'scan' | 'none';

export type AttemptResult =
  | 'ok'
  | 'missing'
  | 'notFile' // 是目录，不是文件
  | 'notAbsolute' // 填了相对路径
  | 'notExecutable'; // 扩展名不对（Windows 上常见于误填无扩展名的 shell 脚本）

export interface ProbeAttempt {
  via: string;
  target: string;
  result: AttemptResult;
}

export interface PresenceResult {
  found: boolean;
  exePath?: string;
  source: ProbeSource;
  attempts: ProbeAttempt[];
  elapsedMs: number;
}

export interface ProbeDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  isFile: (p: string) => Promise<boolean>;
  isDirectory: (p: string) => Promise<boolean>;
}

export interface ProbeInput {
  adapter: ToolAdapter;
  /** 用户配置的原始值（可能含 ${env:} / ~，未展开） */
  configuredPath: string | undefined;
  /** 额外扫描目录（默认空；不硬编码 D:\Xilinx） */
  scanDirs: string[];
}

const WIN_EXEC_EXTS = ['.exe', '.cmd', '.bat'];

/** Windows 上只有这三种扩展名能被 spawn 起来 */
function executableOk(exePath: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') {
    return true;
  }
  const lower = exePath.toLowerCase();
  return WIN_EXEC_EXTS.some((ext) => lower.endsWith(ext));
}

async function classify(
  candidate: string,
  platform: NodeJS.Platform,
  deps: ProbeDeps
): Promise<AttemptResult> {
  if (await deps.isDirectory(candidate)) {
    return 'notFile';
  }
  if (!(await deps.isFile(candidate))) {
    return 'missing';
  }
  return executableOk(candidate, platform) ? 'ok' : 'notExecutable';
}

export async function probePresence(
  input: ProbeInput,
  deps: ProbeDeps
): Promise<PresenceResult> {
  const startedAt = Date.now();
  const attempts: ProbeAttempt[] = [];
  const { platform, env } = deps;
  const names = input.adapter.candidates(platform);

  const done = (exePath: string, source: ProbeSource): PresenceResult => ({
    found: true,
    exePath,
    source,
    attempts,
    elapsedMs: Date.now() - startedAt,
  });

  // ---------- 1. 显式配置 ----------
  const expanded = expandPath(input.configuredPath, env);
  if (expanded) {
    if (!path.isAbsolute(expanded)) {
      attempts.push({ via: 'config', target: expanded, result: 'notAbsolute' });
    } else {
      const result = await classify(expanded, platform, deps);
      attempts.push({ via: 'config', target: expanded, result });
      if (result === 'ok') {
        return done(expanded, 'config');
      }
    }
  }

  // ---------- 2. PATH ----------
  const hit = await findOnPath({ names, env, platform, isFile: deps.isFile });
  if (hit) {
    const result = executableOk(hit.exePath, platform) ? 'ok' : 'notExecutable';
    attempts.push({ via: 'PATH', target: hit.exePath, result });
    if (result === 'ok') {
      return done(hit.exePath, 'path');
    }
  } else {
    attempts.push({ via: 'PATH', target: names.join(' | '), result: 'missing' });
  }

  // ---------- 3. 环境变量推导（Vivado 装了但没进 PATH 的典型情况） ----------
  const vivado = env.XILINX_VIVADO;
  if (vivado) {
    // 兼容两种环境变量约定：指向安装根（<var>/bin/xvlog.bat）
    // 或直接指向 bin 目录（<var>/xvlog.bat）—— 用户实测踩过后者
    const bases = [path.join(vivado, 'bin'), vivado];
    let hitTarget: string | undefined;
    for (const base of bases) {
      for (const name of names) {
        const candidate = path.join(base, name);
        if (await deps.isFile(candidate)) {
          attempts.push({ via: 'XILINX_VIVADO', target: candidate, result: 'ok' });
          hitTarget = candidate;
          break;
        }
      }
      if (hitTarget) {
        break;
      }
    }
    if (hitTarget) {
      return done(hitTarget, 'env');
    }
    attempts.push({
      via: 'XILINX_VIVADO',
      target: path.join(vivado, 'bin'),
      result: 'missing',
    });
  }

  // ---------- 4. 用户配置的扫描目录 ----------
  for (const dir of input.scanDirs) {
    const abs = expandPath(dir, env);
    if (!abs || !path.isAbsolute(abs)) {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(abs, name);
      if (await deps.isFile(candidate)) {
        attempts.push({ via: 'scan', target: candidate, result: 'ok' });
        return done(candidate, 'scan');
      }
    }
    attempts.push({ via: 'scan', target: abs, result: 'missing' });
  }

  return {
    found: false,
    source: 'none',
    attempts,
    elapsedMs: Date.now() - startedAt,
  };
}
