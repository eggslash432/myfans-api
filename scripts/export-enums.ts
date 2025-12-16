// api/scripts/export-enums.ts

import { writeFileSync, mkdirSync } from 'fs';
import { Prisma } from '@prisma/client';

const outPath = '../front/src/shared/prisma-enums.ts';

// 出力先が無ければ作成
mkdirSync('../front/src/shared', { recursive: true });

// Prisma の公開APIから DMMF を取得
const enums = Prisma.dmmf.datamodel.enums.map(e => {
  const values = e.values.map(v => `'${v.name}'`).join(' | ');
  return `export type ${e.name} = ${values};`;
});

writeFileSync(outPath, enums.join('\n\n') + '\n');
console.log(`✅ Exported: ${outPath}`);
