import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeBufferCopy } from '../../src/core/lint/bufferCopy';
import { Debouncer } from '../../src/core/trigger/debounce';
import { resolveChangeAction } from '../../src/core/trigger/policy';

describe('resolveChangeAction（change 事件三态决策）', () => {
  it('contentChanges 为空（磁盘回读/重载）→ disk', () => {
    expect(resolveChangeAction(false, false)).toBe('disk');
    expect(resolveChangeAction(true, false)).toBe('disk');
  });

  it('用户输入 + onEdit 关 → none（维持原行为）', () => {
    expect(resolveChangeAction(false, true)).toBe('none');
  });

  it('用户输入 + onEdit 开 → buffer', () => {
    expect(resolveChangeAction(true, true)).toBe('buffer');
  });
});

describe('writeBufferCopy', () => {
  it('保留原文件名与内容（xvlog 对扩展名敏感）', async () => {
    const copy = await writeBufferCopy('D:/proj/top.v', 'module top ();\nendmodule');
    try {
      expect(path.basename(copy.file)).toBe('top.v');
      expect(copy.file).toContain(tmpdir());
      expect(existsSync(copy.file)).toBe(true);
    } finally {
      await copy.dispose();
    }
    expect(existsSync(copy.file)).toBe(false);
    expect(existsSync(copy.dir)).toBe(false);
  });

  it('不同文档的副本互不覆盖（各自独立目录）', async () => {
    const a = await writeBufferCopy('a.v', 'module a;');
    const b = await writeBufferCopy('b.v', 'module b;');
    try {
      expect(a.file).not.toBe(b.file);
      expect(path.dirname(a.file)).not.toBe(path.dirname(b.file));
      const files = readdirSync(a.dir);
      expect(files).toEqual(['a.v']);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});

describe('Debouncer（防抖窗口）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('连续 schedule 只触发最后一次', () => {
    vi.useFakeTimers();
    let runs = 0;
    const d = new Debouncer(1000, () => {
      runs += 1;
    });
    d.schedule();
    vi.advanceTimersByTime(500);
    d.schedule();
    vi.advanceTimersByTime(500);
    expect(runs).toBe(0); // 第二次 schedule 重置了计时
    d.schedule();
    vi.advanceTimersByTime(1000);
    expect(runs).toBe(1);
    d.dispose();
  });

  it('cancel 阻止触发', () => {
    vi.useFakeTimers();
    let runs = 0;
    const d = new Debouncer(1000, () => {
      runs += 1;
    });
    d.schedule();
    d.cancel();
    vi.advanceTimersByTime(5000);
    expect(runs).toBe(0);
    expect(d.pending).toBe(false);
    d.dispose();
  });

  it('schedule(fn) 用传入的回调（调度器按次传 lint 闭包）', () => {
    vi.useFakeTimers();
    let ran = '';
    const d = new Debouncer(500, () => undefined);
    d.schedule(() => {
      ran = 'lint';
    });
    vi.advanceTimersByTime(500);
    expect(ran).toBe('lint');
    d.dispose();
  });
});
