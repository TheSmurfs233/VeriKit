import * as vscode from 'vscode';
import { BUILD_ID, VERSION, versionBanner } from './core/version';
import { xvlogAdapter } from './core/toolchain/adapter';
import { ToolchainService, type ToolchainSnapshot } from './vscode/toolchainService';

/**
 * 扩展入口：只做装配（创建通道 / 注册命令 / 推入 subscriptions），不含业务逻辑。
 * 业务逻辑一律进 src/core（不得 import vscode）。
 *
 * ⚠️ activate 里**不许**探测工具链：实测一次探测约 1 s，而本插件是 onStartupFinished，
 * 每个窗口都会加载。见 docs/10 §5.3。
 */

const CHANNEL_NAME = 'VeriKit';

let channel: vscode.OutputChannel | undefined;

function buildDiagnosticsPayload(service: ToolchainService): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration();
  const snapshot: ToolchainSnapshot = service.current;
  return {
    plugin: { name: 'verikit', version: VERSION, build: BUILD_ID },
    host: {
      vscode: vscode.version,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    config: {
      toolchain: cfg.get('verikit.toolchain'),
      xvlogPath: cfg.get(xvlogAdapter.configKey),
      timeout: cfg.get('verikit.check.timeout'),
      scanDirs: cfg.get('verikit.probe.scanDirs'),
    },
    toolchain: {
      probing: snapshot.probing,
      disabled: snapshot.disabled,
      presence: snapshot.presence,
      version: snapshot.version,
    },
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel(CHANNEL_NAME);
  channel = out;

  // 激活第一行必须是版本号：没有版本号的日志等于无法追溯的实验
  const activatedAt = Date.now();
  out.appendLine(versionBanner());
  out.appendLine(
    `vscode ${vscode.version} | node ${process.versions.node} | ${process.platform} ${process.arch}`
  );
  // 第二行之后不再有同步 I/O；activate 结束时间差可作为"未被阻塞"的证据
  out.appendLine(`activate: bootstrap done in ${Date.now() - activatedAt} ms`);

  const service = new ToolchainService(out);

  context.subscriptions.push(
    out,
    service,

    vscode.commands.registerCommand('verikit.showDiagnostics', () => {
      out.show(true);
      const s = service.current;
      out.appendLine(`--- ${new Date().toISOString()} ---`);
      out.appendLine(`build    : ${versionBanner()}`);
      out.appendLine(`vscode   : ${vscode.version}`);
      out.appendLine(`node     : ${process.versions.node}`);
      out.appendLine(`platform : ${process.platform} ${process.arch}`);
      out.appendLine(`toolchain: ${s.disabled ? '已禁用' : s.probing ? '探测中' : s.presence?.found ? '就绪' : '未探测/未找到'}`);
      if (s.presence?.found) {
        out.appendLine(`xvlog    : ${s.presence.exePath} (${s.presence.source})`);
      }
      if (s.version?.version) {
        out.appendLine(`version  : ${s.version.version} (查询耗时 ${s.version.elapsedMs} ms)`);
      }
    }),

    vscode.commands.registerCommand('verikit.exportDiagnostics', () => {
      out.show(true);
      const json = JSON.stringify(buildDiagnosticsPayload(service), null, 2);
      out.appendLine(`--- 诊断导出 ${new Date().toISOString()} ---`);
      out.appendLine(json);
      void vscode.window.showInformationMessage('VeriKit: 诊断信息已输出到 Output 面板。');
    }),

    vscode.commands.registerCommand('verikit.probeToolchain', async () => {
      const s = await service.probe();
      if (s.disabled) {
        void vscode.window.showInformationMessage('VeriKit: 语法检查已禁用（verikit.toolchain = none）。');
        return;
      }
      if (s.presence?.found) {
        void vscode.window.showInformationMessage(
          `VeriKit: 已找到 ${s.presence.exePath}${s.version?.version ? `（v${s.version.version}）` : ''}`
        );
      } else {
        void vscode.window.showWarningMessage(
          'VeriKit: 未找到 xvlog。执行「VeriKit: 选择工具链可执行文件」手动指定，或在设置中配置 verikit.xvlog.path。'
        );
      }
    }),

    vscode.commands.registerCommand('verikit.pickToolchain', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: `选择 ${xvlogAdapter.displayName} 可执行文件`,
        openLabel: '使用此文件',
        filters:
          process.platform === 'win32'
            ? { 可执行文件: ['exe', 'cmd', 'bat'] }
            : undefined,
      });
      if (!picked?.length) {
        return;
      }
      // 写用户级设置：路径是机器属性，不能进工作区设置（否则会被提交到仓库）
      await vscode.workspace
        .getConfiguration()
        .update(xvlogAdapter.configKey, picked[0].fsPath, vscode.ConfigurationTarget.Global);
      await service.probe();
    })
  );
}

export function deactivate(): void {
  channel?.dispose();
  channel = undefined;
}
