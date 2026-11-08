import { spawn } from 'node:child_process';
import { buildSpawnPlan } from './winShim';

/**
 * 全项目唯一的外部进程出口。
 *
 * 三件事必须做对（都是踩过的坑）：
 *   1. stdout 与 stderr 都要消费 —— 只读一路会让另一路的管道写满，子进程永久挂起
 *   2. 用 `close` 而不是 `exit` 判断结束 —— `exit` 早于输出读完，会截断
 *   3. 超时必须 kill 并标记，而不是抛异常
 */

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  encoding?: BufferEncoding;
  /** 允许覆盖平台，仅用于单测 */
  platform?: NodeJS.Platform;
  comspec?: string;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  timedOut: boolean;
}

export function runCapture(
  cmd: string,
  args: string[],
  opts: RunOptions
): Promise<RunResult> {
  const platform = opts.platform ?? process.platform;
  const comspec = opts.comspec ?? process.env.ComSpec ?? 'cmd.exe';
  const plan = buildSpawnPlan(cmd, args, platform, comspec);
  const encoding = opts.encoding ?? 'utf8';
  const started = Date.now();

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(plan.file, plan.args, {
      cwd: opts.cwd,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };

    // 两路都消费，绝不只挂一路
    child.stdout.setEncoding(encoding);
    child.stderr.setEncoding(encoding);
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      finish(() => reject(err));
    });

    child.on('close', (code) => {
      finish(() =>
        resolve({
          code,
          stdout,
          stderr,
          elapsedMs: Date.now() - started,
          timedOut,
        })
      );
    });
  });
}
