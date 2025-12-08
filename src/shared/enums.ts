// src/shared/enums.ts
// awsでデプロイするときにエラーが出るためdtoファイルで使用

export enum VisibilityEnum {
  free = 'free',
  plan = 'plan',
  paid_single = 'paid_single',
}

export enum AgeRatingEnum {
  all = 'all',
  r18 = 'r18',
}

export enum PublishedStatusEnum {
  draft = 'draft',
  published = 'published',
  private = 'private',
}

// 必要なら以下も全部 TS で定義
export enum RoleEnum { fan='fan', creator='creator', admin='admin', sub_admin = 'sub_admin' }
export enum MediaTypeEnum { image='image', video='video', audio='audio' }
export enum PaymentKindEnum { subscription='subscription', one_time='one_time' }
export enum SubStatusEnum {
  active='active',
  past_due='past_due',
  canceled='canceled',
  incomplete='incomplete',
  trialing='trialing',
}
export enum BillingIntervalEnum { month='month', year='year' }
