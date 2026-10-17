#!/usr/bin/env bash
# ============================================================================
# gill-agent-sandbox 模板镜像：本机构建 → 推 ACR → 沙箱机 create-from-image
# 用法：
#   交互式确认（读取 deploy/.env 的 ACR_*）：bash deploy/cube/build-template.sh
#   可选项：TAG=1.0（镜像 tag）  SBX=root@39.107.34.109（沙箱机）
#           --no-push 只构建不推送   --tpl-name gill-browser（Cube 模板名）
#           CPU=1 MEM=768（模板资源限额）
# 前置：本机 Docker Desktop 运行中；代理开启（基础镜像走 debian 源已换阿里源，一般无需代理）
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"
TAG="${TAG:-1.0}"; SBX="${SBX:-root@39.107.34.109}"
TPL_NAME="${TPL_NAME:-gill-browser}"; CPU="${CPU:-1}"; MEM="${MEM:-768}"
PUSH=true; [ "${1:-}" = "--no-push" ] || [ "${2:-}" = "--no-push" ] && PUSH=false

ENV_FILE="$(dirname "$0")/../.env"
[ -f "$ENV_FILE" ] && . <(grep -E '^(ACR_|CUBE_)' "$ENV_FILE" | sed 's/^/export /') || true
ACR_REGISTRY="${ACR_REGISTRY:-registry.cn-guangzhou.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-gill-gplatform}"
ACR_REPO="${ACR_REPO:-gill-agent-sandbox}"
IMAGE="$ACR_REGISTRY/$ACR_NAMESPACE/$ACR_REPO:$TAG"

echo "== 构建 $IMAGE =="
docker build -t "$IMAGE" gill-agent-sandbox/

if [ "$PUSH" = true ]; then
  echo "== 推送 ACR =="
  docker push "$IMAGE"
  echo "== 沙箱机建模板（需 docker login ACR + cubemastercli）=="
  ssh -o BatchMode=yes "$SBX" "
    docker login -u '$ACR_USERNAME' --password-stdin '$ACR_REGISTRY' <<< '$ACR_PASSWORD' 2>/dev/null || true
    # 关键经验（踩坑固化）：①--cmd sleep --arg infinity 必须加（镜像默认 CMD 秒退导致 envd 丢失）；
    # ②--enable-inject-envd --envd-path /root/envd 注入配套 envd（v0.7.3 release 版 CLI 未内嵌，
    #   envd 二进制从官方 sandbox-code 镜像提取：docker cp \$(docker create cube-sandbox-cn.tencentcloudcr.com/cube-sandbox/sandbox-code:latest):/usr/bin/envd /root/envd）
    cubemastercli template create-from-image --name '$TPL_NAME' --cpu '$CPU' --memory '$MEM' \
      --image '$IMAGE' --expose-port 9222 --expose-port 49999 \
      --cmd sleep --arg infinity --enable-inject-envd --envd-path /root/envd
    cubemastercli tpl ls"
else
  echo "--no-push：仅构建完成 $IMAGE"
fi
