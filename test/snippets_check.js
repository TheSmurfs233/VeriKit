// 片段静态检查：防止把 VS Code 的"片段变量"和"占位符"写混。
//
// 触发背景：tb 片段里写了 `$finish`，VS Code 把它当成未知的片段变量，
// 激活时弹提示「扩展中的一个或多个代码片段很可能混淆了片段变量和片段占位符」。
// 正确写法是 `\$finish`（转义后按字面输出）。
//
// 这个检查把那条提示变成每次提交都会跑的断言 —— 否则以后每加一个 `$xxx` 系统任务
// 都会再踩一次，而且只有装了扩展才会看到提示。
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const DIR = join(process.cwd(), 'snippets');

// $ 后面不是 { 也不是数字 → 会被当成片段变量
const SUSPECT = /\$(?!\{|\d)([A-Za-z_][A-Za-z0-9_]*)/g;

// VS Code 内建的合法变量（大写是约定）
const ALLOWED = new Set([
  'TM_SELECTED_TEXT', 'TM_CURRENT_LINE', 'TM_CURRENT_WORD', 'TM_LINE_INDEX',
  'TM_LINE_NUMBER', 'TM_FILENAME', 'TM_FILENAME_BASE', 'TM_DIRECTORY',
  'TM_FILEPATH', 'RELATIVE_FILEPATH', 'CLIPBOARD', 'WORKSPACE_NAME',
  'WORKSPACE_FOLDER', 'CURRENT_YEAR', 'CURRENT_MONTH', 'CURRENT_DATE',
  'CURRENT_HOUR', 'CURRENT_MINUTE', 'CURRENT_SECOND', 'CURRENT_DAY_NAME',
  'RANDOM', 'RANDOM_HEX', 'UUID', 'BLOCK_COMMENT_START', 'BLOCK_COMMENT_END',
  'LINE_COMMENT',
]);

const errors = [];
let snippetCount = 0;

for (const file of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
  const raw = readFileSync(join(DIR, file), 'utf8');
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    errors.push(`${file}: JSON 解析失败 — ${err.message}`);
    continue;
  }
  for (const [name, def] of Object.entries(obj)) {
    snippetCount += 1;
    const body = Array.isArray(def.body) ? def.body : [def.body];
    body.forEach((line, idx) => {
      // 先把已转义的 \$ 去掉，只检查真正未转义的
      const cleaned = String(line).replace(/\\\$/g, '');
      for (const m of cleaned.matchAll(SUSPECT)) {
        if (!ALLOWED.has(m[1])) {
          errors.push(
            `${file}: 片段 "${name}" 第 ${idx + 1} 行出现未转义的 $${m[1]}（应写成 \\$${m[1]}）`
          );
        }
      }
    });
  }
}

if (errors.length > 0) {
  console.error(`[snippets] FAIL: ${errors.length} 个问题`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(`[snippets] PASS: 检查 ${snippetCount} 个片段，无未转义的 $变量`);
