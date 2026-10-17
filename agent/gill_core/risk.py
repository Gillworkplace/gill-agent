"""敏感命令规则库（需求附录 A / FR-38）：高危 must-approve，中危 approve-by-config。"""
from __future__ import annotations
import re
from dataclasses import dataclass

@dataclass(frozen=True)
class Rule:
    id: str
    level: str          # high | medium
    pattern: re.Pattern
    reason: str

def _r(rid, level, pat, reason):
    return Rule(rid, level, re.compile(pat), reason)

RULES: list[Rule] = [
    # —— 高危（H1~H10）——
    _r("H1", "high", r"rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+", "递归/强制删除"),
    _r("H2", "high", r"(^|[;&|\s])(sudo|su)(\s|$)", "提权执行"),
    _r("H3", "high", r"(curl|wget)[^|;&]*\|\s*(ba)?sh", "下载即执行"),
    _r("H4", "high", r"(>>?|tee\s+-a)\s*/(etc|usr|bin|sbin|boot|lib)/", "系统路径写入"),
    _r("H5", "high", r"chmod\s+[0-7]*[67][0-7]{2}|chown\s+\S+\s+/", "危险权限/属主变更"),
    _r("H6", "high", r"\b(iptables|ufw|firewall-cmd)\b|systemctl\s+(stop|disable)", "防火墙/服务变更"),
    _r("H7", "high", r"authorized_keys|ssh-keygen.*-N\s+''", "SSH 凭据变更"),
    _r("H8", "high", r"\bmkfs\b|dd\s+[^|]*of=/dev/", "磁盘级操作"),
    _r("H9", "high", r":\(\)\s*\{.*\};\s*:", "fork 炸弹"),
    _r("H10", "high", r"\b(shutdown|reboot|init\s+[06])\b", "关机重启"),
    # —— 中危（M1~M8）——
    _r("M1", "medium", r"\b(pip|pip3|npm|apt(-get)?|apt)\s+(install|uninstall|remove|i)\b", "包变更"),
    _r("M2", "medium", r"git\s+(push|clone)\s", "外部仓库操作"),
    _r("M3", "medium", r"(curl|wget)[^\s]*(token|key|password)=", "外网提交含凭据"),
    _r("M4", "medium", r"find\s+.*-delete|\brm\s+[^-]", "文件删除"),
    _r("M5", "medium", r"\bkill(p)?\b\s+-?", "进程终止"),
    _r("M6", "medium", r"\bcrontab\b|\bat\s+\d", "定时任务"),
    _r("M7", "medium", r"\bdocker\s+\w+|systemctl\s+restart", "容器/服务重启"),
    _r("M8", "medium", r"\bexport\s+\w+=", "环境变量变更"),
]


def assess(command: str) -> Rule | None:
    """返回首条命中规则（高危优先——按 RULES 顺序即高危在前）。"""
    for rule in RULES:
        if rule.pattern.search(command):
            return rule
    return None
