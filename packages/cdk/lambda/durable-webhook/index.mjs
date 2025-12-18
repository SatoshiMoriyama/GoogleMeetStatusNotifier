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
  region: "us-east-2",
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
    // API Gateway からの直接呼び出しに対応
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const meetingId = body.meetingId || 'default';

    console.log("Received:", { meetingId, event });

    if (!meetingId) {
      throw new Error("meetingId is required");
    }

    // DynamoDB から会議データを取得（ステップとして実行し、リプレイ時は再実行しない）
    const meetingData = await context.step("checkMeetingState", async () => {
      return await getMeetingData(meetingId);
    });

    // 会議中の場合（callbackId が存在する）：コールバックを完了させて終了
    if (meetingData?.callbackId) {
      console.log("Completing callback:", meetingData.callbackId);

      await context.step("completeCallback", async () => {
        await lambdaClient.send(
          new SendDurableExecutionCallbackSuccessCommand({
            CallbackId: meetingData.callbackId,
            Result: JSON.stringify({ status: "meeting_ended" }),
          })
        );
      });

      console.log("Callback completed for:", meetingId);
      return { processed: "callback_completed" };
    }

    // 新規会議の場合：メインのフロー
    // ステップ1: 開始通知
    await context.step("notifyStart", async () => {
      await notifyAlexa("meeting_started");
    });

    // コールバック作成
    const [callbackPromise, callbackId] = await context.createCallback(
      "wait-for-meeting-end",
      {
        timeout: { hours: 24 },
      }
    );

    console.log("CallbackId created:", callbackId);

    // DynamoDB に保存
    await context.step("saveCallbackId", async () => {
      await saveMeetingData(meetingId, callbackId);
    });

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
