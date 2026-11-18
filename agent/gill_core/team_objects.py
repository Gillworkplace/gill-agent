"""Read template files and store team archives without exposing storage credentials."""
from __future__ import annotations
import asyncio
import hashlib
import io
import os
import uuid
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from minio import Minio


def _minio() -> Minio:
    from minio import Minio
    endpoint = urlsplit(os.getenv("MINIO_ENDPOINT", "http://localhost:9000"))
    return Minio(endpoint.netloc, access_key=os.getenv("MINIO_ROOT_USER", "gilladmin"),
                 secret_key=os.getenv("MINIO_ROOT_PASSWORD", ""), secure=endpoint.scheme == "https")


def _read_object(client: Minio, key: str, maximum: int) -> bytes:
    response = client.get_object(os.getenv("MINIO_BUCKET", "gill-files"), key)
    try:
        data = response.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError("对象超出登记大小")
        return data
    finally:
        response.close()
        response.release_conn()


async def read_template_file(key: str, size: int) -> bytes:
    """
    Fetch one immutable file referenced by an authorized template snapshot.

    :param key: Content-addressed storage key from the gateway snapshot.
    :param size: Expected size of the committed file.
    :returns: Verified original file bytes.
    """
    data = await asyncio.to_thread(_read_object, _minio(), key, size)
    if len(data) != size or hashlib.sha256(data).hexdigest() != key.rsplit("/", 1)[-1]:
        raise ValueError("模板文件与保存的版本不一致")
    return data


class TeamObjects:
    """Store immutable workspace archives in the existing MinIO bucket."""
    def __init__(self, team_id: str) -> None:
        """
        Bind an object namespace to one trusted team.

        :param team_id: Team identity obtained from the leased execution.
        """
        self.team_id = team_id
        self.client = _minio()
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

        maximum = int(os.getenv("GILL_TEAM_BUNDLE_MAX_BYTES", str(64 * 1024 * 1024)))
        return await asyncio.to_thread(_read_object, self.client, key, maximum)
