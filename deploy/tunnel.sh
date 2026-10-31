#!/usr/bin/env bash
# ============================================================================
# 沙箱机 SSH 隧道（安全组未放行 3000/80 时的通路方案）
#   13000 -> 39.107.34.109:3000   Cube 控制面 API（CUBE_API_URL=http://host.docker.internal:13000）
#   13080 -> 39.107.34.109:80     cube-proxy 数据面（*.cube.app -> host.docker.internal:13080，
#                                 本机 80 端口受限，改走 13080 + CUBE_PROXY_PORT_HTTP=13080）
# 用法：bash deploy/tunnel.sh start | stop | status
# 说明：SSH 保活自动重连；开机自启可自行加入 launchd/登录项
# ============================================================================
set -euo pipefail
HOST=root@39.107.34.109
PIDFILE=/tmp/gill-cube-tunnel.pid
LOG=/tmp/gill-cube-tunnel.log

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "隧道已在运行 (pid $(cat "$PIDFILE"))"; exit 0
  fi
  nohup ssh -N \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=accept-new \
    -L 13000:127.0.0.1:3000 \
    -L 13080:127.0.0.1:80 \
    "$HOST" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  for i in $(seq 1 15); do
    if curl -s --noproxy '*' -m 2 http://127.0.0.1:13000/health | grep -q ok; then
      echo "隧道就绪: pid $(cat "$PIDFILE")  13000->3000 / 80->80  (log: $LOG)"; exit 0
    fi
    sleep 1
  done
  echo "ERROR: 隧道启动后 15s 内 13000 未通，查看 $LOG"; exit 1
}

stop() {
  [ -f "$PIDFILE" ] && { kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; echo "已停止"; } || echo "未在运行"
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "运行中 (pid $(cat "$PIDFILE"))：api $(curl -s --noproxy '*' -m 2 http://127.0.0.1:13000/health || echo 不通)"
  else
    echo "未在运行"
  fi
}

case "${1:-start}" in
  start) start ;; stop) stop ;; status) status ;; *) echo "用法: $0 start|stop|status"; exit 1 ;;
esac
