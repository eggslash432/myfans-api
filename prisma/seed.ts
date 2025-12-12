// api/prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.uploadSetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      maxFileSizeMb: 200,
      maxFiles: 10,
    },
  });

  console.log('UploadSetting seeded');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
