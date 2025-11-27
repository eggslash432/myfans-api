// prisma.config.ts （api直下）
// Prisma7 では .env 自動ロードされないので、自分で読む
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

type Env = {
  DATABASE_URL: string;
};

export default defineConfig({
  // schema の場所を明示
  schema: 'prisma/schema.prisma',
  // マイグレーションのパス（既存構成に合わせて）
  migrations: {
    path: 'prisma/migrations',
  },
  // ← ここで datasource.url を設定（Prisma7 ルール）
  datasource: {
    url: env<Env>('DATABASE_URL'),
  },
});
