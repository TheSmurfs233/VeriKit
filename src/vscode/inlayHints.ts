import * as vscode from 'vscode';
import { parseModuleHeaders } from '../core/parse/moduleHeader';
import { computePortDirectionHints } from '../core/parse/inlay';
import type { ModuleIndex } from './moduleIndex';

/**
 * 端口方向 Inlay Hints：
 *   在例化的每个命名连接项 `)` 之后显示 input / output / inout 虚影。
 *
 * 模块查找顺序：当前文档 → 工作区索引（打开的文档覆盖磁盘版本）。
 * 当前文档里刚写的模块立即生效，不依赖索引刷新。
 */

export class PortDirectionInlayHints implements vscode.InlayHintsProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.emitter.event;

  constructor(private readonly index: ModuleIndex) {
    this.index.onDidChange(() => this.emitter.fire());
  }

  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range
  ): Promise<vscode.InlayHint[]> {
    const text = document.getText();
    const headers = parseModuleHeaders(text);
    const localNames = new Set(headers.map((h) => h.name));

    await this.index.ensureBuilt();

    const hints = computePortDirectionHints(text, (mod) => {
      if (localNames.has(mod)) {
        // 当前文档里有定义：以当前内容为准（哪怕是没保存的修改）
        const h = headers.find((x) => x.name === mod);
        return h && h.ports.length > 0 ? h.ports : undefined;
      }
      return this.index.lookup(mod);
    });

    return hints
      .filter((h) => range.contains(new vscode.Position(h.line, h.char)))
      .map((h) => {
        const hint = new vscode.InlayHint(
          new vscode.Position(h.line, h.char),
          h.direction,
          vscode.InlayHintKind.Parameter
        );
        hint.paddingLeft = true;
        hint.tooltip = new vscode.MarkdownString(
          `\`${h.port}\` 是模块 \`${h.moduleName}\` 的 **${h.direction}** 端口`
        );
        return hint;
      });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export function registerPortDirectionInlay(
  context: vscode.ExtensionContext,
  index: ModuleIndex
): void {
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider('verilog', new PortDirectionInlayHints(index))
  );
}
