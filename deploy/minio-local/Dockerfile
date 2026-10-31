# MinIO 社区最终版二进制替换底座（开源版已归档；镜像源 latest 为 2018 陈旧版）
FROM minio/minio:latest  # 任意本地已有底座，仅用其文件系统
COPY minio /usr/bin/minio
RUN chmod +x /usr/bin/minio
ENTRYPOINT ["/usr/bin/minio"]
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:9000/minio/health/live || exit 1
