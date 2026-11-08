import * as vscode from 'vscode';
import { parseModuleHeaders, type PortInfo } from '../core/parse/moduleHeader';

/**
 * 模块索引（S3b 的 lite 版）：
 *   全量扫描工作区里的 .v/.vh 文件，解析模块头，建立 模块名 → 端口列表 的映射。
 *
 * 为什么是 lite：
 *   - 每次失效后全量重扫，不做增量/持久化。自用工程规模（几十个文件）完全够用。
 *   - 将来 S3b 正式做增量索引时替换内部实现，lookup 接口不变。
 *
 * 失效时机：verilog 文档变化 / 打开 / 关闭 / 工作区文件增删改 → 标脏，下次查询时重建。
 */

export class ModuleIndex implements vscode.Disposable {
  private map = new Map<string, PortInfo[]>();
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

  /** 需要时重建；并发调用会合并为同一次重建 */
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
    const map = new Map<string, PortInfo[]>();
    const uris = await vscode.workspace.findFiles('**/*.{v,vh}', '**/{node_modules,dist,.git}/**');
    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        for (const h of parseModuleHeaders(new TextDecoder().decode(bytes))) {
          if (h.ports.length > 0) {
            map.set(h.name, h.ports);
          }
        }
      } catch {
        // 单个文件读不了/解析不了不影响整体
      }
    }

    // 已打开的文档覆盖磁盘版本（可能是未保存的新内容）
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId !== 'verilog') {
        continue;
      }
      for (const h of parseModuleHeaders(doc.getText())) {
        if (h.ports.length > 0) {
          map.set(h.name, h.ports);
        }
      }
    }

    this.map = map;
    this.built = true;
    this.dirty = false;
    this.changeEmitter.fire();
  }

  lookup(name: string): PortInfo[] | undefined {
    return this.map.get(name);
  }

  /** 已索引的模块名清单（补全用） */
  moduleNames(): string[] {
    return [...this.map.keys()];
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.changeEmitter.dispose();
  }
}
