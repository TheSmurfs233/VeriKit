/**
 * xvlog 输出解析（S4 核心，纯函数）。
 *
 * 格式来自真实输出（fixture 见 test/fixtures/xvlog/，2026-11-08 实测采集）：
 *   INFO: [VRFC 10-2263] Analyzing Verilog file "/proj/broken.v" into library work
 *   ERROR: [VRFC 10-4982] syntax error near 'input' [/proj/broken.v:7]
 *
 * 规则：
 *   - 只有 ERROR / WARNING 成为诊断；INFO 计入 dropped.info（它们不是诊断）
 *   - 不匹配的非空行计入 dropped.other —— **这是解析器自检哨兵**：
 *     xvlog 格式变化导致漏解析时，dropped.other > 0 会暴露它，而不是让红线悄悄消失
 *   - 行号 1-based（与 VSCode Diagnostic 一致）；列号 xvlog 不提供，统一 0
 */

export type DiagSeverity = 'error' | 'warning';

export interface DiagItem {
  /** xvlog 回显的文件路径（原样保留；本插件 v1 单文件检查，诊断直接归到被检文档） */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 错误码，如 'VRFC 10-4982' */
  code: string;
  message: string;
  severity: DiagSeverity;
}

export interface ParseResult {
  items: DiagItem[];
  dropped: { info: number; other: number };
}

const LINE_RE =
  /^(ERROR|WARNING|INFO):\s*\[([A-Za-z]+ [\d-]+)\]\s*(.*?)(?:\s*\[(.+):(\d+)\])?\s*$/;

export function parseXvlogOutput(text: string): ParseResult {
  const items: DiagItem[] = [];
  const dropped = { info: 0, other: 0 };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      continue;
    }
    const m = LINE_RE.exec(line);
    if (!m) {
      dropped.other += 1;
      continue;
    }
    const severity = m[1].toLowerCase();
    if (severity === 'info') {
      dropped.info += 1;
      continue;
    }
    if (m[4] === undefined || m[5] === undefined) {
      // 理论上不应出现（实测 xvlog 的 ERROR/WARNING 都带 [文件:行号]）；
      // 一旦出现则按未识别处理，让自检哨兵暴露
      dropped.other += 1;
      continue;
    }
    items.push({
      file: m[4],
      line: Number(m[5]),
      code: m[2],
      message: m[3],
      severity: severity as DiagSeverity,
    });
  }
  return { items, dropped };
}
