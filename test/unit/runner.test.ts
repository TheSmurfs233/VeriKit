import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runCapture } from '../../src/core/proc/runner';

/**
 * 用 node 自身当被测进程，跨平台且不依赖任何外部工具。
 * 这里重点验三件容易写错的事：双流消费、退出码、超时。
 */

const CWD = tmpdir();

describe('runCapture', () => {
  it('收全 stdout 与 stderr，并拿到退出码 0', async () => {
    const r = await runCapture(
      process.execPath,
      ['-e', "process.stdout.write('OUT');process.stderr.write('ERR')"],
      { cwd: CWD, timeoutMs: 10000 }
    );
    expect(r.stdout).toBe('OUT');
    expect(r.stderr).toBe('ERR');
    expect(r.code).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it('非零退出码原样返回，不抛异常', async () => {
    const r = await runCapture(process.execPath, ['-e', 'process.exit(3)'], {
      cwd: CWD,
      timeoutMs: 10000,
    });
    expect(r.code).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it('大量输出不会因管道写满而挂起', async () => {
    const n = 200_000;
    const r = await runCapture(
      process.execPath,
      ['-e', `process.stdout.write('x'.repeat(${n}))`],
      { cwd: CWD, timeoutMs: 20000 }
    );
    expect(r.stdout.length).toBe(n);
    expect(r.timedOut).toBe(false);
  });

  it('超时会被 kill 并标记 timedOut，不抛异常', async () => {
    const r = await runCapture(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)'],
      { cwd: CWD, timeoutMs: 300 }
    );
    expect(r.timedOut).toBe(true);
    expect(r.elapsedMs).toBeLessThan(10000);
  });
});
