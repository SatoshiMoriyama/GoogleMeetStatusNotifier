# Google Meet Status Notifier with Alexa Integration

Google Meet の会議開始/終了を自動検知して Alexa に通知するシステム

## 概要

このプロジェクトは、Google Meet の会議状態を検知し、Alexa スキルを通じて音声通知を行うシステムです。

### システム構成

```
Chrome 拡張機能 → API Gateway → EventBridge → Lambda (Durable) → Alexa スキル
                                                    ↓
                                                DynamoDB
```

## プロジェクト構成（モノレポ）

```
.
├── packages/
│   ├── cdk/                    # AWS CDK インフラコード
│   │   ├── lib/
│   │   │   ├── stack/
│   │   │   │   ├── alexa-skill-stack.ts       # Alexa スキルスタック
│   │   │   │   ├── webhook-stack.ts           # Webhook スタック
│   │   │   │   └── durable-webhook-stack.ts   # Durable Webhook スタック
│   │   │   └── stage/
│   │   │       └── application-stage.ts       # アプリケーションステージ
│   │   ├── lambda/
│   │   │   ├── skill/              # Alexa スキル Lambda
│   │   │   ├── webhook/            # Webhook Lambda
│   │   │   └── durable-webhook/    # Durable Webhook Lambda
│   │   └── README.md
│   └── chrome-extension/       # Chrome 拡張機能
│       ├── manifest.json
│       ├── content.js
│       └── config.js
├── work/                       # 設計ドキュメント
├── archive/                    # 過去の実装資料
└── README.md
```

## セットアップ

### 1. AWS インフラのデプロイ（CDK）

```bash
cd packages/cdk

# 依存関係のインストール
pnpm install

# 環境変数の設定
cp .env.sample .env
# .env を編集して Alexa の認証情報を設定

# デプロイ
pnpm cdk deploy --all
```

詳細は [packages/cdk/README.md](packages/cdk/README.md) を参照。

### 2. Chrome 拡張機能のセットアップ

```bash
cd packages/chrome-extension

# 設定ファイルの作成
cp config.sample.js config.js
```

`config.js` を編集して、CDK でデプロイした Webhook URL を設定：

```javascript
const CONFIG = {
  WEBHOOK_URL: "https://your-api-gateway-url.execute-api.ap-northeast-1.amazonaws.com/prod/webhook",
};
```

#### Chrome への読み込み

1. Chrome で `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `packages/chrome-extension` フォルダを選択

## 使い方

1. Chrome 拡張機能をインストール
2. Google Meet で会議を開始
3. 会議開始時に Alexa が通知
4. 会議終了時に Alexa が通知

## 技術スタック

### インフラ（CDK）

- **AWS CDK**: TypeScript でインフラを定義
- **AWS Lambda**: サーバーレス関数（Node.js 20.x）
- **Amazon DynamoDB**: ユーザー状態の保存
- **Amazon API Gateway**: Webhook エンドポイント
- **AWS Solutions Constructs**: ベストプラクティスを適用した構成

### フロントエンド

- **Chrome Extension**: Manifest V3
- **Content Script**: Google Meet のページを監視

## 開発

### CDK のテスト

```bash
cd packages/cdk
pnpm test
```

### CDK Nag によるセキュリティチェック

```bash
cd packages/cdk
pnpm cdk synth
```

## アーキテクチャの特徴

- **マルチリージョン**: Alexa スキル（us-west-2）、Webhook（ap-northeast-1）、Durable Webhook（us-east-2）
- **Lambda Durable Functions**: 会議開始から終了までを1つの実行で管理、待機中は課金なし
- **サーバーレス**: Lambda + DynamoDB でコスト最適化
- **セキュリティ**: CDK Nag によるベストプラクティスチェック
- **スケーラブル**: DynamoDB のオンデマンド課金

## 設計ドキュメント

`work/` ディレクトリに詳細な設計ドキュメントを格納：

- `cdk-structure.md` - CDK の App/Stage/Stack 構成
- `durable-workflow.md` - Durable Functions のワークフロー
- `durable-execution-flow.md` - 実行ID A/B の動き
- `checkpoint-explanation.md` - チェックポイントの仕組み

## ライセンス

MIT
