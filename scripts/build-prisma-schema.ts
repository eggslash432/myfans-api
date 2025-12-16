// api/scripts/build-prisma-schema.ts

import * as fs from "fs";
import * as path from "path";

const partsDir = path.resolve("prisma/schema");
const outFile = path.resolve("prisma/schema.prisma");

const files: string[] = fs
  .readdirSync(partsDir)
  .filter((f: string) => f.endsWith(".prisma"))
  .sort((a: string, b: string) => a.localeCompare(b));

const header =
  `// AUTO-GENERATED FILE. DO NOT EDIT.\n` +
  `// Edit files in prisma/schema/*.prisma instead.\n\n`;

const body = files
  .map((f: string) => {
    const p = path.join(partsDir, f);
    const c = fs.readFileSync(p, "utf8").trimEnd();
    return `// ===== ${f} =====\n${c}\n`;
  })
  .join("\n");

fs.writeFileSync(outFile, header + body, "utf8");
console.log(`✅ prisma/schema.prisma generated from ${files.length} files`);
