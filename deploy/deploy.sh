#!/bin/bash
# ============================================================
# bill_tracker_back 部署脚本（在宿主机执行，由 Jenkinsfile 调用）
#
# 用法:
#   deploy.sh deploy   安装依赖 + prisma generate + 构建，并重启服务
#   deploy.sh build    只构建，不重启
#   deploy.sh restart  只重启服务
#   deploy.sh stop     停止服务
#   deploy.sh status   检查进程与 HTTP 可用性
#
# 约定:
#   - node 使用宝塔自带运行时：/www/server/nodejs/v22.14.0/bin
#   - 应用目录: /opt/node-deploy/bill_tracker_back（源码 + node_modules + dist 产物）
#   - 入口文件: dist/src/main.js（NestJS 默认输出到 dist/src）
# ============================================================
set -euo pipefail

PROJECT="bill_tracker_back"
DEPLOY_ROOT="/opt/node-deploy"
APP_DIR="${DEPLOY_ROOT}/${PROJECT}"
NODE_BIN="/www/server/nodejs/v22.14.0/bin"
NPM_REGISTRY="https://registry.npmmirror.com"
APP_PORT="${APP_PORT:-3000}"
ENTRY="dist/src/main.js"
LOG_FILE="${APP_DIR}/app.log"
PID_FILE="${APP_DIR}/app.pid"
HEALTH_PATH="${HEALTH_PATH:-/api/auth/login}"

export PATH="${NODE_BIN}:${PATH}"

log() { echo "[$(date '+%F %T')] [${PROJECT}] $*"; }

# ------------------------------------------------------------
# 停止旧进程
# ------------------------------------------------------------
do_stop() {
    if [ -f "${PID_FILE}" ]; then
        local pid
        pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
        if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
            log "停止进程 PID=${pid}"
            kill "${pid}" 2>/dev/null || true
            sleep 2
            kill -9 "${pid}" 2>/dev/null || true
        fi
        rm -f "${PID_FILE}"
    fi
    # 兜底：按入口路径匹配残留进程
    pkill -f "${APP_DIR}/${ENTRY}" 2>/dev/null || true
}

# ------------------------------------------------------------
# 构建
# ------------------------------------------------------------
do_build() {
    if [ ! -d "${APP_DIR}" ]; then
        log "错误：应用目录不存在 ${APP_DIR}"
        exit 1
    fi
    cd "${APP_DIR}"

    log "node: $(node -v 2>/dev/null || echo '未找到')"
    log "pnpm: $(pnpm -v 2>/dev/null || echo '未找到')"

    log "安装依赖 ..."
    pnpm install --no-frozen-lockfile --registry="${NPM_REGISTRY}"

    log "prisma generate ..."
    pnpm exec prisma generate

    log "构建 ..."
    pnpm build

    if [ ! -f "${ENTRY}" ]; then
        log "构建失败：未生成 ${ENTRY}"
        exit 1
    fi
    log "构建完成 ✓ (${ENTRY})"
}

# ------------------------------------------------------------
# 启动
# ------------------------------------------------------------
do_start() {
    if [ ! -f "${APP_DIR}/.env" ]; then
        log "⚠️ 未找到 ${APP_DIR}/.env，数据库连接可能失败"
    fi

    do_stop
    cd "${APP_DIR}"

    log "启动服务 (端口 ${APP_PORT}) ..."
    : >> "${LOG_FILE}"
    nohup node "${ENTRY}" >> "${LOG_FILE}" 2>&1 &
    local pid=$!
    echo "${pid}" > "${PID_FILE}"
    log "已拉起 PID=${pid}，等待 6 秒观察是否存活 ..."
    sleep 6

    if ! kill -0 "${pid}" 2>/dev/null; then
        log "进程已退出 ✗  最近 30 行日志："
        tail -30 "${LOG_FILE}" || true
        exit 1
    fi
    log "进程存活 ✓"
}

# ------------------------------------------------------------
# 状态检查（进程 + HTTP）
# ------------------------------------------------------------
do_status() {
    local ok=0

    log "应用目录: ${APP_DIR}"
    if [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}" 2>/dev/null)" 2>/dev/null; then
        log "进程存活 ✓ PID=$(cat "${PID_FILE}")"
    else
        log "进程未运行 ✗"
        ok=1
    fi

    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${APP_PORT}${HEALTH_PATH}" || echo '000')"
    if [ "${code}" != "000" ]; then
        # 该接口未登录时返回 401/400 属正常，说明 HTTP 已就绪
        log "HTTP 响应 ✓ code=${code} (http://127.0.0.1:${APP_PORT}${HEALTH_PATH})"
    else
        log "HTTP 无响应 ✗"
        tail -30 "${LOG_FILE}" 2>/dev/null || true
        ok=1
    fi

    if [ "${ok}" -eq 1 ]; then
        log "状态检查未通过 ✗"
        exit 1
    fi
    log "状态检查通过 ✓"
}

case "${1:-}" in
    deploy)  do_build; do_start; do_status ;;
    build)   do_build ;;
    restart) do_start; do_status ;;
    stop)    do_stop ;;
    status)  do_status ;;
    *) echo "用法: $0 [deploy|build|restart|stop|status]"; exit 2 ;;
esac
