import { describe, expect, it } from 'vitest';
import { buildSpawnPlan, needsCmdShim } from '../../src/core/proc/winShim';

const COMSPEC = 'C:/Windows/System32/cmd.exe';

describe('needsCmdShim', () => {
  it('Windows 上 .bat / .cmd 需要 cmd 转发', () => {
    expect(needsCmdShim('C:/x/xvlog.bat', 'win32')).toBe(true);
    expect(needsCmdShim('C:/x/xvlog.cmd', 'win32')).toBe(true);
  });

  it('Windows 上 .exe 不需要转发', () => {
    expect(needsCmdShim('C:/x/xvlog.exe', 'win32')).toBe(false);
  });

  it('非 Windows 平台一律不转发', () => {
    expect(needsCmdShim('/usr/bin/xvlog.sh', 'linux')).toBe(false);
  });
});

describe('buildSpawnPlan', () => {
  it('.exe 直接 spawn，参数原样传递', () => {
    const plan = buildSpawnPlan('C:/x/xvlog.exe', ['-version'], 'win32', COMSPEC);
    expect(plan.file).toBe('C:/x/xvlog.exe');
    expect(plan.args).toEqual(['-version']);
  });

  it('.bat 走 cmd /d /s /c，且整行被引号包住', () => {
    const plan = buildSpawnPlan('C:/x/xvlog.bat', ['-version'], 'win32', COMSPEC);
    expect(plan.file).toBe(COMSPEC);
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    const line = plan.args[3];
    expect(line.startsWith('"')).toBe(true);
    expect(line.endsWith('"')).toBe(true);
    expect(line).toContain('xvlog.bat');
    expect(line).toContain('-version');
  });

  it('路径含空格时，路径部分被单独加引号', () => {
    const plan = buildSpawnPlan(
      'C:/Program Files/Xilinx/bin/xvlog.bat',
      ['-version'],
      'win32',
      COMSPEC
    );
    expect(plan.args[3]).toBe('""C:/Program Files/Xilinx/bin/xvlog.bat" -version"');
  });

  it('路径含双引号时拒绝传参（Windows 路径不可能有双引号）', () => {
    expect(() => buildSpawnPlan('C:/x/a"b.bat', [], 'win32', COMSPEC)).toThrow(/非法字符/);
  });
});
