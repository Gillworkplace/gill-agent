#!/bin/sh
# 沙箱内启动 Chromium（CDP 0.0.0.0:9222），已运行则跳过；供 agentd browser.py 调用
if curl -s --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  echo "chromium already running"; exit 0
fi
pkill -f remote-debugging 2>/dev/null || true
nohup chromium $CHROMIUM_FLAGS about:blank >/tmp/chromium.log 2>&1 &
i=0
while [ $i -lt 40 ]; do
  if curl -s --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    echo "chromium up on 9222"; exit 0
  fi
  i=$((i+1)); sleep 0.5
done
echo "chromium failed to start"; tail -20 /tmp/chromium.log; exit 1
