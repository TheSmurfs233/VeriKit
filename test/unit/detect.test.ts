import { describe, expect, it } from 'vitest';
import { xvlogAdapter } from '../../src/core/toolchain/adapter';
import { probePresence, type ProbeDeps } from '../../src/core/toolchain/detect';

/**
 * 说明：detect 内部用 node:path，其行为依赖宿主平台。
 * 因此本文件只测宿主平台（Windows）的语义；跨平台差异（分隔符、cmd 转发）
 * 已由 splitPathEnv / needsCmdShim 的纯函数用例覆盖。
 */

/** 构造一个假的文件系统视图 */
function fakeFs(files: string[], dirs: string[] = []): Pick<ProbeDeps, 'isFile' | 'isDirectory'> {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  const F = new Set(files.map(norm));
  const D = new Set(dirs.map(norm));
  return {
    isFile: async (p: string) => F.has(norm(p)),
    isDirectory: async (p: string) => D.has(norm(p)),
  };
}

function deps(
  fsImpl: Pick<ProbeDeps, 'isFile' | 'isDirectory'>,
  env: Record<string, string | undefined> = {}
): ProbeDeps {
  return { platform: 'win32', env, ...fsImpl };
}

const XVLOG = 'C:/Xilinx/Vivado/2022.2/bin/xvlog.bat';

describe('probePresence', () => {
  it('优先使用显式配置的路径', async () => {
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: XVLOG, scanDirs: [] },
      deps(fakeFs([XVLOG]))
    );
    expect(r.found).toBe(true);
    expect(r.source).toBe('config');
    expect(r.exePath?.replace(/\\/g, '/')).toBe(XVLOG);
  });

  it('配置的是目录 → 记为 notFile，然后继续往下找', async () => {
    const path_ = 'C:/Xilinx/Vivado/2022.2/bin';
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: path_, scanDirs: [] },
      deps(fakeFs([], [path_]))
    );
    expect(r.attempts[0]).toMatchObject({ via: 'config', result: 'notFile' });
    expect(r.found).toBe(false);
  });

  it('配置相对路径 → 记为 notAbsolute', async () => {
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: 'bin/xvlog.bat', scanDirs: [] },
      deps(fakeFs([]))
    );
    expect(r.attempts[0]).toMatchObject({ via: 'config', result: 'notAbsolute' });
  });

  it('PATH 命中', async () => {
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: '', scanDirs: [] },
      deps(fakeFs([XVLOG]), { PATH: 'C:/Windows;C:/Xilinx/Vivado/2022.2/bin' })
    );
    expect(r.found).toBe(true);
    expect(r.source).toBe('path');
  });

  it('PATH 里只找到无扩展名的 xvlog → notExecutable（Windows 上 spawn 不起来）', async () => {
    const noExt = 'C:/Xilinx/Vivado/2022.2/bin/xvlog';
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: '', scanDirs: [] },
      deps(fakeFs([noExt]), { PATH: 'C:/Xilinx/Vivado/2022.2/bin' })
    );
    expect(r.found).toBe(false);
    expect(r.attempts.some((a) => a.result === 'notExecutable')).toBe(true);
  });

  it('PATH 找不到时用 XILINX_VIVADO 兜底', async () => {
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: '', scanDirs: [] },
      deps(fakeFs([XVLOG]), {
        PATH: 'C:/Windows',
        XILINX_VIVADO: 'C:/Xilinx/Vivado/2022.2',
      })
    );
    expect(r.found).toBe(true);
    expect(r.source).toBe('env');
  });

  it('XILINX_VIVADO 直接指向 bin 目录也能命中（用户实测踩过的约定）', async () => {
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: '', scanDirs: [] },
      deps(fakeFs([XVLOG]), {
        PATH: 'C:/Windows',
        XILINX_VIVADO: 'C:/Xilinx/Vivado/2022.2/bin',
      })
    );
    expect(r.found).toBe(true);
    expect(r.source).toBe('env');
  });

  it('scanDirs 作为最后兜底', async () => {
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: '', scanDirs: ['D:/Xilinx/Vivado/2022.2/bin'] },
      deps(fakeFs(['D:/Xilinx/Vivado/2022.2/bin/xvlog.bat']), { PATH: 'C:/Windows' })
    );
    expect(r.found).toBe(true);
    expect(r.source).toBe('scan');
  });

  it('全部失败时仍返回每一次尝试，便于告诉用户"找过哪里"', async () => {
    const r = await probePresence(
      { adapter: xvlogAdapter, configuredPath: '', scanDirs: [] },
      deps(fakeFs([]), { PATH: 'C:/Windows' })
    );
    expect(r.found).toBe(false);
    expect(r.source).toBe('none');
    expect(r.attempts.length).toBeGreaterThan(0);
    expect(r.attempts.every((a) => a.result !== 'ok')).toBe(true);
  });
});

describe('xvlogAdapter.parseVersion', () => {
  it('从真实输出里取版本', () => {
    expect(xvlogAdapter.parseVersion?.('Vivado Simulator v2022.2\n')).toBe('2022.2');
  });

  it('输出里没有版本时返回 undefined', () => {
    expect(xvlogAdapter.parseVersion?.('usage: xvlog ...')).toBeUndefined();
  });
});
