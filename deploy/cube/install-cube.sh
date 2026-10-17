#!/usr/bin/env bash
# ============================================================================
# Gill Agent — CubeSandbox 沙箱机一键部署脚本（Ubuntu 20.04/22.04/24.04，无 /dev/kvm 走 PVM）
# 用法：
#   交互式（逐项询问，回车取默认值）：  bash install-cube.sh
#   无人值守（全部环境变量已给出）：    bash install-cube.sh --yes
# 重启后继续（脚本自动分两段）：
#   首段结束时自动 reboot；机器起来后再次运行： bash install-cube.sh --stage2 --yes
# 可配置项（环境变量覆盖 / 交互询问 / 均有默认值）：
#   NODE_IP          本机公网 IP（默认自动探测）
#   MIRROR           cn | global（默认 cn，国内镜像源拉取 Cube 组件）
#   SWAP_GB          swap 大小 GB（默认 4；已有 swap 则跳过）
#   DATA_DIR         cubelet 数据目录（默认 /data/cubelet；须为 XFS，非 XFS 自动建 loop 卷）
#   DATA_SIZE_GB     数据卷大小 GB（默认 40，最小 20）
#   KERNEL_DEB       PVM 内核 DEB 的本地路径或 URL（默认自动取 GitHub 最新 release；
#                    服务器无法访问 GitHub 时，可从本机（有代理）下载后 scp 上来并传路径）
#   REBOOT_CONFIRM   yes|no（默认 yes；--yes 模式下不询问直接重启）
#   SKIP_KERNEL      yes 跳过内核安装（已装过）
# ============================================================================
set -euo pipefail

# ---------- 可选项：交互询问（回车=默认） ----------
ask() { local v; read -r -p "$1 [默认: $2]: " v; echo "${v:-$2}"; }
ASSUME_YES=false; STAGE2=false
for a in "$@"; do [ "$a" = "--yes" ] && ASSUME_YES=true; [ "$a" = "--stage2" ] && STAGE2=true; done

[ "$STAGE2" = false ] && {
  echo "== CubeSandbox 一键部署（第 1 段：预备 + PVM 内核 + 重启）=="
  AUTO_IP=$(curl -s --max-time 5 ifconfig.me || true)
  if [ "$ASSUME_YES" = true ]; then
    NODE_IP="${NODE_IP:-$AUTO_IP}"; MIRROR="${MIRROR:-cn}"; SWAP_GB="${SWAP_GB:-4}"
    DATA_DIR="${DATA_DIR:-/data/cubelet}"; DATA_SIZE_GB="${DATA_SIZE_GB:-40}"
    KERNEL_DEB="${KERNEL_DEB:-}"; REBOOT_CONFIRM="${REBOOT_CONFIRM:-yes}"; SKIP_KERNEL="${SKIP_KERNEL:-no}"
  else
    NODE_IP=$(ask "本机公网 IP" "$AUTO_IP"); MIRROR=$(ask "镜像源 cn/global" "cn")
    SWAP_GB=$(ask "swap 大小 GB" "4"); DATA_DIR=$(ask "数据目录" "/data/cubelet")
    DATA_SIZE_GB=$(ask "数据卷大小 GB（单盘 XFS loop）" "40")
    KERNEL_DEB=$(ask "PVM 内核 DEB 路径或 URL（空=自动下载）" ""); SKIP_KERNEL=$(ask "跳过内核安装 yes/no" "no")
  fi
  echo "配置：NODE_IP=$NODE_IP MIRROR=$MIRROR SWAP=${SWAP_GB}G DATA=$DATA_DIR(${DATA_SIZE_GB}G) SKIP_KERNEL=$SKIP_KERNEL"

  # ---------- 预检 ----------
  [ "$(nproc)" -ge 4 ] || echo "WARN: CPU<4 核"
  MEM_GB=$(awk '/MemTotal/{print int($2/1024/1024)}' /proc/meminfo); [ "$MEM_GB" -ge 6 ] || echo "WARN: 内存 ${MEM_GB}G < 6G"
  FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9); [ "$FREE_GB" -ge "$((DATA_SIZE_GB + 15))" ] || { echo "ERROR: 磁盘空闲 ${FREE_GB}G 不足"; exit 1; }

  # ---------- swap ----------
  if ! swapon --show | grep -q .; then
    fallocate -l "${SWAP_GB}G" /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "OK swap ${SWAP_GB}G"
  else echo "SKIP swap（已存在）"; fi

  # ---------- XFS 数据目录（loop 卷，不动分区表） ----------
  mkdir -p "$DATA_DIR"
  if ! mountpoint -q "$DATA_DIR"; then
    command -v mkfs.xfs >/dev/null || apt-get update -qq && apt-get install -y -qq xfsprogs
    IMG=/data-cubelet.img
    truncate -s "${DATA_SIZE_GB}G" "$IMG" && mkfs.xfs -f -q "$IMG" && mount -o loop "$IMG" "$DATA_DIR"
    grep -q "$IMG" /etc/fstab || echo "$IMG $DATA_DIR xfs loop 0 0" >> /etc/fstab
    echo "OK XFS loop ${DATA_SIZE_GB}G -> $DATA_DIR"
  else echo "SKIP 数据目录（已挂载）"; fi

  # ---------- PVM 内核 ----------
  if [ "$SKIP_KERNEL" != "yes" ]; then
    if ls /boot/vmlinuz-*opencloudos9.cubesandbox.pvm.host* >/dev/null 2>&1; then
      echo "SKIP 内核（vmlinuz 已存在）"
    else
      if [ -z "$KERNEL_DEB" ]; then
        echo "自动获取最新 kernel-release 下载地址（需能访问 GitHub API）"
        KERNEL_DEB=$(curl -s --max-time 30 https://api.github.com/repos/TencentCloud/CubeSandbox/releases?per_page=100 \
          | grep -o 'https://[^"]*linux-image-[^"]*pvm.host-[^"]*amd64.deb' | head -1) || true
        [ -n "$KERNEL_DEB" ] || { echo "ERROR: 无法获取地址。请在能访问 GitHub 的机器下载后 scp 上来，再 KERNEL_DEB=/root/xxx.deb 重跑"; exit 1; }
      fi
      case "$KERNEL_DEB" in http*) wget -q --timeout=120 "$KERNEL_DEB" -O /root/pvm-kernel.deb || { echo "ERROR: 下载失败（可换 ghproxy 前缀或本机中转）"; exit 1; } ;; *) cp "$KERNEL_DEB" /root/pvm-kernel.deb ;; esac
      dpkg -i /root/pvm-kernel.deb
    fi
    KVER=$(ls /boot/vmlinuz-*opencloudos9.cubesandbox.pvm.host* | sed 's|/boot/vmlinuz-||' | tail -1)
    sed -i "s|^GRUB_DEFAULT=.*|GRUB_DEFAULT=\"Advanced options for Ubuntu>Ubuntu, with Linux ${KVER}\"|" /etc/default/grub
    bash <(curl -fsSL --retry 3 https://raw.githubusercontent.com/TencentCloud/CubeSandbox/master/deploy/pvm/grub/host_grub_config.sh \
      || curl -fsSL --retry 3 https://ghproxy.net/https://raw.githubusercontent.com/TencentCloud/CubeSandbox/master/deploy/pvm/grub/host_grub_config.sh)
    echo "== 内核就绪（$KVER）。即将重启进入 PVM 内核 =="
    if [ "$ASSUME_YES" = true ] || [ "$REBOOT_CONFIRM" = "yes" ] \
      || [ "$(ask '现在重启? yes/no' 'yes')" = "yes" ]; then reboot; else echo "请稍后手动 reboot，然后运行：bash install-cube.sh --stage2"; fi
  else
    echo "SKIP_KERNEL=yes，直接进入第 2 段（如内核未装请勿跳过）"; exec bash "$0" --stage2 --yes
  fi
  exit 0
}

# ---------- 第 2 段：重启后安装 Cube ----------
echo "== CubeSandbox 一键部署（第 2 段：验证 PVM + 安装 Cube）=="
K=$(uname -r); echo "kernel: $K"
echo "$K" | grep -q 'pvm.host' || { echo "ERROR: 当前内核不是 PVM（$K）。检查 GRUB_DEFAULT 后重启重试"; exit 1; }
modprobe kvm_pvm 2>/dev/null || true; lsmod | grep kvm_pvm || echo "WARN: kvm_pvm 未加载"
echo 'kvm_pvm' > /etc/modules-load.d/kvm-pvm.conf
if [ "$ASSUME_YES" = true ]; then :; else
  NODE_IP="${NODE_IP:-$(curl -s --max-time 5 ifconfig.me)}"; MIRROR=$(ask "镜像源 cn/global" "${MIRROR:-cn}")
fi
curl -sL https://github.com/tencentcloud/CubeSandbox/raw/master/deploy/one-click/online-install.sh \
  | CUBE_PVM_ENABLE=1 MIRROR="${MIRROR:-cn}" bash -s -- --node-ip="${NODE_IP:-$(curl -s --max-time 5 ifconfig.me)}"
echo "== 安装后检查 =="
grep CUBE_PVM_ENABLE /usr/local/services/cubetoolbox/.one-click.env || true
lsmod | grep kvm_pvm || echo "WARN: kvm_pvm 未加载"
ss -tlnp | grep -E ':3000\b' || echo "WARN: 3000 未监听"
echo "== 完成。提醒：①安全组开放 3000/tcp（限源 IP）；②WebUI 12088 仅保留本机访问；③下一页：创建 gill-browser 模板 =="
