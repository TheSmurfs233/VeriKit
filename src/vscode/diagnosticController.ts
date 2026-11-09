import * as vscode from 'vscode';
import type { DiagItem } from '../core/diag/parse';

/**
 * 诊断的唯一写入者（单一 owner）：
 *   - 正常更新：collection.set(uri, diags) —— 替换语义，其他文件不受影响，不闪烁
 *   - 工具链缺失 / 禁用：clearAll() —— 整簇清空，不留残迹
 *   - 单文件关闭：delete(uri)
 */

export class DiagnosticController implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('verikit');
  }

  /**
   * 把解析结果写到文档上。
   * @param items 解析出的诊断（行号 1-based）
   * @param timedOut 超时时传 true —— 不写任何诊断（不展示过期结果）
   */
  setFor(uri: vscode.Uri, doc: vscode.TextDocument, items: DiagItem[], timedOut: boolean): void {
    const diags: vscode.Diagnostic[] = [];
    if (!timedOut) {
      for (const it of items) {
        const line = Math.max(0, it.line - 1); // 1-based → 0-based
        const lineRange = doc.validateRange(
          new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER)
        );
        const diag = new vscode.Diagnostic(
          lineRange,
          `${it.code}: ${it.message}`,
          it.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning
        );
        diag.source = 'verikit';
        diag.code = it.code;
        diags.push(diag);
      }
    }
    // S4 说明文案：xvlog 首个语法错误后中止解析，不承诺一次性列出全部错误
    const lastErr = [...diags].reverse().find(
      (x) => x.severity === vscode.DiagnosticSeverity.Error
    );
    if (lastErr) {
      lastErr.message +=
        '\n\n[VeriKit] xvlog 在首个语法错误后中止解析：可能还有未显示的错误；修复后保存会自动重查。';
    }
    this.collection.set(uri, diags);
  }

  clearAll(): void {
    this.collection.clear();
  }

  delete(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  dispose(): void {
    this.collection.dispose();
  }
}
