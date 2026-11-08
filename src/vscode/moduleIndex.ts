import * as vscode from 'vscode';
import { rebuildIndex, type IndexedModuleData } from '../core/parse/indexer';

/**
 * 模块索引 v2：模块名 → 定义信息（文件/行/端口/参数/**子实例**）。
 *
 * children 是层次树的边（谁例化了谁）；file/line 支撑"跳转到模块定义"。
 * 同名多处定义（**不同文件**）→ 冲突记录 + ⚠ 标记。
 *
 * 重建为纯函数（core/parse/indexer.ts，可单测）：磁盘文件与打开的文档合并传入，
 * 按文件去重（打开的文档覆盖磁盘版本）—— 修复过"同一文件索引两次导致全部 ⚠
 * 且实例翻倍"的 bug。
 */

export type IndexedModule = IndexedModuleData;

export class ModuleIndex implements vscode.Disposable {
  private map = new Map<string, IndexedModuleData>();
  private conflicts = new Map<string, string[]>();
  private built = false;
  private dirty = true;
  private building: Promise<void> | null = null;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    const mark = (): void => {
      this.dirty = true;
      this.changeEmitter.fire();
    };
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === 'verilog' || /\.v(h)?$/i.test(e.document.fileName)) {
          mark();
        }
      }),
      vscode.workspace.onDidOpenTextDocument(mark),
      vscode.workspace.onDidCloseTextDocument(mark),
      vscode.workspace.onDidCreateFiles(mark),
      vscode.workspace.onDidDeleteFiles(mark),
      vscode.workspace.onDidRenameFiles(mark)
    );
  }

  async ensureBuilt(): Promise<void> {
    if (this.built && !this.dirty) {
      return;
    }
    if (this.building) {
      return this.building;
    }
    this.building = this.rebuild().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  private async rebuild(): Promise<void> {
    // 打开的文档优先收录（含未保存内容）；磁盘扫描时跳过它们，避免同文件重复索引
    const files: { file: string; text: string }[] = [];
    const openPaths = new Set<string>();
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === 'verilog') {
        files.push({ file: doc.fileName, text: doc.getText() });
        openPaths.add(doc.fileName);
      }
    }
    const uris = await vscode.workspace.findFiles('**/*.{v,vh}', '**/{node_modules,dist,.git}/**');
    for (const uri of uris) {
      if (openPaths.has(uri.fsPath)) {
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        files.push({ file: uri.fsPath, text: new TextDecoder().decode(bytes) });
      } catch {
        // 单个文件失败不影响整体
      }
    }

    const { modules, conflicts } = rebuildIndex(files);
    this.map = modules;
    this.conflicts = conflicts;
    this.built = true;
    this.dirty = false;
    this.changeEmitter.fire();
  }

  lookup(name: string): IndexedModuleData | undefined {
    return this.map.get(name);
  }

  moduleNames(): string[] {
    return [...this.map.keys()];
  }

  all(): IndexedModuleData[] {
    return [...this.map.values()];
  }

  isConflicted(name: string): boolean {
    return this.conflicts.has(name);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.changeEmitter.dispose();
  }
}
