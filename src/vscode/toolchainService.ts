import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { xvlogAdapter, type ToolAdapter } from '../core/toolchain/adapter';
import { probePresence, type PresenceResult } from '../core/toolchain/detect';
import { readVersion, type VersionProbe } from '../core/toolchain/version';

/**
 * 工具链探测的"状态持有者"。
 *
 * 三条硬要求（来自 docs/10 §5.3 与 docs/41）：
 *   1. **绝不在 activate 里探测** —— 探测要起子进程，实测单次约 1 s
 *   2. 结果缓存；配置变更才失效
 *   3. 失败不弹窗，只在状态栏与日志里说清楚
 */

export interface ToolchainSnapshot {
  probing: boolean;
  disabled: boolean;
  presence?: PresenceResult;
  version?: VersionProbe;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

const SCAN_DIR_KEY = 'verikit.probe.scanDirs';
const TOOLCHAIN_KEY = 'verikit.toolchain';
const TIMEOUT_KEY = 'verikit.check.timeout';

export class ToolchainService implements vscode.Disposable {
  private snapshot: ToolchainSnapshot = { probing: false, disabled: false };
  private readonly item: vscode.StatusBarItem;
  private readonly out: vscode.OutputChannel;
  private readonly adapter: ToolAdapter;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(out: vscode.OutputChannel, adapter: ToolAdapter = xvlogAdapter) {
    this.out = out;
    this.adapter = adapter;

    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'verikit.probeToolchain';
    this.render();
    this.item.show();

    this.disposables.push(
      this.item,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('verikit')) {
          return;
        }
        this.scheduleReprobe();
      })
    );
  }

  get current(): ToolchainSnapshot {
    return this.snapshot;
  }

  /** 配置连续变更时只探测一次 */
  private scheduleReprobe(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.probe();
    }, 300);
  }

  /**
   * 执行一次探测。`force` 仅表示"允许覆盖已有结果"，本实现里没有额外缓存层，
   * 真正的缓存体现在"没人调用就不探测"。
   */
  async probe(): Promise<ToolchainSnapshot> {
    if (this.snapshot.probing) {
      return this.snapshot;
    }

    const cfg = vscode.workspace.getConfiguration();
    const toolchain = cfg.get<string>(TOOLCHAIN_KEY, 'xvlog');

    if (toolchain === 'none') {
      this.snapshot = { probing: false, disabled: true };
      this.out.appendLine('[probe] 已禁用（verikit.toolchain = none），跳过探测');
      this.render();
      return this.snapshot;
    }

    this.snapshot = { ...this.snapshot, probing: true };
    this.render();

    const configuredPath = cfg.get<string>(this.adapter.configKey, '');
    const scanDirs = cfg.get<string[]>(SCAN_DIR_KEY, []);
    this.out.appendLine(
      `[probe] start toolchain=${this.adapter.id} configured="${configuredPath}" scanDirs=${scanDirs.length}`
    );

    const presence = await probePresence(
      { adapter: this.adapter, configuredPath, scanDirs },
      { platform: process.platform, env: process.env, isFile, isDirectory }
    );

    this.out.appendLine(
      presence.found
        ? `[probe] presence: found via ${presence.source}  ${presence.exePath}  (${presence.elapsedMs} ms)`
        : `[probe] presence: NOT found, ${presence.attempts.length} attempts (${presence.elapsedMs} ms)`
    );

    let version: VersionProbe | undefined;
    if (presence.found && presence.exePath) {
      const timeoutMs = cfg.get<number>(TIMEOUT_KEY, this.adapter.defaultTimeoutMs);
      version = await readVersion(this.adapter, presence.exePath, { timeoutMs });
      this.out.appendLine(
        `[probe] version: ${version.version ?? '未知'}  (${version.elapsedMs} ms)` +
          (version.error ? `  error=${version.error}` : '')
      );
      // 拿不到版本时把原始输出打出来 —— 否则只能靠外部脚本复现（S1 踩过一次：53 ms 就失败，日志里什么都没有）
      if (!version.version && version.raw) {
        this.out.appendLine(
          `[probe]   raw code=${version.raw.code ?? 'null'} timedOut=${version.raw.timedOut}`
        );
        this.out.appendLine(`[probe]   stdout=${JSON.stringify(version.raw.stdout.slice(0, 300))}`);
        this.out.appendLine(`[probe]   stderr=${JSON.stringify(version.raw.stderr.slice(0, 300))}`);
      }
    }

    for (const a of presence.attempts) {
      if (a.result !== 'ok') {
        this.out.appendLine(`[probe]   tried ${a.via}: ${a.target} -> ${a.result}`);
      }
    }

    this.snapshot = { probing: false, disabled: false, presence, version };
    this.render();
    return this.snapshot;
  }

  private render(): void {
    const s = this.snapshot;

    if (s.disabled) {
      this.item.text = '$(circle-slash) VeriKit';
      this.item.tooltip = 'VeriKit: 语法检查已禁用（verikit.toolchain = none）';
      return;
    }

    if (s.probing) {
      this.item.text = '$(sync~spin) VeriKit';
      this.item.tooltip = 'VeriKit: 正在探测工具链…';
      return;
    }

    const p = s.presence;
    if (p?.found) {
      const v = s.version?.version;
      this.item.text = `$(chip) xvlog${v ? ` ${v}` : ''}`;
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**VeriKit · 工具链已就绪**\n\n`);
      md.appendMarkdown(`- 路径：\`${p.exePath}\`\n`);
      md.appendMarkdown(`- 来源：${p.source}\n`);
      md.appendMarkdown(`- 版本：${v ?? '未知'}\n`);
      if (s.version?.elapsedMs) {
        md.appendMarkdown(`- 版本查询耗时：${s.version.elapsedMs} ms\n`);
      }
      md.appendMarkdown(`\n点击重新探测`);
      this.item.tooltip = md;
      return;
    }

    this.item.text = '$(warning) VeriKit';
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**VeriKit · 未找到 xvlog**\n\n已尝试：\n`);
    for (const a of (p?.attempts ?? []).slice(0, 8)) {
      md.appendMarkdown(`- ${a.via}: \`${a.target}\` → ${a.result}\n`);
    }
    md.appendMarkdown(
      `\n执行 **VeriKit: 选择工具链可执行文件** 手动指定，或配置 \`${this.adapter.configKey}\`。`
    );
    this.item.tooltip = md;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
