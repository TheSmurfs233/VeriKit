import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runCapture } from '../proc/runner';
import type { ToolAdapter } from '../toolchain/adapter';

/**
 * 对单个文件跑一次工具链，**原样返回输出，不做任何解析**。
 *
 * 存在的意义（S1.5）：
 *   1. 证明"文件 → 进程 → 输出"这条链路真的通了
 *   2. 把真实输出固化成 fixture，供 S4 的解析器对照
 *   3. 量出真实 lint 耗时（此前只测过 `-version`）
 *
 * 必须在临时目录里跑：实测 xvlog 会在 cwd 生成 `xsim.dir` / `xvlog.log` / `xvlog.pb`。
 */

export interface RawLintResult {
  file: string;
  elapsedMs: number;
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface RawLintOptions {
  timeoutMs: number;
  /** 工具额外参数（S4 会用到 include 路径等）；文件路径由本函数追加在最后 */
  args?: string[];
  platform?: NodeJS.Platform;
  comspec?: string;
}

export async function lintFileRaw(
  adapter: ToolAdapter,
  exePath: string,
  filePath: string,
  opts: RawLintOptions
): Promise<RawLintResult> {
  void adapter; // 目前只用 exePath；保留 adapter 是为 S4 接多工具时统一入口
  const workDir = await mkdtemp(path.join(tmpdir(), 'verikit-lint-'));
  try {
    const r = await runCapture(exePath, [...(opts.args ?? []), filePath], {
      cwd: workDir,
      timeoutMs: opts.timeoutMs,
      platform: opts.platform,
      comspec: opts.comspec,
    });
    return {
      file: filePath,
      elapsedMs: r.elapsedMs,
      code: r.code,
      timedOut: r.timedOut,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 按级别统计行数，用于判断"噪声行占比"（S4 解析器要覆盖多少种格式） */
export interface LineStats {
  info: number;
  warning: number;
  error: number;
  other: number;
  total: number;
}

export function countLines(text: string): LineStats {
  const stats: LineStats = { info: 0, warning: 0, error: 0, other: 0, total: 0 };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    stats.total += 1;
    if (/^INFO\b/i.test(line)) {
      stats.info += 1;
    } else if (/^WARNING\b/i.test(line)) {
      stats.warning += 1;
    } else if (/^ERROR\b/i.test(line)) {
      stats.error += 1;
    } else {
      stats.other += 1;
    }
  }
  return stats;
}
