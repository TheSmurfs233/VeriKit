/**
 * 一键例化文本生成（纯函数，不 import vscode）。
 *
 * 格式按用户提供的模板（2026-11-09）：
 *   - 无缩进（粘贴位置由用户决定）
 *   - 参数表：`模块名 # (` … `.参数名(参数名)` … `)` 独立一行
 *   - 无参数时省略参数表块
 *   - 实例名默认 `<模块名>_inst`
 *   - 端口：`.端口名(端口名)` 每行一个，同名连线
 *   - 尾行 `);`
 *
 * 范围：v1 按 ANSI 端口表生成；非 ANSI 模块的端口表为空 → 只生成骨架。
 */

export interface InstantiateName {
  name: string;
}

export function generateInstantiation(
  moduleName: string,
  params: readonly InstantiateName[],
  ports: readonly InstantiateName[],
  instName?: string
): string {
  const inst = instName ?? `${moduleName}_inst`;

  const paramBlock =
    params.length > 0
      ? `${moduleName} # (\n${params.map((p) => `.${p.name}(${p.name})`).join(',\n')}\n)\n`
      : `${moduleName} `;

  const portLines = ports.map((p) => `.${p.name}(${p.name})`).join(',\n');
  return `${paramBlock}${inst} (\n${portLines}\n);`;
}
