import * as vscode from 'vscode';
import { BUILD_ID, VERSION, versionBanner } from './core/version';
import { xvlogAdapter } from './core/toolchain/adapter';
import { countLines, lintFileRaw } from './core/lint/raw';
import { ToolchainService, type ToolchainSnapshot } from './vscode/toolchainService';
import { BlockPairHighlight } from './vscode/blockPairHighlight';
import { registerLiteralHover } from './vscode/literalHover';

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

/** 列出所有给 verilog / systemverilog 提供语言或 grammar 的扩展 —— 用于排查"谁在给我的文件上色" */
function describeGrammarContributors(): string[] {
  const lines: string[] = [];
  for (const ext of vscode.extensions.all) {
    const pkg = ext.packageJSON as {
      version?: string;
      contributes?: {
        languages?: { id?: string }[];
        grammars?: { language?: string; scopeName?: string; path?: string }[];
      };
    };
    const langs = (pkg.contributes?.languages ?? []).filter(
      (l) => l.id === 'verilog' || l.id === 'systemverilog'
    );
    const grams = (pkg.contributes?.grammars ?? []).filter(
      (g) =>
        g.language === 'verilog' ||
        g.language === 'systemverilog' ||
        (g.scopeName ?? '').startsWith('source.verilog')
    );
    if (langs.length === 0 && grams.length === 0) {
      continue;
    }
    lines.push(`  - ${ext.id} v${pkg.version ?? '?'}${ext.isActive ? '（已激活）' : ''}`);
    for (const g of grams) {
      lines.push(`      grammar: ${g.scopeName ?? '?'}  ->  ${g.path ?? '?'}`);
    }
    for (const l of langs) {
      lines.push(`      language: ${l.id ?? '?'}`);
    }
  }
  return lines;
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
  const pairHighlight = new BlockPairHighlight();
  registerLiteralHover(context);

  context.subscriptions.push(
    out,
    service,
    pairHighlight,

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
      const s = await service.probe({ force: true });
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

    // 排查"为什么高亮不是我写的那个 grammar"：把所有给 verilog 注册 grammar 的扩展列出来
    vscode.commands.registerCommand('verikit.inspectLanguage', () => {
      out.show(true);
      const editor = vscode.window.activeTextEditor;
      out.appendLine(`--- 语言与着色诊断 ${new Date().toISOString()} ---`);
      out.appendLine(`当前文件      : ${editor ? editor.document.fileName : '(无)'}`);
      out.appendLine(`languageId    : ${editor ? editor.document.languageId : '(无)'}`);
      out.appendLine(`本扩展路径    : ${context.extensionPath}`);
      out.appendLine('给 verilog/systemverilog 提供语言或 grammar 的扩展：');
      const rows = describeGrammarContributors();
      if (rows.length === 0) {
        out.appendLine('  (无)');
      } else {
        for (const r of rows) {
          out.appendLine(r);
        }
      }
      out.appendLine(
        rows.length > 1
          ? '⚠ 有多个扩展同时提供 verilog grammar —— 着色可能不是本扩展的。建议用「运行扩展（干净环境）」启动配置复验。'
          : '✓ 只有一个扩展提供 verilog grammar。'
      );
      out.appendLine(`当前主题      : ${vscode.workspace.getConfiguration('workbench').get('colorTheme')}`);
    }),

    // S1.5：只跑一遍、原样打印，不做解析。
    // 目的：打通"文件 → 进程 → 输出"的端到端链路，并为 S4 的解析器采集真实 fixture。
    vscode.commands.registerCommand('verikit.lintFileRaw', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('VeriKit: 请先打开一个 .v 文件。');
        return;
      }
      const doc = editor.document;
      if (!/\.v$/i.test(doc.fileName)) {
        void vscode.window.showWarningMessage('VeriKit: 当前文件不是 .v 文件。');
        return;
      }
      if (doc.isDirty) {
        // xvlog 读的是磁盘文件，未保存的改动它看不到 —— 不提示的话用户会以为检查结果不对
        void vscode.window.showWarningMessage(
          'VeriKit: 文件有未保存的改动，请先保存（检查读的是磁盘文件）。'
        );
        return;
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'VeriKit: 检查中…' },
        async () => {
          const state = await service.probe();
          if (!state.presence?.found || !state.presence.exePath) {
            out.show(true);
            out.appendLine('[lint] 未找到 xvlog，无法检查。');
            void vscode.window.showWarningMessage(
              'VeriKit: 未找到 xvlog，请先执行「VeriKit: 选择工具链可执行文件」。'
            );
            return;
          }

          const cfg = vscode.workspace.getConfiguration();
          const timeoutMs = cfg.get<number>('verikit.check.timeout', xvlogAdapter.defaultTimeoutMs);

          out.show(true);
          out.appendLine(`--- 原始检查 ${new Date().toISOString()} ---`);
          out.appendLine(`file    : ${doc.fileName}`);
          out.appendLine(`exe     : ${state.presence.exePath}`);

          const r = await lintFileRaw(xvlogAdapter, state.presence.exePath, doc.fileName, {
            timeoutMs,
          });

          const stats = countLines(`${r.stdout}\n${r.stderr}`);
          out.appendLine(
            `exit    : ${r.code ?? 'null'}   timedOut=${r.timedOut}   elapsed=${r.elapsedMs} ms`
          );
          out.appendLine(
            `lines   : total=${stats.total} INFO=${stats.info} WARNING=${stats.warning} ERROR=${stats.error} 其他=${stats.other}`
          );
          out.appendLine('--- stdout ---');
          out.appendLine(r.stdout.trimEnd() || '(empty)');
          if (r.stderr.trim()) {
            out.appendLine('--- stderr ---');
            out.appendLine(r.stderr.trimEnd());
          }
          void vscode.window.showInformationMessage(
            `VeriKit: 检查完成（${r.elapsedMs} ms），详见 Output 面板。`
          );
        }
      );
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
      await service.probe({ force: true });
    })
  );
}

export function deactivate(): void {
  channel?.dispose();
  channel = undefined;
}
