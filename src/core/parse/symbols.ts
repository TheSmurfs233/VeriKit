/**
 * 文档大纲的符号树（纯函数，不 import vscode）。
 *
 * 结构：模块 → [端口, 参数, 例化]（子符号）。选中和范围都给**行级**精度 ——
 * 大纲点击导航到行即可，标识符级定位是 v2 的事。
 */

import { findModuleRanges, parseSignalDeclarations } from './signals';
import { parseInstances } from './instance';

export interface SymbolNode {
  name: string;
  /** 与 vscode.SymbolKind 对应的语义（在 vscode 层转换） */
  kind: 'module' | 'port' | 'parameter' | 'instance';
  detail: string;
  /** 符号所在行（0 基）—— 点击导航目标 */
  line: number;
  children: SymbolNode[];
  // —— vscode 层构造 range 用的扩展字段（仅模块符号填） ——
  /** 模块名在定义行的起始列 */
  nameStart?: number;
  /** 模块体最后一行 */
  endLine?: number;
}

export function buildSymbolTree(text: string): SymbolNode[] {
  const lines = text.split('\n');
  const ranges = findModuleRanges(text);
  const decls = parseSignalDeclarations(text);
  const instances = parseInstances(text);

  return ranges.map((r) => {
    const ports: SymbolNode[] = decls
      .filter((d) => d.module === r.name && d.kind === 'port')
      .map((d) => ({
        name: d.name,
        kind: 'port' as const,
        detail: [d.direction, d.typeWord, d.range].filter(Boolean).join(' '),
        line: d.line,
        children: [],
      }));
    const params: SymbolNode[] = decls
      .filter((d) => d.module === r.name && d.kind === 'parameter')
      .map((d) => ({
        name: d.name,
        kind: 'parameter' as const,
        detail: d.value !== undefined ? `= ${d.value}` : '',
        line: d.line,
        children: [],
      }));
    const insts: SymbolNode[] = instances
      .filter((i) => i.startLine >= r.startLine && i.startLine <= r.endLine)
      .map((i) => ({
        name: `${i.instanceName} : ${i.moduleName}`,
        kind: 'instance' as const,
        detail: i.connections.length > 0 ? `命名连接 ×${i.connections.length}` : '',
        line: i.startLine,
        children: [],
      }));

    // 模块名的选择列（大纲点击落到名字上）
    const lineText = lines[r.startLine] ?? '';
    const nameMatch = /\bmodule\s+([A-Za-z_]\w*)/.exec(lineText);
    const nameStart = nameMatch ? nameMatch.index + nameMatch[0].length - nameMatch[1].length : 0;

    return {
      name: r.name,
      kind: 'module' as const,
      detail: `端口 ${ports.length} · 参数 ${params.length} · 例化 ${insts.length}`,
      line: r.startLine,
      children: [...ports, ...params, ...insts],
      nameStart,
      endLine: r.endLine,
    };
  });
}
