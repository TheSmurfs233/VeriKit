// 用 vscode-oniguruma 直接测单条正则（隔离 TextMate 其余规则的影响）
const fs = require('node:fs');
const path = require('node:path');
const onig = require('vscode-oniguruma');

const wasm = fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)).then(() => {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'syntaxes', 'verilog.tmLanguage.json'), 'utf8'));
  const pat = j.repository.instance.match;
  console.log('pattern =', pat);

  const text = '    counter #(\n        .WIDTH (8)\n    ) u_counter_a (\n';
  const sc = new onig.OnigScanner([pat]);
  const str = new onig.OnigString(text);
  const r = sc.findNextMatchSync(str, 0);
  if (!r) {
    console.log('Oniguruma: 无匹配');
  } else {
    console.log('Oniguruma: match at', r.index, 'captures:', JSON.stringify(r.captureIndices));
    for (const c of r.captureIndices) {
      console.log('   ', c.index, JSON.stringify(text.slice(c.start, c.end)), c.start, c.end);
    }
  }
});
