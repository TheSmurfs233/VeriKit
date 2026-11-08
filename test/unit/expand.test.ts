import { describe, expect, it } from 'vitest';
import { expandPath } from '../../src/core/path/expand';

const ENV = {
  XILINX_VIVADO: 'D:/Xilinx/Vivado/2022.2',
  USERPROFILE: 'C:/Users/dev',
  HOME: '/home/dev',
};

describe('expandPath', () => {
  it('空值返回空串（调用方按未配置处理）', () => {
    expect(expandPath(undefined, ENV)).toBe('');
    expect(expandPath('   ', ENV)).toBe('');
  });

  it('展开 ${env:NAME}', () => {
    const got = expandPath('${env:XILINX_VIVADO}/bin/xvlog.bat', ENV);
    expect(got.replace(/\\/g, '/')).toContain('D:/Xilinx/Vivado/2022.2/bin/xvlog.bat');
  });

  it('未定义的环境变量展开成空串，整体视为未配置', () => {
    expect(expandPath('${env:NOT_SET}', ENV)).toBe('');
  });

  it('展开 ~ 为家目录', () => {
    const got = expandPath('~/tools/xvlog', ENV).replace(/\\/g, '/');
    // 断言也要做分隔符归一：node:path 在 Windows 上会输出反斜杠
    const home = (ENV.USERPROFILE ?? ENV.HOME ?? '').replace(/\\/g, '/');
    expect(got.startsWith(home)).toBe(true);
    expect(got).toContain('tools');
  });

  it('原样返回普通绝对路径', () => {
    const p = 'D:/Xilinx/Vivado/2022.2/bin/xvlog.bat';
    expect(expandPath(p, ENV)).toBe(p);
  });
});
