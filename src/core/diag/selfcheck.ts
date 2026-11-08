/**
 * 解析器自检（版本兼容验证）。
 *
 * 背景：本插件只在 xvlog 2022.2 上实测过。换机/升级后（2019~2026 任意版本），
 * "是否兼容"不应该靠承诺，而应该能**当场验证**。
 *
 * 方法：内置一份含确定语法错误的样本（纯 ASCII，任何版本的 xvlog 都会报
 * 至少 1 条 ERROR），用当前机器的 xvlog 跑一遍，检查：
 *   1. 解析器能解析出诊断（diagCount > 0）
 *   2. 没有未识别的输出行（unrecognized === 0）
 * 两者同时成立 → 该版本兼容；否则给出取证指引。
 *
 * 纯 node，不 import vscode。
 */

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { lintFileRaw } from '../lint/raw';
import type { ToolAdapter } from '../toolchain/adapter';
import { parseXvlogOutput } from './parse';

/** 自检样本：`input clk` 后缺逗号，2019~2026 的 xvlog 都会报 syntax error */
export const SELF_CHECK_SOURCE = [
  'module self_check_broken (',
  '    input clk',
  '    input rst_n',
  ');',
  'endmodule',
  '',
].join('\n');

export interface SelfCheckResult {
  pass: boolean;
  diagCount: number;
  unrecognized: number;
  infoCount: number;
  elapsedMs: number;
  timedOut: boolean;
  notes: string[];
}

export interface SelfCheckOptions {
  timeoutMs: number;
  platform?: NodeJS.Platform;
  comspec?: string;
}

export async function runParserSelfCheck(
  adapter: ToolAdapter,
  exePath: string,
  opts: SelfCheckOptions
): Promise<SelfCheckResult> {
  const notes: string[] = [];
  const dir = await mkdtemp(path.join(tmpdir(), 'verikit-selfcheck-'));
  try {
    const file = path.join(dir, 'self_check_broken.v');
    await writeFile(file, SELF_CHECK_SOURCE, 'utf8');
    const r = await lintFileRaw(adapter, exePath, file, opts);
    const parsed = parseXvlogOutput(`${r.stdout}\n${r.stderr}`);

    const diagCount = parsed.items.length;
    const unrecognized = parsed.dropped.other;
    const infoCount = parsed.dropped.info;
    const pass = diagCount > 0 && unrecognized === 0 && !r.timedOut;

    if (r.timedOut) {
      notes.push(`超时（>${opts.timeoutMs} ms）`);
    }
    if (diagCount === 0) {
      notes.push('未解析出任何诊断 —— 该版本对语法错误的报告形态可能不同');
    }
    if (unrecognized > 0) {
      notes.push(`有 ${unrecognized} 行未识别 —— 该版本的输出格式与解析器不兼容`);
    }
    if (pass && infoCount > 0) {
      notes.push(`INFO ${infoCount} 条已按预期忽略`);
    }
    return { pass, diagCount, unrecognized, infoCount, elapsedMs: r.elapsedMs, timedOut: r.timedOut, notes };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
