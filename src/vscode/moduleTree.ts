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
 * 信号聚焦（v0.13，交互按用户设计迭代）：
 *   - 例化节点悬停出现行内按钮「信号」→ 单选展开该实例的连接表（悬空标 ⚠）
 *   - **概览（端口/参数/例化）只显示在"选中的模块"上**：默认选根，
 *     点某模块的「信号」按钮 = 选中它（概览跟随移动，根不再常驻）
 *   - 点击某条连接（信号）→ 聚焦模式：其他例化节点的 description 出现
 *     `→ 端口名（方向）` 箭头；同信号再点 = 取消
 *   - 命令面板「聚焦信号」→ QuickPick 模糊搜索全工程信号
 *   - 展开用 view.reveal 强制（叶子模块首次点击即展开，不依赖折叠状态缓存）
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

  /** 当前选中的节点 key（null = 根节点选中，根显示概览） */
  private selectedKey: string | null = null;
  /** 当前聚焦的信号（null = 未聚焦） */
  private focusSignal: string | null = null;
  /**
   * 元素缓存：同一节点永远返回同一个包装对象（只更新内容）。
   * 没有 它，reveal(旧元素) 会因身份不匹配静默失败 —— register_file 不展开的根因。
   */
  private entryCache = new Map<string, TreeEntry>();

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

  isSelected(node: HierarchyNode): boolean {
    return this.selectedKey === this.nodeKey(node);
  }

  /** 单选：点击某模块的「信号」按钮 = 选中它（再点取消，回到根选中） */
  toggleSelected(node: HierarchyNode): void {
    const key = this.nodeKey(node);
    this.selectedKey = this.selectedKey === key ? null : key;
    this.refresh();
  }

  dispose(): void {
    this.emitter.dispose();
    this.entryCache.clear();
  }

  nodeKey(node: HierarchyNode): string {
    return node.path;   // 层次路径：同模块多例化的唯一身份（修复 id 撞车）
  }

  /** 取得（或创建）节点的稳定元素：身份恒定，内容随刷新更新 */
  nodeEntryFor(node: HierarchyNode): TreeEntry {
    const key = this.nodeKey(node);
    const cached = this.entryCache.get(key);
    if (cached && cached.kind === 'node') {
      cached.node = node;   // 刷新数据，保持对象身份
      return cached;
    }
    const entry: TreeEntry = { kind: 'node', node };
    this.entryCache.set(key, entry);
    return entry;
  }

  /** 概览文本：根 = 总数；选中的实例 = 总数 + 方向细分与悬空 */
  private overviewFor(node: HierarchyNode): string {
    const m = this.index.lookup(node.moduleName);
    if (!m) {
      return '';
    }
    if (node.isRoot) {
      return `端口 ${m.ports.length} · 参数 ${m.params.length} · 例化 ${m.children.length}`;
    }
    const connOf = new Map(node.connections.map((c) => [c.port, c.signal]));
    let inC = 0;
    let outC = 0;
    let inoutC = 0;
    let floating = 0;
    for (const p of m.ports) {
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
    const dir = `输入 ${inC} · 输出 ${outC}${inoutC > 0 ? ` · 双向 ${inoutC}` : ''} · 悬空 ${floating}`;
    return `端口 ${m.ports.length}（${dir}）· 参数 ${m.params.length} · 例化 ${m.children.length}`;
  }

  getTreeItem(entry: TreeEntry): vscode.TreeItem {
    if (entry.kind === 'action') {
      const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
      item.command = { command: entry.command, title: entry.label };
      item.iconPath = new vscode.ThemeIcon(entry.icon ?? 'arrow-right');
      item.id = `action:${entry.label}`;
      return item;
    }

    if (entry.kind === 'signalList') {
      const item = new vscode.TreeItem(
        `信号（${entry.node.connections.length}）`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon('symbol-variable');
      item.contextValue = 'signalList';
      item.id = `${this.nodeKey(entry.node)}::signals`;
      return item;
    }

    if (entry.kind === 'connection') {
      const connected = entry.signal !== '';
      const known = entry.node.connections.some((c) => c.port === entry.port);
      const label = connected
        ? `.${entry.port} → ${entry.signal}`
        : known
          ? `.${entry.port} → （悬空）`
          : `.${entry.port} → （未连接）`;
      const item = new vscode.TreeItem(label,
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
      item.id = `${this.nodeKey(entry.node)}::${entry.port}`;
      return item;
    }

    const node = entry.node;
    const key = this.nodeKey(node);
    const label =
      node.instanceName === node.moduleName
        ? node.moduleName
        : `${node.instanceName} : ${node.moduleName}`;
    const item = new vscode.TreeItem(
      label,
      node.children.length > 0 || this.isSelected(node)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    item.id = `node:${key}`;
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
    } else if (this.focusSignal && node.connections.some((c) => c.signal === this.focusSignal)) {
      // 聚焦模式：受影响的例化节点显示箭头（优先于概览）
      const childMod = this.index.lookup(node.moduleName);
      const dirOf = new Map((childMod?.ports ?? []).map((p) => [p.name, p.direction]));
      item.description = node.connections
        .filter((c) => c.signal === this.focusSignal)
        .map((c) => `→ ${c.port}（${dirOf.get(c.port) ?? '?'}）`)
        .join(' ');
      item.iconPath = new vscode.ThemeIcon('arrow-right');
    } else if (this.isSelected(node)) {
      // 概览只显示在**选中的模块**上（默认选根）
      item.description = this.overviewFor(node);
      item.iconPath = new vscode.ThemeIcon('symbol-module');
    } else {
      // 未选中的实例节点：不带任何 description（保持干净）
      item.iconPath = new vscode.ThemeIcon('symbol-module');
    }
    item.contextValue = node.unresolved ? 'unresolved' : node.isRoot ? 'top' : 'module';
    return item;
  }

  /**
   * getParent：reveal 展开祖先链的必需品（没有它，reveal 对不可见元素静默失败）。
   * 同步实现：元素存在即索引已建，lookup/buildHierarchy 均为同步纯函数。
   */
  getParent(element: TreeEntry): TreeEntry | undefined {
    if (element.kind === 'signalList' || element.kind === 'connection') {
      return this.nodeEntryFor(element.node);
    }
    if (element.kind !== 'node') {
      return undefined;
    }
    const segments = element.node.path.split('/');
    if (segments.length <= 1) {
      return undefined; // 根
    }
    const top = vscode.workspace.getConfiguration().get<string>(TOP_KEY, '');
    const root = buildHierarchy(top, (n) => this.index.lookup(n));
    if (!root) {
      return undefined;
    }
    const parentPath = segments.slice(0, -1).join('/');
    let cur: HierarchyNode | undefined = root;
    for (const seg of segments.slice(1, -1)) {
      cur = cur?.children.find((c) => c.instanceName === seg);
    }
    if (!cur || cur.path !== parentPath) {
      return undefined;
    }
    return this.nodeEntryFor(cur);
  }

  async getChildren(element?: TreeEntry): Promise<TreeEntry[]> {
    if (element) {
      if (element.kind === 'signalList') {
        // 列出子模块**全端口**（未连接的也显示 ⚠），多余连接附后
        const childMod = this.index.lookup(element.node.moduleName);
        const connOf = new Map(element.node.connections.map((c) => [c.port, c.signal]));
        const rows: TreeEntry[] = [];
        if (childMod) {
          for (const p of childMod.ports) {
            rows.push({
              kind: 'connection' as const,
              node: element.node,
              port: p.name,
              signal: connOf.get(p.name) ?? '',
            });
          }
          for (const c of element.node.connections) {
            if (!childMod.ports.some((p) => p.name === c.port)) {
              rows.push({ kind: 'connection' as const, node: element.node, port: c.port, signal: c.signal });
            }
          }
        } else {
          // 未定义模块：只显示已解析的命名连接
          rows.push(
            ...element.node.connections.map((c) => ({
              kind: 'connection' as const,
              node: element.node,
              port: c.port,
              signal: c.signal,
            }))
          );
        }
        return rows;
      }
      if (element.kind !== 'node') {
        return [];
      }
      const children: TreeEntry[] = [];
      // 信号列表放**正下方**（子例化之前）—— 仅选中的节点展开它
      if (this.isSelected(element.node)) {
        children.push({ kind: 'signalList' as const, node: element.node });
      }
      children.push(
        ...element.node.children.map((n) => this.nodeEntryFor(n))   // 稳定元素
      );
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
    return [this.nodeEntryFor(root)];   // 稳定元素
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
          provider.toggleSelected(nodeEntry.node);
          provider.refresh();
          // 叶子模块（无子例化）的 TreeItem 初次渲染是 None，折叠状态缓存会吞掉
          // Expanded 翻转 —— 用 reveal 强制展开；元素必须取**缓存后**的稳定身份
          const target = provider.nodeEntryFor(nodeEntry.node);
          try {
            await view.reveal(target, { expand: 1, select: false });
          } catch {
            // 元素不在可视区时 reveal 可能失败，忽略
          }
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
