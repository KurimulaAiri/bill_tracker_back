import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// 预置分类（系统级，userId 为 NULL）
const presetCategories = [
  { name: '餐饮美食', type: 'expense', icon: 'food', sort: 1 },
  { name: '交通出行', type: 'expense', icon: 'traffic', sort: 2 },
  { name: '日用百货', type: 'expense', icon: 'shopping', sort: 3 },
  { name: '文化休闲', type: 'expense', icon: 'fun', sort: 4 },
  { name: '居住缴费', type: 'expense', icon: 'home', sort: 5 },
  { name: '医疗健康', type: 'expense', icon: 'health', sort: 6 },
  { name: '投资理财', type: 'expense', icon: 'invest', sort: 7 },
  { name: '资金互转', type: 'expense', icon: 'transfer', sort: 8 },
  { name: '其他支出', type: 'expense', icon: 'other', sort: 90 },
  { name: '工资收入', type: 'income', icon: 'salary', sort: 1 },
  { name: '退款收入', type: 'income', icon: 'refund', sort: 2 },
  { name: '其他收入', type: 'income', icon: 'other-income', sort: 90 },
];

// 支付宝原始分类映射（expense）
const alipayCategoryMap: Record<string, string> = {
  餐饮美食: '餐饮美食',
  交通出行: '交通出行',
  日用百货: '日用百货',
  文化休闲: '文化休闲',
  充值缴费: '居住缴费',
  投资理财: '投资理财',
  资金互转: '资金互转',
  退款: '退款收入',
};

async function main() {
  for (const c of presetCategories) {
    const exists = await prisma.category.findFirst({
      where: { userId: null, name: c.name, type: c.type },
    });
    if (!exists) {
      // @ts-ignore userId 允许为 null（系统级分类）
      await prisma.category.create({ data: { userId: null, ...c } });
    }
  }
  console.log('Seeded categories:', presetCategories.length);
  console.log('支付宝分类映射表 (key=name value=systemCategory):', JSON.stringify(alipayCategoryMap, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());