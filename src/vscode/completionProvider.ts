import * as vscode from 'vscode';
import { parseInstances } from '../core/parse/instance';
import { findEnclosingInstance } from '../core/parse/completion';
import {
  portCompletions,
  signalCompletions,
  moduleCompletions,
  type CompletionCandidate,
} from '../core/parse/completion';
import { parseModuleHeaders } from '../core/parse/moduleHeader';
import type { ModuleIndex } from './moduleIndex';

/**
 * 代码补全（三个来源合并）：
 *   1. 连接区内（前缀以 `.` 结尾）→ 该模块的端口名（detail 为方向）
 *   2. 其他位置 → 当前文档声明的信号/参数
 *   3. 模块名（来自模块索引）—— 写例化时补全
 *
 * 触发字符注册为 `.`；其余场景由 VSCode 在输入时自动调用本 provider。
 */

const KIND_MAP: Record<CompletionCandidate['kind'], vscode.CompletionItemKind> = {
  port: vscode.CompletionItemKind.Field,
  net: vscode.CompletionItemKind.Variable,
  variable: vscode.CompletionItemKind.Variable,
  parameter: vscode.CompletionItemKind.Constant,
  module: vscode.CompletionItemKind.Module,
};

function toItems(cands: CompletionCandidate[]): vscode.CompletionItem[] {
  return cands.map((c) => {
    const item = new vscode.CompletionItem(c.label, KIND_MAP[c.kind]);
    if (c.detail) {
      item.detail = c.detail;
    }
    return item;
  });
}

export function registerVerilogCompletion(
  context: vscode.ExtensionContext,
  index: ModuleIndex
): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'verilog',
      {
        async provideCompletionItems(
          document: vscode.TextDocument,
          position: vscode.Position
        ): Promise<vscode.CompletionItem[] | undefined> {
          const text = document.getText();
          const line = document.lineAt(position.line).text;
          const before = line.slice(0, position.character);

          // —— 1. 连接区：前缀以 `.` 结尾 → 端口名补全 ——
          if (/\.([A-Za-z0-9_]*)$/.test(before)) {
            const inst = findEnclosingInstance(parseInstances(text), position.line, position.character);
            if (!inst) {
              return undefined;
            }
            // 当前文档里定义的模块优先（未保存的修改立即生效），其次工作区索引
            const local = parseModuleHeaders(text).find((h) => h.name === inst.moduleName);
            let ports = local && local.ports.length > 0 ? local.ports : undefined;
            if (!ports) {
              await index.ensureBuilt();
              ports = index.lookup(inst.moduleName);
            }
            if (!ports || ports.length === 0) {
              return undefined;
            }
            return toItems(portCompletions(ports));
          }

          // —— 2. 信号 / 参数（当前文档声明） ——
          // —— 3. 模块名（工作区索引） ——
          const signalItems = toItems(signalCompletions(text));
          await index.ensureBuilt();
          const moduleItems = toItems(moduleCompletions(index.moduleNames()));
          return [...signalItems, ...moduleItems];
        },
      },
      '.' // 触发字符：连接表里敲 . 立即弹出端口列表
    )
  );
}
