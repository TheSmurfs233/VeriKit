/**
 * 索引重建（纯函数，不 import vscode）。
 *
 * 回归背景（v0.9.0 实测 bug）：磁盘扫描与"打开的文档"会对同一文件各调用一次
 * 索引 —— 第二次时模块定义被误判成"多处定义"（同一文件与自己冲突 → 全部 ⚠），
 * 而例化挂接代码没有跟着跳过 → 子实例成倍重复。
 *
 * 因此本函数内置**按文件去重**（后出现的覆盖前者：打开的文档覆盖磁盘版本），
 * 即使调用方传入重复文件也不会产生冲突或重复 children。
 */

import { parseInstances } from './instance';
import { findModuleRanges } from './signals';
import { parseModuleHeaders, type HeaderParam, type PortInfo } from './moduleHeader';

export interface IndexedChild {
  moduleName: string;
  instanceName: string;
  /** 例化处行（0 基） */
  line: number;
}

export interface IndexedModuleData {
  name: string;
  /** 定义文件 */
  file: string;
  /** module 关键字行（0 基） */
  line: number;
  ports: PortInfo[];
  params: HeaderParam[];
  children: IndexedChild[];
  /** 该模块名在**不同文件**中有多处定义 */
  conflicted?: boolean;
}

export interface IndexResult {
  modules: Map<string, IndexedModuleData>;
  /** 同名多处定义（仅统计不同文件） */
  conflicts: Map<string, string[]>;
}

export interface IndexedFile {
  file: string;
  text: string;
}

export function rebuildIndex(files: IndexedFile[]): IndexResult {
  // 按文件去重：后出现的覆盖前者（打开的文档优先于磁盘版本）
  const byFile = new Map<string, string>();
  for (const f of files) {
    byFile.set(f.file, f.text);
  }

  const modules = new Map<string, IndexedModuleData>();
  const conflicts = new Map<string, string[]>();

  for (const [file, text] of byFile) {
    // —— 模块定义（端口/参数/行号；同名且**不同文件** → 冲突） ——
    for (const h of parseModuleHeaders(text)) {
      const existing = modules.get(h.name);
      if (existing) {
        const list = conflicts.get(h.name) ?? [existing.file];
        if (!list.includes(file)) {
          list.push(file);
        }
        conflicts.set(h.name, list);
        continue;
      }
      modules.set(h.name, {
        name: h.name,
        file,
        line: h.line ?? 0,
        ports: h.ports,
        params: h.params,
        children: [],
      });
    }
    // —— 例化归属：按模块行范围挂到所属模块（层次图的边） ——
    const ranges = findModuleRanges(text);
    for (const inst of parseInstances(text)) {
      const ownerRange = ranges.find(
        (r) => inst.startLine >= r.startLine && inst.startLine <= r.endLine
      );
      if (!ownerRange) {
        continue;
      }
      const owner = modules.get(ownerRange.name);
      if (!owner || owner.file !== file) {
        continue;
      }
      owner.children.push({
        moduleName: inst.moduleName,
        instanceName: inst.instanceName,
        line: inst.startLine,
      });
    }
  }

  for (const name of conflicts.keys()) {
    const m = modules.get(name);
    if (m) {
      m.conflicted = true;
    }
  }

  return { modules, conflicts };
}
