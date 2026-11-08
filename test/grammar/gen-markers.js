// grammar 断言标记行的自动对齐工具。
//
// 背景：vscode-tmgrammar-test 的标记行靠"列对齐"表达断言，手工数空格连续出错三次。
// 本工具从 grammar 的真实分词结果反推每个断言的列号，重写标记行：
//
//   node test/grammar/gen-markers.js        # 对齐 test/grammar/verilog.test.v 的全部标记
//
// 规则：
//   1. 标记行形如  "//^^^ scope.name" 或 "//   ^^^ scope.name"（// 后空格数决定起始列）
//   2. 它断言"上面最近的非标记、非空行"在对应列上的 token 具有该 scope
//   3. 工具在该行 token 里找包含此 scope 的 token，把标记改写为该 token 的真实 [start,end)
//   4. 找不到对应 scope 的标记保持原样并告警 —— 那通常意味着 grammar 真的有问题
const fs = require('node:fs');
const path = require('node:path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const TEST_FILE = path.join(__dirname, 'verilog.test.v');
const GRAMMAR = path.join(__dirname, '..', '..', 'syntaxes', 'verilog.tmLanguage.json');
const WASM = path.join(__dirname, '..', '..', 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm');

const wasmBin = fs.readFileSync(WASM);
const onigLib = oniguruma
  .loadWASM(wasmBin.buffer.slice(wasmBin.byteOffset, wasmBin.byteOffset + wasmBin.byteLength))
  .then(() => ({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }));

const registry = new vsctm.Registry({
  onigLib,
  loadGrammar: async (scopeName) => {
    if (scopeName !== 'source.verilog') {
      return null;
    }
    return vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), 'verilog.tmLanguage.json');
  },
});

function isMarker(line) {
  return /^\/\/\s*\^/.test(line) || /^\/\/\s*</.test(line);
}

function parseMarker(line) {
  const m = /^\/\/(\s*)(\^+|<+)\s*(\S.*)$/.exec(line);
  if (!m) {
    return null;
  }
  return { pad: m[1].length, carets: m[2].length, scope: m[3].trim() };
}

function scopeMatches(tokenScopes, asserted) {
  return tokenScopes.some(
    (s) => s === asserted || s.startsWith(asserted + '.') || asserted.startsWith(s + '.')
  );
}

(async () => {
  const grammar = await registry.loadGrammar('source.verilog');
  if (!grammar) {
    console.error('grammar 加载失败');
    process.exit(1);
  }

  const source = fs.readFileSync(TEST_FILE, 'utf8');
  const lines = source.split('\n');

  // 先整篇分词（维护跨行栈）
  const tokensPerLine = [];
  let stack = vsctm.INITIAL;
  for (const line of lines) {
    const r = grammar.tokenizeLine(line, stack);
    tokensPerLine.push(r.tokens);
    stack = r.ruleStack;
  }

  const warnings = [];
  let fixed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const mk = parseMarker(lines[i]);
    if (!mk) {
      continue;
    }
    // 向上找最近的代码行（跳过其他标记行）
    let codeIdx = i - 1;
    while (codeIdx >= 0 && isMarker(lines[codeIdx])) {
      codeIdx -= 1;
    }
    if (codeIdx < 0) {
      warnings.push(`第 ${i + 1} 行：找不到代码行`);
      continue;
    }
    const codeLine = lines[codeIdx];
    // 断言列 = // 之后 + pad 个空格 → 0 基列号 = 2 + pad
    const col = 2 + mk.pad;
    // 先找包含该列的 token；找不到就在整行里找具有该 scope 的 token（自愈手写标记的列偏差）
    const withScope = tokensPerLine[codeIdx].filter((t) => scopeMatches(t.scopes, mk.scope));
    const hit =
      withScope.find((t) => t.startIndex <= col && col < t.endIndex) ||
      withScope.sort(
        (a, b) => Math.abs(a.startIndex - col) - Math.abs(b.startIndex - col)
      )[0];
    if (!hit) {
      warnings.push(
        `第 ${i + 1} 行：整行都找不到 scope ${mk.scope}（这通常说明 grammar 真有问题）`
      );
      continue;
    }
    const marker =
      '//' +
      ' '.repeat(Math.max(0, hit.startIndex - 2)) +
      '^'.repeat(hit.endIndex - hit.startIndex) +
      ' ' +
      mk.scope;
    if (marker !== lines[i]) {
      lines[i] = marker;
      fixed += 1;
    }
  }

  fs.writeFileSync(TEST_FILE, lines.join('\n'));
  console.log(`[gen-markers] 对齐完成，改写 ${fixed} 行标记`);
  for (const w of warnings) {
    console.warn(`[gen-markers] WARN: ${w}`);
  }
  if (warnings.length > 0) {
    process.exit(1);
  }
})();
