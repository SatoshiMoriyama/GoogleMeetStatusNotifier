# Alexa Skill & Webhook CDK Project

Alexa スキルと Webhook を AWS にデプロイするための CDK プロジェクト

## 構成

- **AlexaSkillStack**: Alexa スキル用の Lambda 関数と DynamoDB テーブル（us-west-2）
- **WebhookStack**: Webhook 受信用の API Gateway と Lambda 関数（ap-northeast-1）

## セットアップ

### 1. 環境変数の設定

`.env` ファイルを作成：

```bash
ALEXA_CLIENT_ID=your_client_id
ALEXA_CLIENT_SECRET=your_client_secret
ALEXA_SKILL_ID=your_skill_id
```

### 2. 依存関係のインストール

```bash
pnpm install
```

## ファイル構成

```
lib/
├── stage/
│   └── application-stage.ts  # アプリケーション全体のステージ
└── stack/
    ├── alexa-skill-stack.ts  # Alexa スキルスタック
    └── webhook-stack.ts      # Webhook スタック
```
