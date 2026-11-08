import * as vscode from 'vscode';
import { formatSignalHover, parseSignalDeclarations } from '../core/parse/signals';

/**
 * 信号悬停：光标停在标识符（信号/端口/参数）上 → 显示声明信息
 * （方向 / 类型 / 位宽 / 所属模块 / 声明行，参数带值）。
 *
 * v1 范围：仅当前文档。跨文件（例化模块的端口、其他文件的信号）等 S3b 索引
 * 正式化后再接入 —— 届时把索引里的声明合并进 parseSignalDeclarations 的结果即可。
 */
export function registerSignalHover(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('verilog', {
      provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const word = document.getWordRangeAtPosition(position);
        if (!word) {
          return undefined;
        }
        const name = document.getText(word);
        if (!name) {
          return undefined;
        }

        let decls;
        try {
          decls = parseSignalDeclarations(document.getText()).filter((d) => d.name === name);
        } catch {
          return undefined;
        }
        if (decls.length === 0) {
          return undefined;
        }

        const md = new vscode.MarkdownString(formatSignalHover(name, decls));
        md.isTrusted = false;
        return new vscode.Hover(md, word);
      },
    })
  );
}
