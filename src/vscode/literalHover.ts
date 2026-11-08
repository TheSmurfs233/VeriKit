import * as vscode from 'vscode';
import { convertLiteral, formatNumberConversion, parseBasedLiteralFromLine } from '../core/literal/convert';

/**
 * 数字字面量悬停：光标停在 1'b1 / 16'h22 这类带基数字面量上时，
 * 显示无符号与补码有符号两种十进制解释（参考 TerosHDL 的 Number Conversion）。
 *
 * 触发范围：整个字面量（包括位宽部分 16、基数字母 h、数字 22）。
 * 注释与字符串里不触发。
 */
export function registerLiteralHover(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('verilog', {
      provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const line = document.lineAt(position.line).text;
        const lit = parseBasedLiteralFromLine(line, position.character);
        if (!lit) {
          return undefined;
        }
        const conv = convertLiteral(lit);
        const md = new vscode.MarkdownString(formatNumberConversion(lit, conv));
        md.isTrusted = false;
        const range = new vscode.Range(
          position.line,
          lit.rangeStart,
          position.line,
          lit.rangeEnd
        );
        return new vscode.Hover(md, range);
      },
    })
  );
}
