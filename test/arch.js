// 架构约束检查：src/core/** 不得依赖 vscode
//
// 为什么这条要机械化：一旦某个 core 模块 import 了 vscode，它就只能跑在扩展宿主里，
// 永久失去在 vitest 中被测试的可能。这个过程是无声的 —— 当时不会有任何报错，
// 三个月后才会发现"整个 core 都测不了"，那时已经改不动了。
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = process.cwd();
const CORE_DIR = join(ROOT, 'src', 'core');

const FORBIDDEN = [
  /from\s+['"]vscode['"]/, // import x from 'vscode'
  /require\(\s*['"]vscode['"]\s*\)/, // require('vscode')
  /import\(\s*['"]vscode['"]\s*\)/, // await import('vscode')
];

/** 递归收集目录下的 .ts 文件 */
function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  let files;
  try {
    files = collect(CORE_DIR);
  } catch {
    console.error(`[arch] FAIL: 找不到目录 src/core`);
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (FORBIDDEN.some((re) => re.test(line))) {
        violations.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  if (violations.length > 0) {
    console.error(`[arch] FAIL: src/core 中出现了对 vscode 的依赖（${violations.length} 处）`);
    for (const v of violations) {
      console.error(`  ${v}`);
    }
    console.error(`\n修正方向：把 vscode 相关部分拆到 src/vscode/，core 只保留纯逻辑。`);
    process.exit(1);
  }

  console.log(`[arch] PASS: 检查 ${files.length} 个 core 文件，0 violation`);
}

main();
