/**
 * 工具链适配器：把"某个具体工具的名字/候选文件名/版本命令"抽出来。
 *
 * S1 只注册 xvlog 一个。S4 加 ModelSim / Icarus 时，只需往 registry 里追加，
 * 探测与状态栏逻辑一行都不用改。
 */

export type ToolId = 'xvlog';

export interface ToolAdapter {
  readonly id: ToolId;
  readonly displayName: string;
  /** 用户配置键，例如 'verikit.xvlog.path' */
  readonly configKey: string;

  /** 候选文件名，按优先级排列 —— Windows 上 .exe 优先，最后才试无扩展名的 */
  candidates(platform: NodeJS.Platform): string[];

  /** 版本查询参数；null 表示该工具不支持版本查询 */
  readonly versionArgs: string[] | null;

  /** 从版本命令输出里提取版本号 */
  parseVersion?(output: string): string | undefined;

  readonly defaultTimeoutMs: number;
}

/**
 * 实测（2026-11-08，Vivado 2022.2 / Windows）：
 *   `xvlog.bat -version` → stdout: "Vivado Simulator v2022.2"
 *   首次 2016 ms，连测三次 1002 / 977 / 1022 ms
 *   且**即使只查版本也会在 cwd 留下 xvlog.log 与 xvlog.pb** → 必须用临时目录做 cwd
 */
export const xvlogAdapter: ToolAdapter = {
  id: 'xvlog',
  displayName: 'xvlog (Vivado Simulator)',
  configKey: 'verikit.xvlog.path',
  candidates: (platform) =>
    platform === 'win32'
      ? ['xvlog.exe', 'xvlog.cmd', 'xvlog.bat', 'xvlog']
      : ['xvlog'],
  versionArgs: ['-version'],
  parseVersion: (output: string) => {
    const m = /Vivado Simulator v([\d.]+)/i.exec(output);
    return m?.[1];
  },
  defaultTimeoutMs: 15000,
};
