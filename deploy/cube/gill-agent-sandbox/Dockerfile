FROM python:3.12-slim
# Gill Agent 沙箱模板镜像 gill-agent-sandbox：
# Chromium(CDP 9222) + CJK 字体 + 数据分析栈 + node(npx 供 stdio MCP) —— 需求 FR-54/FR-101~104
ENV DEBIAN_FRONTEND=noninteractive
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk ca-certificates curl wget unzip zip jq procps tini socat \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
      pandas matplotlib openpyxl requests httpie
COPY start-chromium.sh /usr/local/bin/start-chromium.sh
RUN chmod +x /usr/local/bin/start-chromium.sh
EXPOSE 9222 49999
ENV CHROMIUM_FLAGS="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu \
 --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0"
