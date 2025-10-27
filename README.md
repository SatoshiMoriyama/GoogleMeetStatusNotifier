# Google Meet Status Notifier

Google Meet の会議開始/終了を自動検知して Webhook に通知する Chrome 拡張機能

## 機能

- 会議開始時に `meeting_started` を送信
- 会議終了時に `meeting_ended` を送信
- タブを閉じた場合も確実に終了通知を送信

## セットアップ

### 1. 設定ファイルの作成

```bash
cp config.sample.js config.js
```

### 2. Webhook URL の設定

`config.js` を編集して Webhook URL を設定：

```javascript
const CONFIG = {
  WEBHOOK_URL: "https://your-webhook-url.example.com/webhook",
};
```

### 3. Chrome 拡張機能として読み込み

1. Chrome で `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このフォルダを選択

## Webhook 仕様

### リクエスト形式

```json
{
  "status": "meeting_started",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### status の値

- `meeting_started`: 会議開始
- `meeting_ended`: 会議終了

## ファイル構成

```
.
├── manifest.json       # 拡張機能の設定
├── content.js          # メインロジック
├── config.js           # Webhook URL設定（gitignore）
└── config.sample.js    # 設定サンプル
```
