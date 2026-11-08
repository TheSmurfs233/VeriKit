import * as vscode from 'vscode';
import { findModuleRanges } from '../core/parse/signals';
import { parseInstances } from '../core/parse/instance';
import { parseModuleHeaders, type PortInfo, type HeaderParam } from '../core/parse/moduleHeader';

/**
 * 模块索引 v2：模块名 → 定义信息（文件/行/端口/参数/**子实例**）。
 *
 * children 是层次树的边（谁例化了谁）；file/line 支撑"跳转到模块定义"。
 * 同名多处定义 → 保留首个，冲突记录在 conflicts（树节点会标 ⚠）。
 *
 * 仍是 lite：verikit.* 配置变化 / 文件变化 → 标脏，下次查询全量重扫。
 * 失效时机：verilog 文档变化 / 打开 / 关闭 / 工作区文件增删改 → 下次查询时重建。
 */

export interface IndexedChild {
  moduleName: string;
  instanceName: string;
  /** 例化处行（0 基） */
  line: number;
}

export interface IndexedModule {
  name: string;
  /** 定义文件（fsPath） */
  file: string;
  /** module 关键字行（0 基） */
  line: number;
  ports: PortInfo[];
  params: HeaderParam[];
  children: IndexedChild[];
  /** 该模块名在工程中有多处定义 */
  conflicted?: boolean;
}

export class ModuleIndex implements vscode.Disposable {
  private map = new Map<string, IndexedModule>();
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
    const map = new Map<string, IndexedModule>();
    const conflicts = new Map<string, string[]>();

    const indexOne = (text: string, file: string): void => {
      // —— 模块定义（端口/参数/行号；同名多处 → 冲突记录，保留首个） ——
      for (const h of parseModuleHeaders(text)) {
        if (map.has(h.name)) {
          const list = conflicts.get(h.name) ?? [map.get(h.name)!.file];
          list.push(file);
          conflicts.set(h.name, list);
          continue;
        }
        map.set(h.name, {
          name: h.name,
          file,
          line: h.line ?? 0,
          ports: h.ports,
          params: h.params ?? [],
          children: [],
        });
      }
      // —— 例化归属：按模块行范围挂到所属模块（层次图的边） ——
      const ranges = findModuleRanges(text);
      for (const inst of parseInstances(text)) {
        const ownerRange = ranges.find(
          (r) => inst.startLine >= r.startLine && inst.startLine <= r.endLine
        );
        if (!ownerRange) {
          continue;
        }
        const owner = map.get(ownerRange.name);
        if (!owner || owner.file !== file) {
          continue; // 冲突被跳过的那份定义，其例化不索引
        }
        owner.children.push({
          moduleName: inst.moduleName,
          instanceName: inst.instanceName,
          line: inst.startLine,
        });
      }
    };

    const uris = await vscode.workspace.findFiles('**/*.{v,vh}', '**/{node_modules,dist,.git}/**');
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        indexOne(new TextDecoder().decode(bytes), uri.fsPath);
      } catch {
        // 单个文件失败不影响整体
      }
    }

    // 已打开的文档覆盖磁盘版本（未保存内容立即生效）
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId !== 'verilog') {
        continue;
      }
      indexOne(doc.getText(), doc.fileName);
    }

    // 冲突标记
    for (const name of conflicts.keys()) {
      const m = map.get(name);
      if (m) {
        m.conflicted = true;
      }
    }

    this.map = map;
    this.conflicts = conflicts;
    this.built = true;
    this.dirty = false;
    this.changeEmitter.fire();
  }

  lookup(name: string): IndexedModule | undefined {
    return this.map.get(name);
  }

  moduleNames(): string[] {
    return [...this.map.keys()];
  }

  all(): IndexedModule[] {
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
