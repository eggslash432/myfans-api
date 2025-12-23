「AWSへのデプロイ」

バックエンド：
※先に.envをprod用に変更しておく

１：docker build
cd api
docker buildx build --platform linux/amd64 -t api:latest --load .

２：ECRログイン
aws ecr get-login-password --region ap-northeast-1 \
  | docker login \
    --username AWS \
    --password-stdin 337170977353.dkr.ecr.ap-northeast-1.amazonaws.com

３：タグ付け（ECR用）
docker tag api:latest 337170977353.dkr.ecr.ap-northeast-1.amazonaws.com/himefan/himefan-api:latest

４：ECRにpush
docker push 337170977353.dkr.ecr.ap-northeast-1.amazonaws.com/himefan/himefan-api:latest

５：ECSに新しいイメージをデプロイ(下のコマンドはエラー出るのでとりあえずコンソールから更新)
aws ecs update-service \
  --cluster himefan-cluster \
  --service himefan-api-service \
  --force-new-deployment


⚪︎AWSへのデータベースのmigrate
ECSのタスクの実行で
Vpcやらセキュリティグループを設定した後、（vpcはprivateのやつだけ選択、セキュリティグループはtask-sgみたいなやつ）
コンテナの上書きのコマンドで

sh
-c
npx prisma migrate deploy

これでprismaをmigrateできる

⚪︎Macからpsqlでローカルへ接続
psql -h localhost -p 5432 -U myfans -d myfans
パス：password

⚪︎Macからpsqlで本番環境へ接続
psql \
  -h himefan-database1.cfqesa8wu2qz.ap-northeast-1.rds.amazonaws.com \
  -p 5432 \
  -U postgres \
  -d himefan_database1

  パスワード：.env.prodに書いてる


「分割したPrismaの統合、マイグレーション」

npm run prisma:build      # ← 必須（統合 schema を作る）
npx prisma migrate dev    # ← migration 作成 + DB 反映

npm run prisma:generate   # ← Prisma Client 再生成


「データベース管理」
npm run prisma:studio

「スキーマのenumsをfrontにprisma-enums.tsとして出力」
npx ts-node scripts/export-enums.ts

⚪︎ストライプのログを見る
stripe listen --forward-to localhost:3000/api/stripe/webhook