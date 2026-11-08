#!/usr/bin/env python3
"""文档一致性静态检查（S0 只查 3 条，宁少勿多）。

检查项：
  1. 版本号三方一致：package.json 的 version == src/core/version.ts 的 VERSION
     == docs 中出现的每一处 "vX.Y.Z build N"
  2. 表格列数一致（报具体文件与行号，能识别转义 \\|）
  3. @types/vscode 的版本 <= engines.vscode（否则会用到扩展宿主不存在的 API）

退出码：0 = PASS，1 = 有错误。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# 只检查"声明当前基线"的文档。
# 00_开发日志 是追加式历史记录（永不改写旧条目）、4x_方案 是阶段性快照，
# 两者都允许出现旧版本号，否则每次递增版本都要篡改历史。
VERSION_DOCS = ["01_项目进度.md", "90_已知问题与限制.md"]

errors: list[str] = []
notes: list[str] = []


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def parse_min_version(spec: str) -> tuple[int, int, int] | None:
    """从 '^1.90.0' / '1.90.0' / '>=1.8' 之类的写法里取最低版本号。"""
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", spec or "")
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


# ---------------------------------------------------------------- 1. 版本号

def check_versions() -> None:
    pkg = json.loads(read("package.json"))
    pkg_version = pkg.get("version", "")

    ts = read("src/core/version.ts")
    m_ver = re.search(r"""VERSION\s*=\s*['"]([^'"]+)['"]""", ts)
    m_build = re.search(r"BUILD_ID\s*=\s*(\d+)", ts)

    if not m_ver:
        errors.append("src/core/version.ts: 找不到 VERSION 定义")
        return
    if not m_build:
        errors.append("src/core/version.ts: 找不到 BUILD_ID 定义")
        return

    ts_version = m_ver.group(1)
    ts_build = int(m_build.group(1))

    if ts_version != pkg_version:
        errors.append(
            f"version.ts 的 VERSION={ts_version} 与 package.json 的 version={pkg_version} 不一致"
        )

    notes.append(f"版本基线：v{ts_version} build {ts_build}")

    # 只校验"基线声明行"（`> 最后更新：… vX.Y.Z build N`）。
    # 同一份文档里的历史证据（某阶段在哪个版本验收的）必须保持原样，
    # 否则每次递增版本都要篡改历史 —— 那和 doc_check 存在的意义正好相反。
    pattern = re.compile(r"v(\d+\.\d+\.\d+)\s+build\s+(\d+)")
    for name in VERSION_DOCS:
        doc = DOCS / name
        if not doc.exists():
            errors.append(f"docs/{name}: 文件不存在")
            continue
        text = doc.read_text(encoding="utf-8")
        found_baseline = False
        for lineno, line in enumerate(text.splitlines(), 1):
            if "最后更新" not in line:
                continue
            for m in pattern.finditer(line):
                found_baseline = True
                v, b = m.group(1), int(m.group(2))
                if v != ts_version:
                    errors.append(
                        f"docs/{doc.name}:{lineno} 基线版本号 v{v} != 代码 v{ts_version}"
                    )
                if b != ts_build:
                    errors.append(
                        f"docs/{doc.name}:{lineno} 基线 build {b} != 代码 build {ts_build}"
                    )
        if not found_baseline:
            errors.append(
                f"docs/{doc.name}: 找不到基线声明行（应为 `> 最后更新：… vX.Y.Z build N`）"
            )


# ---------------------------------------------------------------- 2. 表格列数

def table_cells(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    # 负向后顾：不把转义的 \| 当作分隔符
    return re.split(r"(?<!\\)\|", s)


def check_tables() -> None:
    for doc in sorted(DOCS.glob("*.md")):
        text = doc.read_text(encoding="utf-8")
        in_fence = False
        header_cols: int | None = None
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("```"):
                in_fence = not in_fence
                header_cols = None
                continue
            if in_fence:
                continue
            if stripped.startswith("|"):
                cols = len(table_cells(stripped))
                if header_cols is None:
                    header_cols = cols
                elif cols != header_cols:
                    errors.append(
                        f"docs/{doc.name}:{lineno} 表格列数 {cols} != 表头 {header_cols}"
                    )
            else:
                header_cols = None


# ------------------------------------------------------- 3. types/vscode 版本

def check_types_vscode() -> None:
    pkg = json.loads(read("package.json"))
    engines = pkg.get("engines", {}).get("vscode", "")
    types = pkg.get("devDependencies", {}).get("@types/vscode", "")

    if not types:
        errors.append("package.json: 缺少 devDependencies.@types/vscode")
        return

    e = parse_min_version(engines)
    t = parse_min_version(types)
    if e is None or t is None:
        errors.append(f"无法解析版本：engines.vscode={engines!r} @types/vscode={types!r}")
        return

    if t > e:
        errors.append(
            f"@types/vscode ({types}) 高于 engines.vscode ({engines})，"
            f"会导致编译通过但扩展宿主不存在该 API"
        )
    else:
        notes.append(f"@types/vscode {types} <= engines.vscode {engines}")


# ---------------------------------------------------------------------- main

def main() -> int:
    check_versions()
    check_tables()
    check_types_vscode()

    for n in notes:
        print(f"  [info] {n}")

    if errors:
        print(f"\n[doc_check] FAIL: {len(errors)} 个问题")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("[doc_check] PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
