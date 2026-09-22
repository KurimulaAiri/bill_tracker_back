#!/usr/bin/env bash
# 账户分层改造：应用数据库变更 + 迁移存量账户（幂等，可重复执行）
# 用法：cd /opt/kurimula-airi/bill-tracker/server && bash apply-account-layer.sh
set -e
cd "$(dirname "$0")"

echo "==> [1/4] 应用数据库 schema 变更（新增 parentId 列与唯一约束）"
npx prisma db push

echo "==> [2/4] 重新生成 Prisma Client"
npx prisma generate

echo "==> [3/4] 迁移存量账户到父/子结构"
npx ts-node prisma/migrate-account-layer.ts

echo "==> [4/4] 后端编译校验"
pnpm run typecheck

echo ""
echo "✅ 全部完成，请重启后端服务使改动生效"