# Durable Webhook Lambda

AWS Lambda Durable Functionsを使用した会議状態追跡用Webhook。

## 特徴

- **1つの実行で開始→終了を追跡**: 会議開始時に実行開始、終了時に再開
- **待機中は課金なし**: `waitForCallback`で停止中は計算リソースを消費しない
- **自動チェックポイント**: 開始通知後に状態を保存、リプレイ時はスキップ

## フロー

### 1. 会議開始時

```
Chrome拡張 → API Gateway → Durable Lambda
                              ↓
                         ステップ1: 開始通知
                              ↓
                         callbackId生成
                              ↓
                         waitForCallback（停止）
                              ↓
                         レスポンス: { callbackId }
```

### 2. 会議終了時

```
Chrome拡張 → API Gateway → Durable Lambda
  (callbackId付き)            ↓
                         SendDurableExecutionCallbackSuccess
                              ↓
                         Lambda再開（リプレイ）
                              ↓
                         ステップ2: 終了通知
                              ↓
                         完了
```

## リクエスト形式

### 会議開始

```json
{
  "status": "meeting_started"
}
```

レスポンス:
```json
{
  "message": "Meeting tracked",
  "callbackId": "abc123..."
}
```

### 会議終了

```json
{
  "status": "meeting_ended",
  "callbackId": "abc123..."
}
```

レスポンス:
```json
{
  "message": "Callback completed"
}
```

## 環境変数

- `SKILL_LAMBDA_ARN`: Alexa Skill LambdaのARN
- `AWS_REGION`: us-east-2（Durable Functions対応リージョン）

## 必要な権限

- `lambda:InvokeFunction`: Skill Lambda呼び出し
- `lambda:CheckpointDurableExecutions`: チェックポイント作成
- `lambda:GetDurableExecutionState`: 状態取得
- `lambda:SendDurableExecutionCallbackSuccess`: コールバック完了

## デプロイ

```bash
cd packages/cdk
pnpm cdk deploy DurableWebhookStack
```

## テスト

```bash
# 会議開始
curl -X POST https://xxx.execute-api.us-east-2.amazonaws.com/prod/webhook \
  -H "Content-Type: application/json" \
  -d '{"status": "meeting_started"}'

# レスポンスのcallbackIdを保存

# 会議終了
curl -X POST https://xxx.execute-api.us-east-2.amazonaws.com/prod/webhook \
  -H "Content-Type: application/json" \
  -d '{"status": "meeting_ended", "callbackId": "abc123..."}'
```

## 制約

- **リージョン**: US East (Ohio) のみ対応
- **ランタイム**: Node.js 22.x以上
- **最大実行時間**: 1年
- **保持期間**: 7日（設定可能）
