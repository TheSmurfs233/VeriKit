import * as vscode from 'vscode';
import { buildSymbolTree, type SymbolNode } from '../core/parse/symbols';

/**
 * 文档大纲（Outline 面板）：模块 → [端口, 参数, 例化]。
 * 数据来自 core/parse/symbols.ts 的纯函数，这里只做 vscode.SymbolKind 映射与 range 构造。
 */

const KIND_MAP: Record<SymbolNode['kind'], vscode.SymbolKind> = {
  module: vscode.SymbolKind.Module,
  port: vscode.SymbolKind.Variable,
  parameter: vscode.SymbolKind.Constant,
  instance: vscode.SymbolKind.Object,
};

function toSymbol(node: SymbolNode, doc: vscode.TextDocument): vscode.DocumentSymbol {
  const safeLine = Math.min(node.line, doc.lineCount - 1);
  const range = new vscode.Range(node.line, 0, node.line, doc.lineAt(safeLine).range.end.character);
  // 模块符号的选中列精确到名字（其余符号行级即可）
  const selection =
    node.kind === 'module' && node.nameStart !== undefined
      ? new vscode.Range(
          node.line,
          node.nameStart,
          node.line,
          node.nameStart + node.name.length
        )
      : range;

  const symbol = new vscode.DocumentSymbol(node.name, node.detail, KIND_MAP[node.kind], range, selection);
  symbol.children = node.children.map((c) => toSymbol(c, doc));
  return symbol;
}

export function registerDocumentSymbols(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider('verilog', {
      provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
        return buildSymbolTree(document.getText()).map((n) => toSymbol(n, document));
      },
    })
  );
}
