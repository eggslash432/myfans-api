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


AWSへのデータベースのmigrate：
ECSのタスクの実行で
Vpcやらセキュリティグループを設定した後、（vpcはprivateのやつだけ選択、セキュリティグループはtask-sgみたいなやつ）
コンテナの上書きのコマンドで
sh
-c
npx prisma migrate deploy
これでprismaをmigrateできる


「分割したPrismaの統合、マイグレーション」

npm run prisma:build
npm run prisma:generate
npm run prisma:migrate:dev

「データベース管理」
npm run prisma:studio