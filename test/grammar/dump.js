// 手动工具：用当前 grammar 对真实文件分词，打印每行的 token 与 scope 栈。
// 用途：当"编辑器里的颜色"和"grammar 应该产出的 scope"对不上时，
//      先用它证明 grammar 本身没问题，把怀疑方向转到 VSCode 的 grammar 绑定上。
//
//   node test/grammar/dump.js ../test-workspace/rtl/broken.v
const fs = require('node:fs');
const path = require('node:path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const target = process.argv[2];
if (!target) {
  console.error('用法: node test/grammar/dump.js <file.v> [起始行] [结束行]');
  process.exit(1);
}

const GRAMMAR = path.join(__dirname, '..', '..', 'syntaxes', 'verilog.tmLanguage.json');
const WASM = path.join(__dirname, '..', '..', 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm');

const wasmBin = fs.readFileSync(WASM);
const onigLib = oniguruma.loadWASM(wasmBin.buffer.slice(wasmBin.byteOffset, wasmBin.byteOffset + wasmBin.byteLength))
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

(async () => {
  const grammar = await registry.loadGrammar('source.verilog');
  if (!grammar) {
    console.error('grammar 加载失败');
    process.exit(1);
  }

  const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);
  const from = Number(process.argv[3] ?? 1);
  const to = Number(process.argv[4] ?? lines.length);

  let stack = vsctm.INITIAL;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const r = grammar.tokenizeLine(line, stack);
    stack = r.ruleStack;
    if (i + 1 < from || i + 1 > to) {
      continue;
    }
    console.log(`\n${String(i + 1).padStart(3)} | ${line}`);
    for (const t of r.tokens) {
      const text = line.slice(t.startIndex, t.endIndex);
      // 只打印真正被命名的 scope（去掉 source.verilog 这层根）
      const named = t.scopes.filter((s) => s !== 'source.verilog');
      const shown = named.length > 0 ? named[named.length - 1] : '(无)';
      console.log(`      ${String(t.startIndex).padStart(2)}-${String(t.endIndex).padStart(2)}  ${JSON.stringify(text).padEnd(22)} ${shown}`);
    }
  }
})();
