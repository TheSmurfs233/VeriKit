/**
 * 端口方向 inlay 提示的组合逻辑：
 *   例化解析（instance.ts） + 模块端口查询（调用方提供） => 每个连接项的插入点与方向标签。
 *
 * 纯函数，不 import vscode。查询不到的端口静默跳过（例：模块定义不在工程里）。
 */

import { parseInstances } from './instance';
import type { PortInfo } from './moduleHeader';

export interface PortDirectionHint {
  line: number;
  char: number;
  port: string;
  direction: string;
  moduleName: string;
}

export function computePortDirectionHints(
  text: string,
  lookup: (moduleName: string) => PortInfo[] | undefined
): PortDirectionHint[] {
  const out: PortDirectionHint[] = [];
  for (const inst of parseInstances(text)) {
    const ports = lookup(inst.moduleName);
    if (!ports || ports.length === 0) {
      continue;
    }
    const byName = new Map(ports.map((p) => [p.name, p.direction]));
    for (const conn of inst.connections) {
      const direction = byName.get(conn.port);
      if (!direction) {
        continue;
      }
      out.push({
        line: conn.endLine,
        char: conn.endChar,
        port: conn.port,
        direction,
        moduleName: inst.moduleName,
      });
    }
  }
  return out;
}
