import { describe, expect, it } from 'vitest';
import { countLines, lintFileRaw } from '../../src/core/lint/raw';
import { xvlogAdapter } from '../../src/core/toolchain/adapter';

/**
 * 这里不依赖真实的 xvlog：用 node 自己充当"工具"，
 * 只为验证 lintFileRaw 的职责边界（参数顺序、临时目录、输出原样返回）。
 * 真实的 xvlog 输出在 test/fixtures/xvlog/ 里，供 S4 的解析器使用。
 */

describe('lintFileRaw', () => {
  it('把文件路径作为最后一个参数传给工具，并原样返回 stdout', async () => {
    const target = 'C:/proj/a b/counter.v';
    const r = await lintFileRaw(xvlogAdapter, process.execPath, target, {
      timeoutMs: 15000,
      args: ['-e', 'process.stdout.write(process.argv.slice(1).join("|"))'],
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(target);
    expect(r.timedOut).toBe(false);
  });

  it('额外参数排在文件路径之前', async () => {
    // 这里用中性 token 而不是 '--incr'：node 会把 '--incr' 当成自己的选项而直接失败，
    // 那样测的就不是"参数顺序"了。
    const r = await lintFileRaw(xvlogAdapter, process.execPath, 'X.v', {
      timeoutMs: 15000,
      args: ['-e', 'process.stdout.write(process.argv.slice(1).join("|"))', 'EXTRAPARAM'],
    });
    expect(r.stdout).toBe('EXTRAPARAM|X.v');
  });

  it('非零退出码与 stderr 都原样带回，不抛异常', async () => {
    const r = await lintFileRaw(xvlogAdapter, process.execPath, 'ignored', {
      timeoutMs: 15000,
      args: ['-e', 'process.stderr.write("boom");process.exit(2)'],
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('boom');
  });
});

describe('countLines', () => {
  it('按级别统计，忽略空行', () => {
    const text = [
      'INFO: [VRFC 10-2263] Analyzing Verilog file "a.v" into library work',
      '',
      'INFO: [VRFC 10-311] analyzing module counter',
      'ERROR: [VRFC 10-4982] syntax error near input [a.v:7]',
      'WARNING: [VRFC 10-1234] something',
      'some stray line',
    ].join('\n');
    expect(countLines(text)).toEqual({ info: 2, warning: 1, error: 1, other: 1, total: 5 });
  });

  it('空字符串返回全 0', () => {
    expect(countLines('')).toEqual({ info: 0, warning: 0, error: 0, other: 0, total: 0 });
  });
});
