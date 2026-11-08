# xvlog 输出 fixture

真实 `xvlog` 输出，供 S4 的诊断解析器做回归基准。**不要手写、不要美化。**

## 内容

| 文件 | 来源样本 | exit | 说明 |
|---|---|---|---|
| `counter.stdout.txt` | `rtl/counter.v`（正常模块） | 0 | 只有 2 行 INFO，**无诊断** —— 用来验"干净文件不产生假阳性" |
| `broken.stdout.txt` | `rtl/broken.v`（2 处语法错） | 1 | 2 行 INFO + **2 行 ERROR（都在第 7 行）** —— 用来验"能拿到诊断" |
| `top.stdout.txt` | `rtl/top.v`（跨文件例化） | 0 | 只有 INFO，**零错误** —— 证明 xvlog 不做 elaborate |
| `legacy_nonansi.stdout.txt` | `rtl/legacy_nonansi.v`（非 ANSI 端口） | 0 | 只有 INFO —— 语法层面合法 |

## 唯一的改动

源文件所在目录被替换成 `/proj/`，其余字节原样保留（含行尾）。

这样 fixture 能跨机器复用，同时行格式、错误码、行号与真实一致。

## 采集方式

```bash
node test/fixtures/xvlog/capture.js
```

依赖本机 `xvlog`。可用环境变量覆盖：

```bash
XVLOG_PATH="D:\Xilinx\Vivado\2022.2\bin\xvlog.bat"  \
HDL_DIR="D:\Embedded\FPGA\test-workspace\rtl"       \
node test/fixtures/xvlog/capture.js
```

**换 Vivado 版本后必须重跑**，并对比差异 —— 差异本身说明工具链行为变了，
解析器与断言的期望值要跟着改。

## 已知行为（采集时确认）

1. **只有行号，没有列号**。诊断定位精度上限是整行。
2. **`INFO` 行不是诊断**，必须过滤，否则会产出大量假阳性。
3. **解析在首个语法错误后中止**：`broken.v` 有两处错，但只报了第 7 行那处；
   缺分号的地方没有报。所以"诊断条数"≠"错误总数"。
4. **exit code 可用但不是充分条件**：有 `ERROR` 时 `exit=1`，干净文件 `exit=0`；
   只有 `WARNING` 的情形尚未验证。
5. 每次调用都会在 cwd 生成 `xsim.dir` / `xvlog.log` / `xvlog.pb` ——
   必须用临时目录做 cwd。
