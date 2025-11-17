# -------- ビルド用イメージ --------
FROM --platform=linux/amd64 node:20-alpine AS builder

WORKDIR /usr/src/app

# 依存関係
COPY package*.json ./
COPY prisma ./prisma

# 依存インストール（dev含む）
RUN npm ci

# Prisma Client 生成（1回だけ）
RUN npx prisma generate

# アプリ本体
COPY . .

# NestJS ビルド（dist/作成）
RUN npm run build

# -------- 本番用イメージ --------
FROM --platform=linux/amd64 node:20-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

# ★ package.json を必ずコピーする
COPY --from=builder /usr/src/app/package*.json ./

# builder で準備した node_modules / prisma / dist をそのまま持ってくる
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/prisma       ./prisma
COPY --from=builder /usr/src/app/dist         ./dist

CMD ["npm", "run", "start"]

