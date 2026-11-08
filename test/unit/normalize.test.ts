import { describe, expect, it } from 'vitest';
import { normalizeFsPath } from '../../src/core/path/normalize';

describe('normalizeFsPath', () => {
  it('同一文件的三种写法归一后相等（Windows 实测场景）', () => {
    const a = 'd:\\Embedded\\FPGA\\test-workspace\\rtl\\broken.v';
    const b = 'd:/Embedded/FPGA/test-workspace/rtl/broken.v';
    const c = 'D:/Embedded/FPGA/test-workspace/rtl/broken.v';
    expect(normalizeFsPath(a)).toBe(normalizeFsPath(b));
    expect(normalizeFsPath(b)).toBe(normalizeFsPath(c));
  });

  it('不同文件归一后不等', () => {
    expect(normalizeFsPath('d:/a/broken.v')).not.toBe(normalizeFsPath('d:/a/counter.v'));
  });
});
