#!/usr/bin/env bash
# 备份（FR-86）：PG dump → gzip → MinIO backup 桶（gill-backup），保留 30 天。
# 用法：bash scripts/backup.sh   （在 deploy/ 目录或有 docker 权限的机器上执行）
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
NAME="pg/${STAMP}.sql.gz"

echo "[backup] dumping postgres..."
docker exec gill-postgres-1 pg_dump -U gill gill | gzip > "/tmp/${STAMP}.sql.gz"

echo "[backup] uploading to minio bucket gill-backup/${NAME}..."
docker cp "/tmp/${STAMP}.sql.gz" gill-minio-1:/tmp/bak.sql.gz
docker exec gill-minio-1 sh -c "
  mc alias set g http://127.0.0.1:9000 gilladmin \${MINIO_ROOT_PASSWORD:-gillminio123} >/dev/null 2>&1 ||
  mc alias set g http://127.0.0.1:9000 gilladmin gillminio123 >/dev/null;
  mc mb -p g/gill-backup 2>/dev/null || true;
  mc cp /tmp/bak.sql.gz g/gill-backup/${NAME};
  mc ilm rule add g/gill-backup --expire-days 30 2>/dev/null || true;
  rm -f /tmp/bak.sql.gz; ls -la g/gill-backup/pg/ | tail -3"
rm -f "/tmp/${STAMP}.sql.gz"

# 恢复手册（演练用）：
#   mc cp g/gill-backup/pg/<file> /tmp/bak.sql.gz && gunzip < /tmp/bak.sql.gz | docker exec -i gill-postgres-1 psql -U gill gill
echo "[backup] done: gill-backup/${NAME}"
