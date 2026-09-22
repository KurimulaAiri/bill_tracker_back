const { PrismaClient } = require('@prisma/client');
const q = new PrismaClient();
(async () => {
  const rows = await q.importBatch.findMany({
    orderBy: { id: 'desc' },
    take: 5,
    select: { id: true, fileName: true, source: true, meta: true },
  });
  console.log(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  await q.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });