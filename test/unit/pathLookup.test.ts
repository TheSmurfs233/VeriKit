import { describe, expect, it } from 'vitest';
import { findOnPath, splitPathEnv } from '../../src/core/toolchain/pathLookup';

describe('splitPathEnv', () => {
  it('Windows 用分号分隔', () => {
    expect(splitPathEnv('C:/a;C:/b', 'win32')).toEqual(['C:/a', 'C:/b']);
  });

  it('Linux / macOS 用冒号分隔', () => {
    expect(splitPathEnv('/usr/bin:/bin', 'linux')).toEqual(['/usr/bin', '/bin']);
  });

  it('去掉包裹的引号与空项', () => {
    expect(splitPathEnv('"C:/a b";;C:/c', 'win32')).toEqual(['C:/a b', 'C:/c']);
  });

  it('空值返回空数组', () => {
    expect(splitPathEnv(undefined, 'win32')).toEqual([]);
  });
});

describe('findOnPath', () => {
  const files = new Set(['c:/tools/xvlog.bat', 'c:/other/foo.exe']);
  const isFile = async (p: string): Promise<boolean> =>
    files.has(p.replace(/\\/g, '/').toLowerCase());

  it('按候选顺序命中', async () => {
    const hit = await findOnPath({
      names: ['xvlog.exe', 'xvlog.bat'],
      env: { PATH: 'C:/tools' },
      platform: 'win32',
      isFile,
    });
    expect(hit?.name).toBe('xvlog.bat');
    expect(hit?.exePath.replace(/\\/g, '/')).toBe('C:/tools/xvlog.bat');
  });

  it('找不到时返回 undefined', async () => {
    const hit = await findOnPath({
      names: ['nope.exe'],
      env: { PATH: 'C:/tools' },
      platform: 'win32',
      isFile,
    });
    expect(hit).toBeUndefined();
  });

  it('多个目录时取第一个命中的', async () => {
    const hit = await findOnPath({
      names: ['foo.exe'],
      env: { PATH: 'C:/empty;C:/other' },
      platform: 'win32',
      isFile,
    });
    expect(hit?.dir.replace(/\\/g, '/')).toBe('C:/other');
  });
});
