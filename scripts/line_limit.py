#!/usr/bin/env python3
"""行数硬限检查门（D16）：单方法/函数（去空行注释）≤100 行；单文件（去空行注释）≤1000 行。

用法：python scripts/line_limit.py [路径...]   # 默认扫描 agent/ web/src/ web/frontend/src/
退出码：0=全部合规；1=存在超限（CI/提交前门禁用）。
范围：.py/.java/.ts/.vue；Python 函数级用 ast 精确测量；Java/TS 方法级做括号深度粗测（复核以评审为准）。
"""
import ast
import io
import os
import re
import sys

FUNC_LIMIT = 100
FILE_LIMIT = 1000
SKIP_DIRS = {"__pycache__", "e2b-dev-sidecar", ".venv", "node_modules", "dist", "target"}
EXTS = (".py", ".java", ".ts", ".vue")


def effective_lines(text: str) -> int:
    s = re.sub(r"/\*.*?\*/", "", text, flags=re.S)      # Java/TS 块注释
    s = re.sub(r"//[^\n]*", "", s)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)         # Vue 模板注释
    return sum(1 for l in s.splitlines()
               if l.strip() and not l.strip().startswith(("#", "*", "///")))


def py_functions(path: str):
    src = io.open(path, encoding="utf-8").read()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            span = src.splitlines()[node.lineno - 1:node.end_lineno]
            eff = sum(1 for l in span if l.strip() and not l.strip().startswith("#"))
            yield node.name, eff, node.lineno


def jvm_methods(path: str):
    """粗测：以带返回类型/可见性的签名行起，括号深度归零为止。"""
    src = re.sub(r"/\*.*?\*/", "", io.open(path, encoding="utf-8").read(), flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
    lines = src.splitlines()
    sig = re.compile(r"^\s*(?:public|private|protected|internal|async|static|\w<>?,\s\[\])+\s+\w+\s*\(")
    i = 0
    while i < len(lines):
        if sig.match(lines[i]) and "{" in "".join(lines[i:i + 3]):
            depth, j, eff = 0, i, 0
            started = False
            while j < len(lines):
                ln = lines[j]
                if ln.strip() and not ln.strip().startswith(("*", "///")):
                    eff += 1
                depth += ln.count("{") - ln.count("}")
                if "{" in ln:
                    started = True
                if started and depth <= 0:
                    break
                j += 1
            name = re.search(r"(\w+)\s*\(", lines[i])
            yield (name.group(1) if name else f"L{i+1}", eff, i + 1)
            i = j + 1
        else:
            i += 1


def scan(root: str, violations: list):
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if not f.endswith(EXTS):
                continue
            p = os.path.join(dirpath, f).replace("\\", "/")
            text = io.open(p, encoding="utf-8").read()
            n = effective_lines(text)
            if n > FILE_LIMIT:
                violations.append(f"[文件] {p}: {n} 行 > {FILE_LIMIT}")
            if f.endswith(".py"):
                for name, eff, ln in py_functions(p):
                    if eff > FUNC_LIMIT:
                        violations.append(f"[函数] {p}::{name} (L{ln}): {eff} 行 > {FUNC_LIMIT}")
            elif f.endswith((".java", ".ts")):
                for name, eff, ln in jvm_methods(p):
                    if eff > FUNC_LIMIT:
                        violations.append(f"[方法] {p}::{name} (L{ln}): ~{eff} 行 > {FUNC_LIMIT}（粗测，请复核）")


def main():
    targets = sys.argv[1:] or ["agent", "web/src", "web/frontend/src"]
    violations = []
    for t in targets:
        if os.path.isfile(t):
            violations_local = []
            scan(os.path.dirname(t) or ".", violations_local)
            # 单文件模式直接按目录扫描后过滤
            keep = [v for v in violations_local if t.replace("\\", "/") in v]
            violations.extend(keep)
        else:
            scan(t, violations)
    for v in violations:
        print(v)
    print(f"\n检查完成：{'✅ 全部合规' if not violations else f'❌ {len(violations)} 处超限（D16 硬性规范）'}")
    sys.exit(1 if violations else 0)


if __name__ == "__main__":
    main()
