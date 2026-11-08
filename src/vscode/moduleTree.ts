import * as vscode from 'vscode';
import {
  buildHierarchy,
  findTopCandidates,
  type HierarchyNode,
} from '../core/parse/hierarchy';
import type { ModuleIndex } from './moduleIndex';

/**
 * 模块树视图（方案 B：活动栏独立图标）。
 *
 * 语义：按"实例"展开 —— 同一模块被例化两次就是两个节点。
 * 单击节点 → 跳到该模块定义（文件 + 行号）。
 * Top 指定：自动检测候选（未被例化者）+ QuickPick，也可手动输入；
 * 选择记入工作区设置（verikit.tree.topModule），跨会话保留。
 */

const TOP_KEY = 'verikit.tree.topModule';

type TreeEntry =
  | { kind: 'node'; node: HierarchyNode }
  | { kind: 'action'; label: string; command: string; icon?: string };

export class ModuleTreeProvider implements vscode.TreeDataProvider<TreeEntry> {
  private readonly emitter = new vscode.EventEmitter<TreeEntry | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly index: ModuleIndex) {
    index.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }

  getTreeItem(entry: TreeEntry): vscode.TreeItem {
    if (entry.kind === 'action') {
      const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
      item.command = { command: entry.command, title: entry.label };
      item.iconPath = new vscode.ThemeIcon(entry.icon ?? 'arrow-right');
      return item;
    }

    const node = entry.node;
    const label =
      node.instanceName === node.moduleName
        ? node.moduleName
        : `${node.instanceName} : ${node.moduleName}`;
    const item = new vscode.TreeItem(
      label,
      node.children.length > 0
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
    } else {
      item.iconPath = new vscode.ThemeIcon('symbol-module');
    }
    return item;
  }

  async getChildren(element?: TreeEntry): Promise<TreeEntry[]> {
    if (element) {
      if (element.kind !== 'node') {
        return [];
      }
      return element.node.children.map((n) => ({ kind: 'node' as const, node: n }));
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
