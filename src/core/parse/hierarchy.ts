/**
 * 例化层次建树（纯函数，不 import vscode）。
 *
 * 从 top 模块递归展开：每个子实例一个节点。三个降级标记：
 *   - unresolved：模块定义在索引里找不到（leaf）
 *   - conflicted：该模块名在工程里有多处定义
 *   - cycle：子模块已在展开路径上（用户代码病态成环时防死循环）
 * 另有深度上限兜底。
 */

export interface IndexedChild {
  moduleName: string;
  instanceName: string;
  line: number;
}

/** 查询源：结构上与 vscode 层的 IndexedModule 兼容（不含 vscode 依赖） */
export interface HierarchySource {
  name: string;
  file?: string;
  line?: number;
  children: IndexedChild[];
  conflicted?: boolean;
}

export interface HierarchyNode {
  /** 显示的实例名；根节点 = 模块名本身 */
  instanceName: string;
  moduleName: string;
  /** 例化处行（0 基）；根节点 = 定义行 */
  line: number;
  /** 定义文件（找到定义才有）—— 点击跳转目标 */
  file?: string;
  /** 定义行（0 基） */
  defLine?: number;
  children: HierarchyNode[];
  unresolved?: boolean;
  conflicted?: boolean;
  cycle?: boolean;
}

export const DEFAULT_MAX_DEPTH = 32;

export function buildHierarchy(
  topName: string,
  lookup: (name: string) => HierarchySource | undefined,
  opts?: { maxDepth?: number }
): HierarchyNode | null {
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!lookup(topName)) {
    return null; // 契约：top 未找到返回 null（调用方呈现"重新指定"）
  }
  const path = new Set<string>();

  const build = (
    instanceName: string,
    moduleName: string,
    line: number,
    depth: number
  ): HierarchyNode => {
    const node: HierarchyNode = { instanceName, moduleName, line, children: [] };
    const src = lookup(moduleName);
    if (!src) {
      node.unresolved = true;
      return node;
    }
    node.file = src.file;
    node.defLine = src.line;
    node.conflicted = src.conflicted;
    if (path.has(moduleName)) {
      node.cycle = true;
      return node;
    }
    if (depth >= maxDepth) {
      return node;
    }
    path.add(moduleName);
    for (const ch of src.children) {
      node.children.push(build(ch.instanceName, ch.moduleName, ch.line, depth + 1));
    }
    path.delete(moduleName);
    return node;
  };

  return build(topName, topName, lookup(topName)?.line ?? 0, 1);
}

/** 顶层候选：没有被任何模块例化过的模块 */
export function findTopCandidates(modules: HierarchySource[]): HierarchySource[] {
  const instantiated = new Set<string>();
  for (const m of modules) {
    for (const ch of m.children) {
      instantiated.add(ch.moduleName);
    }
  }
  return modules.filter((m) => !instantiated.has(m.name));
}
