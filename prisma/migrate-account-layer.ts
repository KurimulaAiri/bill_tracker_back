import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// 顶层父账户配置：名称 + 类型
const PARENT_CONF = [
  { name: '微信', type: 'wechat' },
  { name: '支付宝', type: 'alipay' },
  { name: '建设银行', type: 'bank' },
];

/** 从卡号中提取后四位数字（过滤非数字），无数字返回 null */
function last4Digits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length ? digits.slice(-4) : null;
}

/** 在 used 集合内生成不冲突的子账户名 */
function uniqName(used: Set<string>, base: string): string {
  let n = base;
  let i = 2;
  while (used.has(n)) {
    n = `${base}-${i++}`;
    if (n.length > 50) n = `${base.slice(0, 40)}-${i}`;
  }
  used.add(n);
  return n;
}

// 顶层父账户是否就是当前记录本身（避免把父账户当子账户迁移）
function isParentItself(acc: { name: string; type: string }): boolean {
  return PARENT_CONF.some((c) => c.name === acc.name && c.type === acc.type);
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });
  const issues: string[] = [];
  let moved = 0;

  for (const u of users) {
    // 1. 确保父账户存在（微信/支付宝/建设银行）
    const parents = new Map<string, { id: bigint }>();
    const usedNames = new Map<string, Set<string>>();
    for (const conf of PARENT_CONF) {
      let parent = await prisma.account.findFirst({
        where: { userId: u.id, parentId: null, name: conf.name, type: conf.type },
      });
      if (!parent) {
        parent = await prisma.account.create({
          data: { userId: u.id, name: conf.name, type: conf.type },
        });
        console.log(`[用户${u.id}] 创建父账户: ${conf.name}`);
      }
      parents.set(conf.name, parent);
      usedNames.set(parent.id.toString(), new Set<string>());
    }

    // 2. 迁移存量顶层账户到父账户下
    const topAccounts = await prisma.account.findMany({
      where: { userId: u.id, parentId: null },
    });
    for (const acc of topAccounts) {
      if (isParentItself(acc)) continue; // 父账户本身，跳过

      const name = acc.name;
      let parentName: string | null = null;
      let childBase: string | null = null;

      const m = /^(.+?)-(.*)$/.exec(name);
      if (m) {
        const prefix = m[1];
        const rest = m[2].trim();
        if (prefix === '微信' || prefix === '支付宝') {
          parentName = prefix;
          childBase = rest || (prefix === '微信' ? '零钱' : '余额');
        } else if (prefix === '建行活期' || prefix === '建行信用卡') {
          parentName = '建设银行';
          const cardType = prefix === '建行活期' ? '储蓄卡' : '信用卡';
          const last4 = last4Digits(rest);
          childBase = last4 ? `${cardType}-${last4}` : cardType;
        } else {
          issues.push(`[用户${u.id}] 未知前缀跳过: ${name}`);
          continue;
        }
      } else {
        if (name === '微信') { parentName = '微信'; childBase = '零钱'; }
        else if (name === '支付宝') { parentName = '支付宝'; childBase = '余额'; }
        else if (name === '建行活期') { parentName = '建设银行'; childBase = '储蓄卡'; }
        else if (name === '建行信用卡') { parentName = '建设银行'; childBase = '信用卡'; }
        else {
          issues.push(`[用户${u.id}] 无名后缀且非目标前缀，跳过: ${name}`);
          continue;
        }
      }

      const parent = parents.get(parentName!);
      if (!parent) continue;
      const used = usedNames.get(parent.id.toString())!;
      const childName = uniqName(used, childBase!);

      await prisma.account.update({
        where: { id: acc.id },
        data: { parentId: parent.id, name: childName },
      });
      moved++;
      console.log(`[用户${u.id}] ${name} -> ${parentName}/${childName}`);
    }

    // 3. 建设银行父下若没有任何子账户，补一个默认储蓄卡子账户
    const ccb = parents.get('建设银行');
    if (ccb) {
      const childCount = await prisma.account.count({
        where: { userId: u.id, parentId: ccb.id },
      });
      if (childCount === 0) {
        const used = usedNames.get(ccb.id.toString())!;
        const childName = uniqName(used, '储蓄卡');
        await prisma.account.create({
          data: { userId: u.id, parentId: ccb.id, name: childName, type: 'bank' },
        });
        console.log(`[用户${u.id}] 建设银行无子账户，创建默认: ${childName}`);
      }
    }
  }

  console.log(`\n迁移完成：共处理 ${moved} 条存量账户`);
  if (issues.length) {
    console.log(`跳过/异常 ${issues.length} 条：`);
    issues.forEach((i) => console.log(`  - ${i}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());