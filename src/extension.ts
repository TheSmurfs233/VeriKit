import * as vscode from 'vscode';
import { BUILD_ID, VERSION, versionBanner } from './core/version';

/**
 * 扩展入口：只做装配（注册命令 / 创建输出通道 / 推入 subscriptions），
 * 不放任何业务逻辑。业务逻辑一律进 src/core（不得 import vscode）。
 */

let channel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel('FPGA');
  channel = out;

  // 激活第一行必须是版本号：没有版本号的日志等于无法追溯的实验
  out.appendLine(versionBanner());
  out.appendLine(
    `vscode ${vscode.version} | node ${process.versions.node} | ${process.platform} ${process.arch}`
  );

  context.subscriptions.push(
    out,
    vscode.commands.registerCommand('fpga.showDiagnostics', () => {
      out.show(true);
      out.appendLine(`--- ${new Date().toISOString()} ---`);
      out.appendLine(`build    : ${versionBanner()}`);
      out.appendLine(`vscode   : ${vscode.version}`);
      out.appendLine(`node     : ${process.versions.node}`);
      out.appendLine(`platform : ${process.platform} ${process.arch}`);
      out.appendLine(`version  : ${VERSION} / BUILD_ID ${BUILD_ID}`);
      out.appendLine(`toolchain: 未配置（S1 实现）`);
    })
  );
}

export function deactivate(): void {
  channel?.dispose();
  channel = undefined;
}
