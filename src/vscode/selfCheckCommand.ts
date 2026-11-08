import * as vscode from 'vscode';
import { runParserSelfCheck } from '../core/diag/selfcheck';
import { xvlogAdapter } from '../core/toolchain/adapter';
import type { ToolchainService } from './toolchainService';

/**
 * 解析器自检命令（版本兼容验证）。
 *
 * 用途：换机 / 升级 Vivado（2019~2026 任意版本）后，跑一次即可当场确认
 * 解析器对"这台机器上这个版本"的输出是否兼容；不兼容时给出取证指引。
 */
export function registerParserSelfCheck(
  context: vscode.ExtensionContext,
  service: ToolchainService,
  out: vscode.OutputChannel
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('verikit.selfCheckParser', async () => {
      out.show(true);
      out.appendLine(`--- 解析器自检 ${new Date().toISOString()} ---`);

      const state = await service.probe();
      if (state.disabled || !state.presence?.found || !state.presence.exePath) {
        out.appendLine('[selfcheck] 工具链不可用，无法自检');
        void vscode.window.showErrorMessage('VeriKit：工具链不可用，无法自检');
        return;
      }
      const ver = service.current.version?.version ?? '未知版本';
      out.appendLine(`[selfcheck] 工具链：${state.presence.exePath}（${ver}）`);

      const cfg = vscode.workspace.getConfiguration();
      const timeoutMs = cfg.get<number>('verikit.check.timeout', xvlogAdapter.defaultTimeoutMs);

      await out;
      const r = await runParserSelfCheck(xvlogAdapter, state.presence.exePath, { timeoutMs });

      out.appendLine(
        `[selfcheck] 诊断 ${r.diagCount} 条 / 未识别 ${r.unrecognized} 行 / INFO ${r.infoCount} 条忽略 / 耗时 ${r.elapsedMs} ms`
      );
      for (const n of r.notes) {
        out.appendLine(`[selfcheck] - ${n}`);
      }

      if (r.pass) {
        out.appendLine('[selfcheck] ✅ 该版本与解析器兼容');
        void vscode.window.showInformationMessage(
          `VeriKit：解析器自检通过 —— 当前 xvlog 输出可正常解析（诊断 ${r.diagCount} 条）`
        );
      } else {
        out.appendLine('[selfcheck] ❌ 该版本与解析器不兼容');
        void vscode.window.showErrorMessage(
          'VeriKit：解析器自检未通过 —— 请把 Output 面板的 [selfcheck] 段落发给我取证'
        );
      }
    })
  );
}
