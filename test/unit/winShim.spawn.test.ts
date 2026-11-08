import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCapture } from '../../src/core/proc/runner';

/**
 * 真实进程回归测试。
 *
 * 为什么必须有它：S1 手动验收时发现版本查询只用 53 ms 就失败，
 * 根因是手工拼 `"<path> <args>"` 被 Node 的 argv 转义破坏成 `\"...\"`。
 * 纯函数的引号单测**测不出**这个问题 —— 只有真的起一个进程才看得见。
 */

const isWindows = process.platform === 'win32';
const root = isWindows ? mkdtempSync(path.join(tmpdir(), 'verikit-shim-')) : '';

describe.skipIf(!isWindows)('真实进程：.bat 经 cmd 转发', () => {
  // 目录名与文件名都故意带空格
  const spacedDir = path.join(root, 'Program Files X');
  const fakeTool = path.join(spacedDir, 'fake tool.bat');
  const failingTool = path.join(spacedDir, 'failing tool.bat');

  if (isWindows) {
    mkdirSync(spacedDir, { recursive: true });
    writeFileSync(fakeTool, '@echo off\r\necho MARK %1\r\n', 'utf8');
    writeFileSync(failingTool, '@echo off\r\nexit /b 7\r\n', 'utf8');
  }

  afterAll(() => {
    if (isWindows) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('路径含空格时仍能执行并拿到 stdout', async () => {
    const r = await runCapture(fakeTool, ['hello'], { cwd: root, timeoutMs: 15000 });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('MARK hello');
    expect(r.timedOut).toBe(false);
  });

  it('非零退出码原样返回，不抛异常', async () => {
    const r = await runCapture(failingTool, [], { cwd: root, timeoutMs: 15000 });
    expect(r.code).toBe(7);
  });
});
