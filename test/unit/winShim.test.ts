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

  it('.bat 走 cmd /d /s /c call，路径与参数各自成为独立 argv', () => {
    const plan = buildSpawnPlan('C:/x/xvlog.bat', ['-version'], 'win32', COMSPEC);
    expect(plan.file).toBe(COMSPEC);
    expect(plan.args).toEqual(['/d', '/s', '/c', 'call', 'C:/x/xvlog.bat', '-version']);
  });

  it('不自己拼接整条命令行（避免被 Node 的 argv 转义破坏）', () => {
    const plan = buildSpawnPlan('C:/x/xvlog.bat', ['-version'], 'win32', COMSPEC);
    // 任何一项都不应该带外层引号，也不应该含反斜杠转义
    for (const a of plan.args) {
      expect(a).not.toContain('\\"');
    }
    expect(plan.args).toHaveLength(6);
  });

  it('含空格的路径原样作为一个 argv 传递给 Node 去加引号', () => {
    const plan = buildSpawnPlan(
      'C:/Program Files/Xilinx/bin/xvlog.bat',
      ['-version'],
      'win32',
      COMSPEC
    );
    expect(plan.args).toContain('C:/Program Files/Xilinx/bin/xvlog.bat');
  });

  it('含 cmd 元字符时拒绝传参', () => {
    expect(() => buildSpawnPlan('C:/x/a"b.bat', [], 'win32', COMSPEC)).toThrow(/无法安全转义/);
    expect(() => buildSpawnPlan('C:/x/a.bat', ['a&b'], 'win32', COMSPEC)).toThrow(/无法安全转义/);
  });
});
