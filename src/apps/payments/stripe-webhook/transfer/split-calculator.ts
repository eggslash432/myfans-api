// api/src/apps/payments/stripe-webhook/split-calculator.ts
export type FeeSettingLike = {
  id?: number;
  managerPercent?: number | null;
  shopPercent?: number | null;
  creatorPercent?: number | null;
  updatedAt?: Date;
};

export type SplitAmounts = {
  managerAmountJpy: number;
  shopAmountJpy: number;
  creatorAmountJpy: number;
};

export function makeEffectiveFeeSetting(
  fee: FeeSettingLike,
  shopId?: string | null,
): FeeSettingLike {
  if (shopId) return fee;

  return {
    ...fee,
    shopPercent: 0,
    // 説明用（画面に出すなら整合）
    creatorPercent: (fee.creatorPercent ?? 0) + (fee.shopPercent ?? 0),
  };
}

export function splitByFeeSetting(totalJpy: number, setting: FeeSettingLike): SplitAmounts {
  const manager = Math.floor((totalJpy * (setting.managerPercent ?? 0)) / 100);
  const shop = Math.floor((totalJpy * (setting.shopPercent ?? 0)) / 100);
  const creator = totalJpy - manager - shop;

  return {
    managerAmountJpy: manager,
    shopAmountJpy: shop,
    creatorAmountJpy: creator,
  };
}
