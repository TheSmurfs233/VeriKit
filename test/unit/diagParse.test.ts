import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseXvlogOutput } from '../../src/core/diag/parse';
import type { DiagItem } from '../../src/core/diag/parse';

/** 读取真实 xvlog 输出 fixture（采集脚本与格式说明见 test/fixtures/xvlog/README.md） */
function fixture(name: string): string {
  const url = new URL(`../fixtures/xvlog/${name}`, import.meta.url);
  return readFileSync(url, 'utf8');
}

describe('parseXvlogOutput（基于真实 fixture）', () => {
  it('broken.v：2 条 ERROR（都在第 7 行），INFO 全部丢弃', () => {
    const r = parseXvlogOutput(fixture('broken.stdout.txt'));
    expect(r.items).toHaveLength(2);
    expect(r.dropped.info).toBe(2);
    expect(r.dropped.other).toBe(0);
    expect(r.items.every((i) => i.severity === 'error')).toBe(true);
    expect(r.items.every((i) => i.line === 7)).toBe(true);
  });

  it('错误码与消息逐项正确', () => {
    const r = parseXvlogOutput(fixture('broken.stdout.txt'));
    const codes = r.items.map((i) => i.code).sort();
    expect(codes).toEqual(['VRFC 10-4982', 'VRFC 10-8549']);
    expect(r.items[0].message).toContain('syntax error');
  });

  it('干净文件（counter/top/legacy）：零诊断', () => {
    for (const name of ['counter.stdout.txt', 'top.stdout.txt', 'legacy_nonansi.stdout.txt']) {
      const r = parseXvlogOutput(fixture(name));
      expect(r.items, name).toHaveLength(0);
      expect(r.dropped.info, name).toBe(2);
    }
  });

  it('行号是 1-based 原值（不做换算）', () => {
    const r = parseXvlogOutput(fixture('broken.stdout.txt'));
    expect(r.items[0].line).toBe(7);
  });
});

describe('parseXvlogOutput（边界）', () => {
  it('空输入 → 零诊断零丢弃', () => {
    const r = parseXvlogOutput('');
    expect(r.items).toHaveLength(0);
    expect(r.dropped.info).toBe(0);
    expect(r.dropped.other).toBe(0);
  });

  it('无法识别的行计入 dropped.other（解析器自检哨兵）', () => {
    const r = parseXvlogOutput('something unexpected\nERROR: [VRFC 10-1] msg [f.v:1]');
    expect(r.items).toHaveLength(1);
    expect(r.dropped.other).toBe(1);
  });

  it('WARNING 也成为诊断', () => {
    const r = parseXvlogOutput('WARNING: [VRFC 10-123] careful [f.v:3]');
    expect(r.items).toEqual([
      { file: 'f.v', line: 3, code: 'VRFC 10-123', message: 'careful', severity: 'warning' } satisfies DiagItem,
    ]);
  });

  it('文件路径含中文与空格可解析', () => {
    const r = parseXvlogOutput("ERROR: [VRFC 10-1] boom [D:/我 的 工程/top.v:12]");
    expect(r.items[0].file).toBe('D:/我 的 工程/top.v');
    expect(r.items[0].line).toBe(12);
  });
});
