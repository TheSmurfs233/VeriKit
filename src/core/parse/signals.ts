/**
 * 信号声明解析（S3a 延伸）：从文档里收集"端口 / 线网 / 变量 / 参数"的声明信息，
 * 供悬停提示使用（悬停在标识符上 → 显示方向/类型/位宽/所属模块/声明行）。
 *
 * 纯函数，不 import vscode。
 *
 * 范围声明（v1）：
 *   - ANSI 端口：复用 parseModuleHeaders（已带行号）
 *   - 体内声明按**行**解析，且要求以分号结尾 —— 因此头端口表（以逗号/右括号结尾）
 *     不会被重复收录；代价是跨行的体内声明识别不了
 *   - 参数值保留原文（如 2'd0）；换算可复用 literal/convert，此处不做
 */

import {
  blankComments,
  parseModuleHeaders,
  type PortDirection,
  type PortInfo,
} from './moduleHeader';

export interface SignalInfo {
  name: string;
  kind: 'port' | 'net' | 'variable' | 'parameter';
  /** 端口方向（仅端口有） */
  direction?: string;
  /** 位宽原文，如 [CNT_W-1:0] */
  range?: string;
  /** 类型/关键字原词：reg / wire / logic / parameter ... */
  typeWord?: string;
  /** 参数值原文（仅参数有） */
  value?: string;
  module: string;
  /** 声明所在行（0 基） */
  line: number;
  /** 声明行原文（去注释、trim） */
  text: string;
}

const HEAD_RE =
  /^(input|output|inout|reg|wire|logic|bit|byte|int|shortint|longint|integer|real|realtime|time|parameter|localparam|tri\d?|tri0|tri1|wand|wor|supply0|supply1|genvar)\b(.*)$/;

const TYPE_WORDS = new Set([
  'reg', 'logic', 'bit', 'byte', 'int', 'shortint', 'longint', 'integer',
  'real', 'realtime', 'time', 'signed', 'unsigned', 'automatic', 'static',
  'genvar',
]);

const DIRECTIONS = new Set(['input', 'output', 'inout']);
const NET_WORDS = new Set(['wire', 'tri', 'tri0', 'tri1', 'wand', 'wor', 'supply0', 'supply1', 'trior']);

/** 模块体范围（module 关键字行 → endmodule 行，均 0 基；未闭合收录到文件尾） */
export function findModuleRanges(
  text: string
): { name: string; startLine: number; endLine: number }[] {
  const lines = blankComments(text).split('\n');
  const out: { name: string; startLine: number; endLine: number }[] = [];
  let cur: { name: string; startLine: number; endLine: number } | null = null;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const s = lines[idx].trim();
    const m = /^module\s+([A-Za-z_]\w*)/.exec(s);
    if (m && !cur) {
      cur = { name: m[1], startLine: idx, endLine: idx };
    }
    if (/\bendmodule\b/.test(s) && cur) {
      cur.endLine = idx;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

/**
 * 收集**体内**端口声明（非 ANSI 模块的端口来源）：
 *   `module m (a, b); input wire a; output reg b; ...` 的方向写在模块体里，
 *   头解析拿不到 —— 用信号声明扫描补齐（只取 kind=port 且有方向的条目，按文件顺序）。
 *
 * 返回：模块名 → 端口列表（含行号）。ANSI 模块的体里不应有端口声明；
 * 若有（病态写法），调用方应优先用头端口表，忽略本结果。
 */
export function collectBodyPorts(text: string): Map<string, PortInfo[]> {
  const out = new Map<string, PortInfo[]>();
  for (const d of parseSignalDeclarations(text)) {
    if (d.kind !== 'port' || !d.direction) {
      continue;
    }
    const list = out.get(d.module) ?? [];
    list.push({ name: d.name, direction: d.direction as PortDirection, line: d.line });
    out.set(d.module, list);
  }
  return out;
}

/** 单模块便捷版：体内端口（无则空数组） */
export function bodyPortsForModule(text: string, moduleName: string): PortInfo[] {
  return collectBodyPorts(text).get(moduleName) ?? [];
}

export function parseSignalDeclarations(text: string): SignalInfo[] {
  const out: SignalInfo[] = [];
  const seen = new Set<string>();
  const clean = blankComments(text);
  const lines = clean.split('\n');

  // —— 1. ANSI 端口（带行号，来自模块头解析） ——
  for (const h of parseModuleHeaders(text)) {
    for (const p of h.ports) {
      if (p.line === undefined) {
        continue;
      }
      const key = `${p.name}@${p.line}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        name: p.name,
        kind: 'port',
        direction: p.direction,
        range: p.range,
        typeWord: p.typeWord,
        module: h.name,
        line: p.line,
        text: (lines[p.line] ?? '').trim(),
      });
    }
  }

  // —— 1.5 头参数表（声明侧 #( parameter X = v )，带行号） ——
  for (const h of parseModuleHeaders(text)) {
    for (const p of h.params ?? []) {
      if (p.line === undefined) {
        continue;
      }
      const key = `${p.name}@${p.line}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        name: p.name,
        kind: 'parameter',
        typeWord: 'parameter',
        value: p.value,
        module: h.name,
        line: p.line,
        text: (lines[p.line] ?? '').trim(),
      });
    }
  }

  // —— 2. 模块体内的逐行声明（要求行尾分号；跨行声明 v1 不支持） ——
  const ranges = findModuleRanges(clean);
  const moduleOf = (idx: number): string | undefined =>
    ranges.find((r) => idx >= r.startLine && idx <= r.endLine)?.name;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const mod = moduleOf(idx);
    if (!mod) {
      continue;
    }
    const line = lines[idx].trim();
    if (!line.endsWith(';')) {
      continue;
    }
    const m = HEAD_RE.exec(line);
    if (!m) {
      continue;
    }
    const head = m[1];
    const rest = m[2].replace(/[;\s]+$/, '').replace(/\)+$/, '').trim();

    const typeInRest = (/\b(reg|wire|logic|integer|bit|byte|int|shortint|longint|real|time|tri\d?|wand|wor|supply0|supply1)\b/.exec(rest) ?? [])[0];
    const rangeMatch = /\[[^\]]*\]/.exec(rest);
    const range = rangeMatch ? rangeMatch[0] : undefined;
    let namesPart = rest.replace(/\[[^\]]*\]/g, ' ');

    if (head === 'parameter' || head === 'localparam') {
      const pm = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(namesPart.trim());
      if (!pm) {
        continue;
      }
      const key = `${pm[1]}@${idx}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        name: pm[1],
        kind: 'parameter',
        typeWord: head,
        value: pm[2].trim(),
        module: mod,
        line: idx,
        text: line,
      });
      continue;
    }

    // 去掉类型关键字与方向关键字，剩下的就是名字列表（非 ANSI 的 output reg a; 也覆盖）
    namesPart = namesPart.replace(
      /[A-Za-z_][A-Za-z0-9_$]*/g,
      (w) => (w === head || NET_WORDS.has(w) || TYPE_WORDS.has(w) ? ' ' : w)
    );
    const kind: SignalInfo['kind'] = DIRECTIONS.has(head)
      ? 'port'
      : NET_WORDS.has(head)
        ? 'net'
        : 'variable';
    const direction = DIRECTIONS.has(head) ? head : undefined;

    for (const rawName of namesPart.trim().split(/\s*,\s*/)) {
      const name = rawName.replace(/[();]/g, '').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
        continue;
      }
      const key = `${name}@${idx}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        name,
        kind,
        direction,
        range,
        typeWord: kind === 'port' ? typeInRest : head,
        module: mod,
        line: idx,
        text: line,
      });
    }
  }
  return out;
}


/** 悬停 Markdown（中文，与插件其他 tooltip 一致） */
export function formatSignalHover(name: string, decls: SignalInfo[]): string {
  const kindLabel: Record<SignalInfo['kind'], string> = {
    port: '端口',
    net: '线网',
    variable: '变量',
    parameter: '参数',
  };
  const lines: string[] = [];
  if (decls.length === 1) {
    const d = decls[0];
    const parts: string[] = [];
    if (d.kind === 'port' && d.direction) {
      parts.push(`方向 \`${d.direction}\``);
    }
    if (d.typeWord) {
      parts.push(`类型 \`${d.typeWord}\``);
    }
    if (d.range) {
      parts.push(`位宽 \`${d.range}\``);
    }
    if (d.value !== undefined) {
      parts.push(`值 \`${d.value}\``);
    }
    lines.push(`**${name}** — ${kindLabel[d.kind]}${d.direction ? `（${d.direction}）` : ''}`);
    if (parts.length > 0) {
      lines.push(`- ${parts.join('，')}`);
    }
    lines.push(`- 所属模块：\`${d.module}\`（第 ${d.line + 1} 行声明）`);
    lines.push('');
    lines.push('```verilog');
    lines.push(d.text);
    lines.push('```');
    return lines.join('\n');
  }

  lines.push(`**${name}** — 匹配到 ${decls.length} 处声明：`);
  for (const d of decls.slice(0, 5)) {
    const bits = [d.direction, d.typeWord, d.range].filter(Boolean).join(' ');
    lines.push(`- \`${d.module}\` 第 ${d.line + 1} 行${bits ? ` · ${bits}` : ''} · ${kindLabel[d.kind]}`);
  }
  if (decls.length > 5) {
    lines.push(`- ……其余 ${decls.length - 5} 处`);
  }
  return lines.join('\n');
}
