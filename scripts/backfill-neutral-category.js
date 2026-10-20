#!/usr/bin/env node
/**
 * 存量「不计收支」账单分类回填（一次性工具，可重复执行、幂等）
 *
 * 背景
 *   2026-10-20 之前，导入链路对中性账单硬性跳过分类解析（mapCategory 里 `if (billType === 'neutral') return undefined`），
 *   历史中性账单的 categoryId 全是 NULL。该行为已改为「不计收支同样分类」，本脚本按**同一条解析链**
 *  （ImportsService.resolveBillCategory）给存量数据补分类，避免脚本自己再写一份映射逻辑而与线上漂移。
 *
 * 取数口径
 *   sourceCategory 从 rawData.data 里取（支付宝取「交易分类」，微信取「交易类型」），与导入时一致。
 *
 * 用法（在 server 目录下执行，需先 pnpm build 生成 dist）
 *   node scripts/backfill-neutral-category.js                  # 只预览，不写库（默认）
 *   node scripts/backfill-neutral-category.js --apply          # 真正写入
 *   node scripts/backfill-neutral-category.js --apply --user 2 # 只处理指定用户ID
 */
const { PrismaClient } = require('@prisma/client');
const { ImportsService } = require('../dist/src/modules/imports/imports.service');

const APPLY = process.argv.includes('--apply');
const userArg = process.argv.indexOf('--user');
const ONLY_USER = userArg > -1 ? BigInt(process.argv[userArg + 1]) : null;

const prisma = new PrismaClient();
const svc = new ImportsService(prisma);

(async () => {
  const where = { billType: 'neutral', categoryId: null };
  if (ONLY_USER !== null) where.userId = ONLY_USER;

  const bills = await prisma.bill.findMany({
    where,
    select: { id: true, userId: true, source: true, rawData: true },
  });
  if (bills.length === 0) {
    console.log('没有需要回填的中性账单');
    await prisma.$disconnect();
    return;
  }

  // 按用户准备分类缓存与别名映射（分类可能是用户自定义的，必须分用户构建）
  const userCache = new Map();
  async function getCtx(userId) {
    const key = String(userId);
    if (userCache.has(key)) return userCache.get(key);
    const categories = await prisma.category.findMany({ where: { OR: [{ userId: null }, { userId }] } });
    const typeCache = new Map();
    const nameCache = new Map();
    const aliasMap = new Map();
    const idToName = new Map();
    for (const c of categories) {
      typeCache.set(`${c.type}:${c.name}`, c.id);
      if (!nameCache.has(c.name) || c.type === 'expense') nameCache.set(c.name, c.id);
      idToName.set(String(c.id), `${c.name}(${c.type})`);
      const aliases = Array.isArray(c.aliases) ? c.aliases : [];
      for (const a of aliases) {
        if (a && a.source && a.value) aliasMap.set(`${a.source}|${a.value}`, { id: c.id, type: c.type });
      }
    }
    const ctx = { typeCache, nameCache, aliasMap, idToName };
    userCache.set(key, ctx);
    return ctx;
  }

  // 解析每一条，按 (userId, categoryId) 归组后批量 updateMany
  const groups = new Map(); // key -> { userId, categoryId, ids[] }
  const report = {}; // 分类名 -> 条数
  let noSourceCategory = 0;

  for (const b of bills) {
    const ctx = await getCtx(b.userId);
    const raw = b.rawData && typeof b.rawData === 'object' && 'data' in b.rawData ? b.rawData.data : b.rawData;
    const d = raw && typeof raw === 'object' ? raw : {};
    const sourceCategory = d['交易分类'] || d['交易类型'] || undefined;
    if (!sourceCategory) noSourceCategory++;

    const categoryId = svc.resolveBillCategory({
      source: b.source,
      sourceCategory,
      billType: 'neutral',
      aliasMap: ctx.aliasMap,
      typeCache: ctx.typeCache,
      nameCache: ctx.nameCache,
    });
    if (categoryId === undefined) {
      console.warn(`[WARN] 账单 ${b.id} 解析不出分类，跳过`);
      continue;
    }
    const gkey = `${b.userId}:${categoryId}`;
    if (!groups.has(gkey)) groups.set(gkey, { userId: b.userId, categoryId, ids: [], name: ctx.idToName.get(String(categoryId)) });
    groups.get(gkey).ids.push(b.id);

    const label = `${b.source} ${sourceCategory || '(原始数据无来源分类)'} -> ${ctx.idToName.get(String(categoryId))}`;
    report[label] = (report[label] || 0) + 1;
  }

  console.log(`待回填中性账单 ${bills.length} 条${ONLY_USER !== null ? `（用户 ${ONLY_USER}）` : ''}，其中原始数据缺少来源分类 ${noSourceCategory} 条`);
  console.log('\n=== 回填分布 ===');
  Object.entries(report)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(String(v).padStart(5) + '  ' + k));

  if (!APPLY) {
    console.log('\n[DRY-RUN] 未写库。确认无误后加 --apply 执行。');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 500) {
      const chunk = g.ids.slice(i, i + 500);
      const r = await prisma.bill.updateMany({
        where: { id: { in: chunk }, categoryId: null },
        data: { categoryId: g.categoryId },
      });
      updated += r.count;
    }
    console.log(`[OK] ${g.name} <- ${g.ids.length} 条`);
  }

  const left = await prisma.bill.count({ where });
  console.log(`\n[OK] 已回填 ${updated} 条；剩余未回填（中性且无分类）${left} 条`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('[FAIL]', e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
