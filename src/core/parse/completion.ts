/**
 * 补全候选收集（纯函数，不 import vscode）。
 *
 * 三个补全源：
 *   1. 连接区内的端口名（. 触发）—— 来自例化解析 + 模块端口查询
 *   2. 信号/参数名 —— 来自信号声明解析（当前文档）
 *   3. 模块名 —— 来自模块索引（调用方传入）
 */

import type { InstanceInfo } from './instance';
import { parseSignalDeclarations } from './signals';
import type { PortInfo } from './moduleHeader';

export interface CompletionCandidate {
  label: string;
  kind: 'port' | 'net' | 'variable' | 'parameter' | 'module';
  /** 展示在补全项右侧的说明，如 "input [CNT_W-1:0]" */
  detail: string;
}

/** 光标是否落在某个例化的连接区内；是则返回该例化 */
export function findEnclosingInstance(
  insts: InstanceInfo[],
  line: number,
  char: number
): InstanceInfo | null {
  for (const inst of insts) {
    const afterOpen =
      line > inst.openLine || (line === inst.openLine && char >= inst.openChar);
    const beforeEnd =
      line < inst.endLine || (line === inst.endLine && char <= inst.endChar);
    if (afterOpen && beforeEnd) {
      return inst;
    }
  }
  return null;
}

/** 端口名补全候选（按模块端口表） */
export function portCompletions(ports: PortInfo[]): CompletionCandidate[] {
  return ports.map((p) => ({
    label: p.name,
    kind: 'port' as const,
    detail: p.direction ?? '',
  }));
}

/** 信号/参数补全候选（当前文档声明；同名去重，端口优先于变量） */
export function signalCompletions(text: string): CompletionCandidate[] {
  const map = new Map<string, CompletionCandidate>();
  const rank: Record<CompletionCandidate['kind'], number> = { port: 0, net: 1, variable: 2, parameter: 3, module: 4 };
  for (const d of parseSignalDeclarations(text)) {
    const prev = map.get(d.name);
    if (prev && rank[prev.kind] <= rank[d.kind]) {
      continue;
    }
    const detail = [d.direction, d.typeWord, d.range].filter(Boolean).join(' ');
    map.set(d.name, { label: d.name, kind: d.kind, detail });
  }
  return [...map.values()];
}

/** 模块名补全候选（调用方传模块名清单） */
export function moduleCompletions(names: string[]): CompletionCandidate[] {
  return names.map((n) => ({ label: n, kind: 'module' as const, detail: 'module' }));
}
