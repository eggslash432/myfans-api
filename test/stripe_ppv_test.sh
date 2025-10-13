#!/usr/bin/env bash
set -euo pipefail

# ← ここを書き換え
USER_ID="039fe5b8-9db9-498f-9d2e-e54bc7d703df"
POST_ID="1d5db5ae-d3ce-47bc-8988-71cb09713d4c"
AMOUNT=30000  # 300円

# ==== 実行 ====
echo "[1/3] checkout.session.completed (payment, metadata)"
stripe trigger checkout.session.completed \
  --override 'checkout_session:mode=payment' \
  --override "checkout_session:metadata[userId]=$USER_ID" \
  --override "checkout_session:metadata[postId]=$POST_ID"

echo "[2/3] charge.succeeded (amount, currency, metadata)"
stripe trigger charge.succeeded \
  --override "charge:amount=$AMOUNT" \
  --override 'charge:currency=jpy' \
  --override "charge:metadata[userId]=$USER_ID" \
  --override "charge:metadata[postId]=$POST_ID"

# 必要なら payment_intent.succeeded も発火
# echo "[3/3] payment_intent.succeeded (optional)"
# stripe trigger payment_intent.succeeded \
#   --override "payment_intent:amount=$AMOUNT" \
#   --override 'payment_intent:currency=jpy' \
#   --override "payment_intent:metadata[userId]=$USER_ID" \
#   --override "payment_intent:metadata[postId]=$POST_ID"

echo "Done."
