import {
  LambdaClient,
  InvokeCommand,
  SendDurableExecutionCallbackSuccessCommand,
} from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";

const skillLambdaClient = new LambdaClient({ region: "us-west-2" });
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || "ap-northeast-1",
});
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const SKILL_LAMBDA_ARN = process.env.SKILL_LAMBDA_ARN;
const TABLE_NAME = process.env.MEETING_STATE_TABLE_NAME;

// DynamoDB から会議データを取得
async function getMeetingData(meetingId) {
  const { Item } = await ddbClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { meetingId },
    })
  );
  return Item;
}

// DynamoDB に会議データを保存
async function saveMeetingData(meetingId, callbackId) {
  await ddbClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        meetingId,
        callbackId,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 86400, // 24時間後
      },
    })
  );
}

// DynamoDB から会議データを削除
async function deleteMeetingData(meetingId) {
  await ddbClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { meetingId },
    })
  );
}

// Alexa通知
async function notifyAlexa(status) {
  const command = new InvokeCommand({
    FunctionName: SKILL_LAMBDA_ARN,
    InvocationType: "Event",
    Payload: JSON.stringify({
      directive: {
        header: {
          namespace: "Alexa",
          name: "ChangeReport",
        },
      },
      source: "lambda-durable-webhook",
      status,
    }),
  });
  await skillLambdaClient.send(command);
  console.log("Alexa notified:", status);
}

export const handler = withDurableExecution(async (event, context) => {
  try {
    // EventBridge からのイベント（detail は既にオブジェクト）
    const { meetingId } = event.detail;

    console.log("Received:", { meetingId });

    if (!meetingId) {
      throw new Error("meetingId is required");
    }

    // DynamoDB から会議データを取得
    const meetingData = await getMeetingData(meetingId);

    // 会議終了時の処理（callbackId が存在する = 会議中）
    if (meetingData?.callbackId) {
      console.log("Completing callback:", meetingData.callbackId);

      // コールバック完了
      await lambdaClient.send(
        new SendDurableExecutionCallbackSuccessCommand({
          CallbackId: meetingData.callbackId,
          Result: JSON.stringify({ status: "meeting_ended" }),
        })
      );

      // DynamoDB から削除
      await deleteMeetingData(meetingId);

      console.log("Meeting ended successfully:", meetingId);
      return;
    }

    // 会議開始時の処理（callbackId が存在しない = 新規会議）
    // ステップ1: 開始通知
    await context.step("notifyStart", async () => {
      await notifyAlexa("meeting_started");
    });

    // コールバック作成
    const [callbackPromise, callbackId] = await context.createCallback({
      timeout: { hours: 24 },
    });

    console.log("CallbackId created:", callbackId);

    // DynamoDB に保存
    await saveMeetingData(meetingId, callbackId);

    // コールバック待機（会議終了まで停止）
    await callbackPromise;

    // ステップ2: 終了通知
    await context.step("notifyEnd", async () => {
      await notifyAlexa("meeting_ended");
    });

    // ステップ3: クリーンアップ
    await context.step("finalize", async () => {
      await deleteMeetingData(meetingId);
      console.log("Meeting data cleaned up:", meetingId);
    });

    console.log("Meeting completed successfully:", meetingId);
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
});
