# 本地 MinIO 镜像（gill-minio:2025-04-22）重建方法

背景：MinIO 开源版已归档（2025-04 后不再更新），Docker Hub `minio/minio:latest`
经国内镜像源（docker.xuanyuan.me）缓存为 **2018 年陈旧版**——不认 `--console-address`、
不认 `MINIO_ROOT_USER`，导致 compose 启动失败。

compose 中 minio 服务已固定 `image: gill-minio:2025-04-22` + `pull_policy: never`。
镜像丢失时按以下步骤重建（Apple Silicon；x86 机器换 amd64 资产）：

```bash
# 1. 下载社区最终版二进制（走代理）
curl -sL -o minio \
  https://github.com/minio/minio/releases/download/RELEASE.2025-04-22T22-12-26Z/minio.linux-arm64.RELEASE.2025-04-22T22-12-26Z

# 2. 以任意本地可用镜像为底座替换二进制（BuildKit 会强制校验远端 manifest，须用经典构建器）
DOCKER_BUILDKIT=0 docker build -t gill-minio:2025-04-22 .

# 3. 验证
docker run --rm gill-minio:2025-04-22 --version
```

注意：
- 若数据卷是从 2018 版残留下来的，新版会报 `drive not found`，需 `docker volume rm` 清卷重建。
- mc（minio-init 用）仍可用本地缓存的 `minio/mc:latest`。
