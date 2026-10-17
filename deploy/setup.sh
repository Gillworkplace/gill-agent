#!/usr/bin/env bash
# ============================================================================
# Gill Agent 本地一键部署（Docker Desktop：web + agentd + postgres(pgvector) + redis + minio）
# 用法：
#   交互式（逐项询问，回车=默认）：  bash deploy/setup.sh
#   无人值守：                       cp deploy/.env.example deploy/.env && (填好) bash deploy/setup.sh --yes
# 可选 profile：
#   edge  = Nginx 负载均衡（多副本时启用）   obs = Prometheus + Grafana（二期默认不开）
#   启用：bash deploy/setup.sh --yes --profile edge,obs
# 扩容：docker compose --env-file deploy/.env up -d --scale web=2 --scale agentd=2 --profile edge
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

ASSUME_YES=false; PROFILES=""
for a in "$@"; do
  case "$a" in
    --yes) ASSUME_YES=true ;;
    --profile) : ;;
    *) [ "${a#--profile=}" != "$a" ] && PROFILES="${a#--profile=}" || PROFILES="$a" ;;
  esac
done
PROFILE_FLAGS=""; [ -n "$PROFILES" ] && PROFILE_FLAGS="--profile ${PROFILES//,/ --profile }"

command -v docker >/dev/null || { echo "ERROR: 未安装 Docker Desktop"; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker 未运行"; exit 1; }

ask() { local v; read -r -p "$1 [默认: $2]: " v; echo "${v:-$2}"; }
gen() { openssl rand -hex 16 2>/dev/null || python -c "import secrets;print(secrets.token_hex(16))"; }

# ---------- 生成 .env ----------
if [ "$ASSUME_YES" = true ] && [ -f .env ]; then
  echo "使用现有 deploy/.env"
else
  cp -n .env.example .env
  set_kv() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
  if [ "$ASSUME_YES" = false ]; then
    echo "== 交互式生成 deploy/.env（敏感项不会回显到终端之外）=="
    K=$(ask "智谱 API Key <必填>" "");                 [ -n "$K" ] && set_kv ZHIPU_API_KEY "$K"
    set_kv ZHIPU_MODEL "$(ask "对话模型" "$(grep '^ZHIPU_MODEL=' .env | cut -d= -f2)")"
    U=$(ask "E2B_API_URL" "$(grep '^E2B_API_URL=' .env | cut -d= -f2)"); set_kv E2B_API_URL "$U"
    P=$(ask "CUBE_PROXY_NODE_IP（=沙箱机IP）" "$(grep '^CUBE_PROXY_NODE_IP=' .env | cut -d= -f2)"); set_kv CUBE_PROXY_NODE_IP "$P"
    NXY=$(ask "是否使用宿主机代理 7890（yes/no）" "yes")
    [ "$NXY" = "no" ] && set_kv NO_EXTRA yes
    AP=$(ask "ACR 用户名（留空跳过镜像推送）" ""); [ -n "$AP" ] && { set_kv ACR_USERNAME "$AP"; set_kv ACR_PASSWORD "$(ask "ACR 密码" "")"; }
  fi
  # 自动生成未填的密钥类配置
  for kv in "POSTGRES_PASSWORD:pg" "MINIO_ROOT_PASSWORD:" "JWT_SECRET:" "INIT_ADMIN_PASSWORD:"; do
    key="${kv%%:*}"
    cur=$(grep "^$key=" .env | cut -d= -f2)
    [ -z "$cur" ] && set_kv "$key" "$(gen)"
  done
  grep -q '^MINIO_ROOT_USER=$' -m1 .env && sed -i 's|^MINIO_ROOT_USER=.*|MINIO_ROOT_USER=gilladmin|' .env || true
  MINIO_ROOT_USER=$(grep '^MINIO_ROOT_USER=' .env | cut -d= -f2)
  [ -z "$MINIO_ROOT_USER" ] && set_kv MINIO_ROOT_USER gilladmin
  echo ".env 就绪（含自动生成的随机密钥；务必加入 .gitignore）"
fi

# ---------- 构建代理参数 ----------
PX=""; NO_EXTRA=$(grep '^NO_EXTRA=' .env | cut -d= -f2 || echo no)
if [ "$NO_EXTRA" != "yes" ]; then
  PH=$(grep '^HTTP_PROXY_HOST=' .env | cut -d= -f2); PP=$(grep '^PROXY_PORT=' .env | cut -d= -f2)
  PX="HTTP_PROXY=http://$PH:$PP HTTPS_PROXY=http://$PH:$PP"
  echo "构建代理：$PX（请确保代理已开启 Allow LAN）"
fi

# ---------- 启动 ----------
echo "== docker compose 构建并启动 $PROFILE_FLAGS =="
eval docker compose --env-file .env build $PX web agentd
docker compose --env-file .env up -d $PROFILE_FLAGS
echo "== 等待健康检查 =="
for i in $(seq 1 60); do
  OK=$(docker compose --env-file .env ps --format '{{.Name}} {{.Health}}' 2>/dev/null | grep -c healthy || true)
  [ "$OK" -ge 4 ] && break; sleep 3
done
docker compose --env-file .env ps --format 'table {{.Name}}\t{{.Status}}'
curl -s -o /dev/null -w "web: http://localhost:%{http_code}\n" http://localhost:8080 || true
echo "== 完成。访问 http://localhost:8080 ；初始管理员见 .env 的 INIT_ADMIN_* =="
