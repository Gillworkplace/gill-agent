"""MinIO 流式中转（FR-62/63）：下载对象 → 写入沙箱；沙箱文件 → 上传对象。8MB 缓冲。"""
from __future__ import annotations
import logging

log = logging.getLogger("gill.files")
CHUNK = 8 * 1024 * 1024


def _client():
    import os
    from minio import Minio
    ep = os.getenv("MINIO_ENDPOINT", "http://minio:9000").replace("http://", "").replace("https://", "")
    return Minio(ep, access_key=os.getenv("MINIO_ROOT_USER", "gilladmin"),
                 secret_key=os.getenv("MINIO_ROOT_PASSWORD", "gillminio123"), secure=False), "gill-files"


async def sync_in(sandbox, object_key: str, dest: str, emit=None):
    """MinIO 对象 → 沙箱文件（流式，经临时 tar/stdin 避免内存峰值——一期用分段 heredoc 简化）。"""
    import asyncio
    mc, bucket = _client()
    stat = mc.stat_object(bucket, object_key)
    if stat.size > 200 * 1024 * 1024:
        raise ValueError("超过同步上限 200MB")
    total = 0
    # 分段拉取写入（每段 base64 heredoc 追加）
    first = True
    offset = 0
    while offset < stat.size:
        n = min(CHUNK, stat.size - offset)
        resp = mc.get_object(bucket, object_key, offset=offset, length=n)
        import base64
        data = base64.b64encode(resp.read()).decode()
        resp.close(); resp.release_conn()
        op = ">" if first else ">>"
        import shlex
        r = await sandbox.run(
            f"mkdir -p $(dirname {shlex.quote(dest)}) && printf %s {shlex.quote(data)} | base64 -d {op} {shlex.quote(dest)}",
            timeout=120)
        if r.exit_code != 0:
            raise RuntimeError(f"写入沙箱失败: {r.stderr[:200]}")
        first = False
        offset += n
        total = offset
        if emit:
            await emit("file_sync_progress", {"objectKey": object_key, "pct": int(offset * 100 / stat.size)})
    if emit:
        await emit("file_synced", {"objectKey": object_key, "dest": dest, "bytes": total})
    return dest


async def export_out(sandbox, path: str, object_key: str, emit=None):
    """沙箱文件 → MinIO 对象（base64 分段读出）。"""
    import asyncio, base64, shlex
    mc, bucket = _client()
    r = await sandbox.run(f"stat -c %s {shlex.quote(path)} 2>/dev/null || wc -c < {shlex.quote(path)}")
    size = int(r.stdout.strip() or 0)
    if size > 200 * 1024 * 1024:
        raise ValueError("超过导出上限 200MB")
    from io import BytesIO
    buf = BytesIO()
    offset = 0
    while offset < size:
        n = min(CHUNK, size - offset)
        r = await sandbox.run(f"dd if={shlex.quote(path)} bs={n} count=1 2>/dev/null | base64 -w0", timeout=120)
        buf.write(base64.b64decode(r.stdout.strip()))
        offset += n
        if emit:
            await emit("file_sync_progress", {"path": path, "pct": int(offset * 100 / max(1, size))})
    buf.seek(0)
    mc.put_object(bucket, object_key, buf, size)
    if emit:
        await emit("file_exported", {"path": path, "objectKey": object_key})
    return object_key
