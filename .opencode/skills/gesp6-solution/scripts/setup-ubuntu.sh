#!/usr/bin/env bash
# gesp6-solution 技能 Ubuntu 22.04 一次性环境准备脚本
# 作用：安装 Playwright 系统依赖 + Chromium 浏览器 + playwright npm 包，
#       并预缓存 mermaid.min.js 与字体，避免每次调用技能时重复下载/安装。
# 特性：幂等，可安全重复运行；已存在的组件会跳过。
# 用法：bash setup-ubuntu.sh
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_JS="$SKILL_DIR/assets/js"
FONTS_DIR="$SKILL_DIR/fonts"
MERMAID_VERSION="10.9.1"
PW_CACHE="/root/.cache/ms-playwright"

green(){ printf "\033[32m%s\033[0m\n" "$1"; }
info(){ printf "  %s\n" "$1"; }

# ---------- [1/5] Playwright 系统依赖（apt 包，持久） ----------
green "[1/5] 检测 Playwright 系统依赖（libnspr4 / libnss3 / libpango 等）..."
if ! dpkg -s libnspr4 >/dev/null 2>&1; then
  npx --yes playwright@latest install-deps chromium
  info "系统依赖已安装。"
else
  info "系统依赖已存在，跳过。"
fi

# ---------- [2/5] Chromium 浏览器（持久） ----------
green "[2/5] 检测 Chromium 浏览器..."
CHROMIUM_BIN=""
if [ -d "$PW_CACHE" ]; then
  for d in $(ls -d "$PW_CACHE"/chromium-* 2>/dev/null | grep -v headless | sort -r); do
    if [ -x "$d/chrome-linux64/chrome" ]; then CHROMIUM_BIN="$d/chrome-linux64/chrome"; break; fi
  done
fi
if [ -z "$CHROMIUM_BIN" ]; then
  npx --yes playwright@latest install chromium
  for d in $(ls -d "$PW_CACHE"/chromium-* 2>/dev/null | grep -v headless | sort -r); do
    if [ -x "$d/chrome-linux64/chrome" ]; then CHROMIUM_BIN="$d/chrome-linux64/chrome"; break; fi
  done
  info "Chromium 已下载：$CHROMIUM_BIN"
else
  info "Chromium 已存在：$CHROMIUM_BIN"
fi

# ---------- [3/5] playwright npm 包（全局，持久） ----------
green "[3/5] 检测全局 playwright npm 包..."
if npm ls -g playwright >/dev/null 2>&1; then
  info "playwright npm 包已存在，跳过。"
else
  npm install -g playwright@latest
  info "playwright npm 包已全局安装。"
fi

# ---------- [4/5] 预缓存 mermaid.min.js ----------
green "[4/5] 预缓存 mermaid.min.js..."
mkdir -p "$ASSETS_JS"
if [ -s "$ASSETS_JS/mermaid.min.js" ]; then
  info "mermaid.min.js 已存在，跳过。"
else
  curl -fsSL -o "$ASSETS_JS/mermaid.min.js" \
    "https://cdnjs.cloudflare.com/ajax/libs/mermaid/${MERMAID_VERSION}/mermaid.min.js"
  info "mermaid.min.js 已缓存到 $ASSETS_JS/mermaid.min.js"
fi

# ---------- [5/5] 预缓存字体（可选，失败回退系统字体） ----------
# 下载 4 个静态 woff2 字体文件（Outfit 400/700、JetBrainsMono 400/700），
# 与 SKILL.md 中 @font-face 引用的文件名保持一致。woff2 在所有现代浏览器可用。
green "[5/5] 预缓存字体 Outfit / JetBrainsMono（可选）..."
mkdir -p "$FONTS_DIR"
download_font(){
  local url="$1" out="$2"
  if [ -s "$out" ]; then info "$out 已存在，跳过。"; return 0; fi
  if curl -fsSL -o "$out" "$url"; then info "$out 已下载。"; else info "$out 下载失败，将使用系统字体回退。"; rm -f "$out"; fi
}
download_font "https://cdn.jsdelivr.net/npm/@fontsource/outfit/files/outfit-latin-400-normal.woff2" "$FONTS_DIR/Outfit-Regular.woff2"
download_font "https://cdn.jsdelivr.net/npm/@fontsource/outfit/files/outfit-latin-700-normal.woff2" "$FONTS_DIR/Outfit-Bold.woff2"
download_font "https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2" "$FONTS_DIR/JetBrainsMono-Regular.woff2"
download_font "https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2" "$FONTS_DIR/JetBrainsMono-Bold.woff2"

green "完成。下次调用 gesp6-solution 技能无需重复安装。"
