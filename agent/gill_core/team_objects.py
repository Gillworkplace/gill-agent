"""团队代码归档的对象存储适配，凭据不进入模型或沙箱。"""
from __future__ import annotations
import asyncio
import hashlib
import io
import os
import uuid
from urllib.parse import urlsplit


class TeamObjects:
    """Store immutable workspace archives in the existing MinIO bucket."""

    def __init__(self, team_id: str) -> None:
        """
        Bind an object namespace to one trusted team.

        :param team_id: Team identity obtained from the leased execution.
        """
        from minio import Minio
        self.team_id = team_id
        endpoint = urlsplit(os.getenv("MINIO_ENDPOINT", "http://localhost:9000"))
        self.client = Minio(endpoint.netloc, access_key=os.getenv("MINIO_ROOT_USER", "gilladmin"),
                            secret_key=os.getenv("MINIO_ROOT_PASSWORD", ""), secure=endpoint.scheme == "https")
        self.bucket = os.getenv("MINIO_BUCKET", "gill-files")

    async def save(self, data: bytes) -> dict:
        """
        Save an immutable archive and its content hash.

        :param data: Complete Git bundle bytes.
        :returns: Object reference containing bundleKey, sha256 and sizeBytes.
        """
        maximum = int(os.getenv("GILL_TEAM_BUNDLE_MAX_BYTES", str(64 * 1024 * 1024)))
        if len(data) > maximum:
            raise ValueError("版本归档超过配置的存储上限，原工作区已保留")
        key = f"teams/{self.team_id}/versions/{uuid.uuid4().hex}.bundle"
        await asyncio.to_thread(self.client.put_object, self.bucket, key, io.BytesIO(data), len(data),
                                content_type="application/octet-stream")
        return {"bundleKey": key, "sha256": hashlib.sha256(data).hexdigest(), "sizeBytes": len(data)}

    async def read(self, key: str) -> bytes:
        """
        Read an authorized team archive.

        :param key: Object key obtained from a version reference.
        :returns: Complete bundle bytes.
        :raises ValueError: When the key is outside this team's namespace.
        """
        if not key.startswith(f"teams/{self.team_id}/versions/") or ".." in key:
            raise ValueError("跨团队对象读取被拒绝")

        def download() -> bytes:
            response = self.client.get_object(self.bucket, key)
            try:
                maximum = int(os.getenv("GILL_TEAM_BUNDLE_MAX_BYTES", str(64 * 1024 * 1024)))
                data = response.read(maximum + 1)
                if len(data) > maximum:
                    raise ValueError("版本归档超过配置的存储上限")
                return data
            finally:
                response.close()
                response.release_conn()
        return await asyncio.to_thread(download)
