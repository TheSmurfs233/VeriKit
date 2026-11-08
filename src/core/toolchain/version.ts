import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runCapture } from '../proc/runner';
import type { ToolAdapter } from './adapter';

/**
 * 读取工具链版本。
 *
 * **必须在临时目录里跑**：实测 `xvlog -version` 也会在当前目录留下
 * `xvlog.log` 与 `xvlog.pb`，直接在工作区跑会污染用户工程。
 */

export interface VersionProbe {
  version?: string;
  elapsedMs: number;
  error?: string;
  raw?: { code: number | null; stdout: string; stderr: string; timedOut: boolean };
}

export interface VersionOptions {
  timeoutMs: number;
  platform?: NodeJS.Platform;
  comspec?: string;
}

export async function readVersion(
  adapter: ToolAdapter,
  exePath: string,
  opts: VersionOptions
): Promise<VersionProbe> {
  if (!adapter.versionArgs) {
    return { version: undefined, elapsedMs: 0, error: '该工具不支持版本查询' };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'verikit-'));
  try {
    const r = await runCapture(exePath, adapter.versionArgs, {
      cwd: workDir,
      timeoutMs: opts.timeoutMs,
      platform: opts.platform,
      comspec: opts.comspec,
    });
    const combined = `${r.stdout}\n${r.stderr}`;
    return {
      version: adapter.parseVersion?.(combined),
      elapsedMs: r.elapsedMs,
      raw: {
        code: r.code,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut: r.timedOut,
      },
    };
  } catch (err) {
    return { version: undefined, elapsedMs: 0, error: String(err) };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
