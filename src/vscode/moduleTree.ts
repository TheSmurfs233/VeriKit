import * as vscode from 'vscode';
import {
  buildHierarchy,
  findTopCandidates,
  type HierarchyNode,
} from '../core/parse/hierarchy';
import type { ModuleIndex } from './moduleIndex';
import { generateInstantiation } from '../core/parse/instantiate';

/**
 * 模块树视图（方案 B：活动栏独立图标）。
 *
 * 语义：按"实例"展开 —— 同一模块被例化两次就是两个节点。
 * 单击节点 → 跳到该模块定义（文件 + 行号）。
 * Top 指定：自动检测候选（未被例化者）+ QuickPick，也可手动输入；
 * 选择记入工作区设置（verikit.tree.topModule），跨会话保留。
 *
 * 信号聚焦（v0.13）：
 *   - 例化节点悬停出现行内按钮「信号」→ 展开该实例的连接表（悬空标 ⚠）
 *   - 点击某条连接（信号）→ 进入聚焦模式：其他例化节点的 description 出现
 *     `→ 端口名（方向）` 箭头，扫一眼即知该信号流向哪些模块
 *   - 再点同一信号 / QuickPick 里选"取消聚焦" → 恢复
 *   - 命令面板「聚焦信号」→ QuickPick 模糊搜索全工程信号（跨层次快速定位）
 */

const TOP_KEY = 'verikit.tree.topModule';

type TreeEntry =
  | { kind: 'node'; node: HierarchyNode }
  | { kind: 'action'; label: string; command: string; icon?: string }
  | { kind: 'signalList'; node: HierarchyNode }
  | { kind: 'connection'; node: HierarchyNode; port: string; signal: string };

export class ModuleTreeProvider implements vscode.TreeDataProvider<TreeEntry> {
  private readonly emitter = new vscode.EventEmitter<TreeEntry | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  /** 展开了"信号"列表的节点（key = nodeKey） */
  private expandedSignals = new Set<string>();
  /** 当前聚焦的信号（null = 未聚焦） */
  private focusSignal: string | null = null;

  constructor(private readonly index: ModuleIndex) {
    index.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire();
  }

  setFocus(signal: string | null): void {
    this.focusSignal = signal;
    this.refresh();
  }

  get focusSignalValue(): string | null {
    return this.focusSignal;
  }

  dispose(): void {
    this.emitter.dispose();
  }

  nodeKey(node: HierarchyNode): string {
    return `${node.instFile ?? ''}:${node.line}:${node.instanceName}`;
  }

  getTreeItem(entry: TreeEntry): vscode.TreeItem {
    if (entry.kind === 'action') {
      const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
      item.command = { command: entry.command, title: entry.label };
      item.iconPath = new vscode.ThemeIcon(entry.icon ?? 'arrow-right');
      return item;
    }

    if (entry.kind === 'signalList') {
      const item = new vscode.TreeItem(
        `信号（${entry.node.connections.length}）`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon('symbol-variable');
      item.contextValue = 'signalList';
      return item;
    }

    if (entry.kind === 'connection') {
      const connected = entry.signal !== '';
      const item = new vscode.TreeItem(
        connected ? `.${entry.port} → ${entry.signal}` : `.${entry.port} → （悬空）`,
        vscode.TreeItemCollapsibleState.None
      );
      if (connected) {
        item.command = {
          command: 'verikit.focusSignal',
          title: '聚焦此信号',
          arguments: [entry.signal],
        };
      }
      item.iconPath = new vscode.ThemeIcon(connected ? 'arrow-right' : 'warning');
      item.contextValue = 'connection';
      return item;
    }

    const node = entry.node;
    const label =
      node.instanceName === node.moduleName
        ? node.moduleName
        : `${node.instanceName} : ${node.moduleName}`;
    const item = new vscode.TreeItem(
      label,
      node.children.length > 0 || this.expandedSignals.has(this.nodeKey(node))
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    if (node.file !== undefined && node.defLine !== undefined) {
      item.command = {
        command: 'verikit.openModuleDefinition',
        title: '转到模块定义',
        arguments: [vscode.Uri.file(node.file), node.defLine],
      };
    }
    if (node.unresolved) {
      item.iconPath = new vscode.ThemeIcon('warning');
      item.description = '未找到定义';
    } else if (node.conflicted) {
      item.iconPath = new vscode.ThemeIcon('error');
      item.description = '⚠ 多处定义';
    } else if (node.cycle) {
      item.iconPath = new vscode.ThemeIcon('debug-rerun');
      item.description = '↻ 循环引用';
    } else if (this.focusSignal && node.isRoot) {
      item.description = `聚焦: ${this.focusSignal}`;
      item.iconPath = new vscode.ThemeIcon('target');
    } else if (this.focusSignal && node.connections) {
      // 聚焦模式：受影响的例化节点显示箭头
      const childMod = this.index.lookup(node.moduleName);
      const dirOf = new Map((childMod?.ports ?? []).map((p) => [p.name, p.direction]));
      const hits = node.connections.filter((c) => c.signal === this.focusSignal);
      if (hits.length > 0) {
        item.description = hits
          .map((c) => `→ ${c.port}（${dirOf.get(c.port) ?? '?'}）`)
          .join(' ');
        item.iconPath = new vscode.ThemeIcon('arrow-right');
      } else {
        item.iconPath = new vscode.ThemeIcon('symbol-module');
      }
    } else if (!node.isRoot && node.connections) {
      // 常规态：例化节点的端口统计（含悬空检测）
      const childMod = this.index.lookup(node.moduleName);
      if (childMod && node.connections.length > 0) {
        const connOf = new Map(node.connections.map((c) => [c.port, c.signal]));
        let inC = 0;
        let outC = 0;
        let inoutC = 0;
        let floating = 0;
        for (const p of childMod.ports) {
          const sig = connOf.get(p.name);
          if (sig === undefined || sig === '') {
            floating += 1;
          } else if (p.direction === 'output') {
            outC += 1;
          } else if (p.direction === 'inout') {
            inoutC += 1;
          } else {
            inC += 1;
          }
        }
        const parts = [`输入 ${inC}`, `输出 ${outC}`];
        if (inoutC > 0) {
          parts.push(`双向 ${inoutC}`);
        }
        parts.push(`悬空 ${floating}`);
        item.description = parts.join(' · ');
      }
      item.iconPath = new vscode.ThemeIcon('symbol-module');
    } else {
      // 根节点常规态：模块概览
      const m = this.index.lookup(node.moduleName);
      if (m) {
        item.description = `端口 ${m.ports.length} · 参数 ${m.params.length} · 例化 ${m.children.length}`;
      }
      item.iconPath = new vscode.ThemeIcon('symbol-module');
    }
    item.contextValue = node.unresolved ? 'unresolved' : node.isRoot ? 'top' : 'module';
    return item;
  }

  async getChildren(element?: TreeEntry): Promise<TreeEntry[]> {
    if (element) {
      if (element.kind === 'signalList') {
        return element.node.connections.map((c) => ({
          kind: 'connection' as const,
          node: element.node,
          port: c.port,
          signal: c.signal,
        }));
      }
      if (element.kind !== 'node') {
        return [];
      }
      const children: TreeEntry[] = element.node.children.map((n) => ({
        kind: 'node' as const,
        node: n,
      }));
      if (this.expandedSignals.has(this.nodeKey(element.node))) {
        children.push({ kind: 'signalList' as const, node: element.node });
      }
      return children;
    }

    const top = vscode.workspace.getConfiguration().get<string>(TOP_KEY, '');
    if (!top) {
      return [
        { kind: 'action', label: '点击指定 Top 模块…', command: 'verikit.pickTopModule', icon: 'target' },
      ];
    }
    await this.index.ensureBuilt();
    const root = buildHierarchy(top, (n) => this.index.lookup(n));
    if (!root) {
      return [
        {
          kind: 'action',
          label: `模块 ${top} 未找到 — 点击重新指定…`,
          command: 'verikit.pickTopModule',
          icon: 'warning',
        },
      ];
    }
    return [{ kind: 'node', node: root }];
  }
}

async function pickTopModule(index: ModuleIndex): Promise<void> {
  await index.ensureBuilt();
  const candidates = findTopCandidates(index.all());
  const items: vscode.QuickPickItem[] = candidates.map((c) => ({
    label: c.name,
    description: c.file?.split(/[\\/]/).pop(),
  }));
  items.push({ label: '$(pencil) 手动输入模块名…' });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: '选择 Top 模块（候选 = 未被任何模块例化者）',
  });
  if (!picked) {
    return;
  }
  let name = picked.label;
  if (picked.label.includes('手动输入')) {
    const typed = await vscode.window.showInputBox({
      placeHolder: '输入模块名',
      validateInput: (v) => (index.lookup(v.trim()) ? undefined : '索引中找不到该模块名'),
    });
    name = (typed ?? '').trim();
    if (!name) {
      return;
    }
  }
  await vscode.workspace
    .getConfiguration()
    .update(TOP_KEY, name, vscode.ConfigurationTarget.Workspace);
}

/** 收集全工程信号名（来自例化连接表，去重排序）——聚焦 QuickPick 的数据源 */
function collectSignalNames(index: ModuleIndex): string[] {
  const set = new Set<string>();
  for (const m of index.all()) {
    for (const ch of m.children) {
      for (const c of ch.connections) {
        if (c.signal !== '') {
          set.add(c.signal);
        }
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function registerModuleTree(
  context: vscode.ExtensionContext,
  index: ModuleIndex,
  out: vscode.OutputChannel
): void {
  const provider = new ModuleTreeProvider(index);
  const view = vscode.window.createTreeView('verikit.moduleTree', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('verikit.pickTopModule', async () => {
      await pickTopModule(index);
      provider.refresh();
    }),
    vscode.commands.registerCommand('verikit.refreshModuleTree', () => provider.refresh()),
    vscode.commands.registerCommand(
      'verikit.toggleSignalList',
      async (entry?: unknown) => {
        if (entry && typeof entry === 'object' && (entry as TreeEntry).kind === 'node') {
          const nodeEntry = entry as Extract<TreeEntry, { kind: 'node' }>;
          const key = provider.nodeKey(nodeEntry.node);
          if (provider['expandedSignals'].has(key)) {
            provider['expandedSignals'].delete(key);
          } else {
            provider['expandedSignals'].add(key);
          }
          provider.refresh();
        }
      }
    ),
    vscode.commands.registerCommand('verikit.focusSignal', async (signal?: string) => {
      if (signal !== undefined && signal !== '') {
        // 树内点击：同信号再点 = 取消
        provider.setFocus(provider.focusSignalValue === signal ? null : signal);
        return;
      }
      await index.ensureBuilt();
      const names = collectSignalNames(index);
      if (names.length === 0) {
        void vscode.window.showInformationMessage('VeriKit：工程里还没有命名连接的信号');
        return;
      }
      const items: vscode.QuickPickItem[] = [];
      if (provider.focusSignalValue) {
        items.push({ label: '$(close) 取消聚焦' });
      }
      items.push(...names.map((n) => ({ label: n })));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `聚焦信号（当前：${provider.focusSignalValue ?? '无'}）—— 选中后模块树标注其流向`,
      });
      if (!picked) {
        return;
      }
      if (picked.label.includes('取消聚焦')) {
        provider.setFocus(null);
        return;
      }
      provider.setFocus(picked.label);
    }),
    vscode.commands.registerCommand('verikit.openInstantiation', async (entry?: unknown) => {
      if (entry && typeof entry === 'object' && (entry as TreeEntry).kind === 'node') {
        const nodeEntry = entry as Extract<TreeEntry, { kind: 'node' }>;
        const instFile = nodeEntry.node.instFile;
        if (!instFile) {
          return;
        }
        // 例化所在文件 = 父模块的定义文件；行号 = 例化处
        await vscode.commands.executeCommand(
          'verikit.openModuleDefinition',
          vscode.Uri.file(instFile),
          nodeEntry.node.line
        );
      }
    }),
    vscode.commands.registerCommand(
      'verikit.instantiateModule',
      async (entry?: unknown) => {
        await index.ensureBuilt();
        let moduleName: string | undefined;
        if (entry && typeof entry === 'object' && (entry as TreeEntry).kind === 'node') {
          const nodeEntry = entry as Extract<TreeEntry, { kind: 'node' }>;
          moduleName = nodeEntry.node.moduleName;
        }
        if (!moduleName) {
          // 命令面板入口：QuickPick 选模块
          const picked = await vscode.window.showQuickPick(
            index.moduleNames().map((n) => ({
              label: n,
              description: index.lookup(n)?.file.split(/[\\/]/).pop(),
            })),
            { placeHolder: '选择要例化的模块（生成文本复制到剪贴板）' }
          );
          moduleName = picked?.label;
        }
        if (!moduleName) {
          return;
        }
        const m = index.lookup(moduleName);
        if (!m) {
          void vscode.window.showErrorMessage(`VeriKit：模块 ${moduleName} 未找到定义`);
          return;
        }
        const text = generateInstantiation(m.name, m.params, m.ports);
        await vscode.env.clipboard.writeText(text);
        void vscode.window.showInformationMessage(
          `VeriKit：已复制例化代码 —— ${m.name}（参数 ${m.params.length}，端口 ${m.ports.length}），粘贴到目标位置即可`
        );
      }
    ),
    vscode.commands.registerCommand(
      'verikit.openModuleDefinition',
      async (uri: vscode.Uri, line: number) => {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc, { preview: true });
          const line0 = Math.min(Math.max(0, line), Math.max(0, doc.lineCount - 1));
          const range = new vscode.Range(line0, 0, line0, 0);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(range.start, range.start);
        } catch (err) {
          out.appendLine(`[tree] 打开定义失败: ${String(err)}`);
        }
      }
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(TOP_KEY)) {
        provider.refresh();
      }
    }),
    view,
    provider
  );
}
