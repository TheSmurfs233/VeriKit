// 采集真实 xvlog 输出作为 fixture（手动运行，不参与门禁）。
//
//   node test/fixtures/xvlog/capture.js
//
// 唯一的改动：把源文件所在目录替换成 `/proj/`，其余字节原样保留。
// 目的：fixture 可跨机器复用，同时保持行格式、错误码、行列号与真实一致。
//
// 换机器/换 Vivado 版本后重跑，并对比差异 —— 差异本身说明工具链行为变了。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const XVLOG = process.env.XVLOG_PATH || 'D:\\Xilinx\\Vivado\\2022.2\\bin\\xvlog.bat';
const SRC_DIR = process.env.HDL_DIR || 'D:\\Embedded\\FPGA\\test-workspace\\rtl';
const OUT_DIR = __dirname;

const CASES = ['counter.v', 'broken.v', 'top.v', 'legacy_nonansi.v'];

const comspec = process.env.ComSpec || 'cmd.exe';
const isBat = /\.(bat|cmd)$/i.test(XVLOG);

function run(file) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xvlog-capture-'));
  const t0 = Date.now();
  const res = isBat
    ? spawnSync(comspec, ['/d', '/s', '/c', 'call', XVLOG, file], { cwd: workDir, encoding: 'utf8' })
    : spawnSync(XVLOG, [file], { cwd: workDir, encoding: 'utf8' });
  const elapsed = Date.now() - t0;
  fs.rmSync(workDir, { recursive: true, force: true });
  return {
    elapsed,
    code: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function normalize(text) {
  // 同时处理正斜杠与反斜杠两种形态
  return text
    .split(SRC_DIR).join('/proj')
    .split(SRC_DIR.replace(/\\/g, '/')).join('/proj')
    .replace(/\r\n/g, '\n');
}

let ok = 0;
for (const name of CASES) {
  const full = path.join(SRC_DIR, name);
  if (!fs.existsSync(full)) {
    console.log(`skip ${name}（文件不存在）`);
    continue;
  }
  const r = run(full);
  const base = name.replace(/\.v$/, '');
  fs.writeFileSync(path.join(OUT_DIR, `${base}.stdout.txt`), normalize(r.stdout), 'utf8');
  if (r.stderr.trim()) {
    fs.writeFileSync(path.join(OUT_DIR, `${base}.stderr.txt`), normalize(r.stderr), 'utf8');
  }
  const lines = normalize(r.stdout).split('\n').filter((l) => l.trim()).length;
  console.log(
    `${name.padEnd(20)} exit=${r.code} ${String(r.elapsed).padStart(5)} ms  ${lines} 行  -> ${base}.stdout.txt`
  );
  ok += 1;
}
console.log(`\n完成 ${ok} 个样本 -> ${OUT_DIR}`);
