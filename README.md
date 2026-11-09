# VeriKit — Verilog 编辑助手

VSCode 的 Verilog **代码编写**辅助插件：语法高亮、代码补全、悬停、模块树、保存即出红线。轻量（构建产物 < 40 KB，零运行时依赖），**实测 Windows**，自用。

**不做**综合、仿真运行、工程生成。

| 项 | 值 |
|---|---|
| 扩展 ID | `qaq7321.verikit` |
| 版本 | v0.9.1（build 31） |
| 最低 VSCode | **1.143.0**（`engines.vscode`） |
| xvlog 兼容 | 2019.2 ~ 2026.x（**实测 2022.2**；换版本跑一次自检命令即可当场验证） |
| 输出通道 | `VeriKit` |
| 命令前缀 | `verikit.` |

## 功能

| 功能 | 说明 |
|---|---|
| 语法高亮 | 26 条配色规则；`begin/end` 按嵌套层级变色（6 层）；例化模块名/实例名/`.端口名` 分色；参数名黑 |
| 代码片段 | 15 条（`always` / `if` / `case` / `fsm` / `testbench` / `inst` …） |
| 语法检查 | 打开/保存触发 `xvlog`，行内红线；每文档 seq 防竞态；**解析自检哨兵**（输出格式变化时告警而非静默丢诊断） |
| 端口方向 inlay | 例化连接项 `)` 后显示 `input` / `output`（跨文件查方向） |
| 信号悬停 | 悬停变量/端口/参数 → 方向/类型/位宽/所属模块/声明行 |
| 数字悬停 | `1'b1`、`16'h22` → 无符号 + 补码有符号十进制（BigInt，任意位宽） |
| 配对高亮 | 光标在 `begin`/`end` 上 → 只高亮配对的那一对（金色） |
| 代码补全 | 连接区 `.` → 端口名（带方向）；信号/参数名；模块名（来自工作区索引） |
| 模块树 | 活动栏 VeriKit 面板；Top 自动检测候选/手动指定；单击节点跳模块定义；成环/冲突/未定义均有降级标记 |
| 探测与诊断 | 状态栏工具链状态；7 个命令；导出诊断 JSON |

## 使用

1. **安装**：扩展面板 `…` → 从 VSIX 安装 → 选择 `dist/verikit.vsix`，或
   `code --install-extension dist/verikit.vsix`
2. **工具链**：`xvlog` 在 PATH 里则免配置；否则命令面板 → `VeriKit: 选择工具链` 指定 `xvlog.bat`
   （写入全局设置 `verikit.xvlog.path`）
3. **日常**：打开/保存 `.v` → 红线自动出现；活动栏 VeriKit 图标 → 模块树（先指定 Top）；
   悬停与补全即打即用

## 兼容性

插件对 xvlog 的依赖面只有 4 项（`bin/xvlog.bat` 存在、`--version`、单文件裸编译、
消息格式 `SEVERITY: [VRFC 10-x] msg [file:line]`），均为 2019~2026 稳定面。
详见 `docs/90_已知问题与限制.md` §3；换机/升级后运行
「VeriKit: 解析器自检（版本兼容）」当场验证。

## 开发

```bash
npm install
bash verify.sh       # 六段门禁：环境自证 / 静态检查 / 单测 / grammar 断言 / 架构与文档 / 构建+打包
```

调试：按 F5，选 **「运行扩展（打开测试工作区）」** —— 弹出的扩展开发宿主直接打开
`../test-workspace/`（HDL 测试工程，含 4 层模块层次样例，见其 README）。

`.vscode/launch.json` 里有两个配置：

| 配置 | 打开的目录 | 用途 |
|---|---|---|
| 运行扩展（当前工作区） | 插件源码目录 | 只确认插件能激活 |
| **运行扩展（打开测试工作区）** | `../test-workspace` | **平时用这个** —— 弹出的窗口直接打开 HDL 测试工程 |

测试工作区与插件源码平级（`../test-workspace/`），不属于本仓库。
它包含 4 层模块层次样例（`soc_top` → `cpu_core`/`memory_ctrl`/`bus_matrix` → …）、
`broken.v`（语法检查诊断基准）、`_cycle_demo`/`_conflict_demo`（树的防环/冲突降级样本）。

### ⚠️ PowerShell 执行策略（本机已知问题）

在 PowerShell 里直接敲 `npm` 会报"禁止运行脚本"（`npm.ps1` 未签名）。三个绕法：

| 做法 | 说明 |
|---|---|
| **用 Git Bash 终端** | 最省事；`verify.sh` 本来就要求 bash |
| 用 `npm.cmd` | 走 cmd 批处理，不受策略限制 |
| 改执行策略 | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`（自行决定） |

**项目里已规避**：`.vscode/tasks.json` 的构建任务直接调 `node esbuild.js`，F5 不经过 npm。

> 日常使用（不是开发）不需要 F5：`npm run package` 后
> `code --install-extension dist/verikit.vsix` 装一次即可。
> 注意这条命令在 PowerShell 里要写成 `npm.cmd run package`。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/00_开发日志.md` | 追加式全过程日志（含每次踩坑与复盘） |
| `docs/01_项目进度.md` | **唯一**"现在做到哪"的事实来源 |
| `docs/33_配色参考.md` | 着色体系与配色调整方法 |
| `docs/42_方案_S4_语法检查.md` | 语法检查的完整方案 |
| `docs/90_已知问题与限制.md` | 已知缺陷、设计限制、版本兼容矩阵 |
| `workflow/` | 开发流程规范（阶段、门禁、测试策略、调试方法论） |

## 架构硬约束

`src/core/**` **不得 import `vscode`** —— 由 `test/arch.js` 在 `verify.sh` 中机械检查。

一旦违反，该模块将永久失去在 vitest 中被测试的可能，只能靠手动 F5 回归。

## 许可

专有版权（见 LICENSE）。自用项目，不发布市场。
