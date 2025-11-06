// Lambda B: Alexa Smart Home Skill本体

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.DDB_TABLE_NAME;
const CLIENT_ID = process.env.ALEXA_CLIENT_ID;
const CLIENT_SECRET = process.env.ALEXA_CLIENT_SECRET;

function handleDiscovery(request) {
  return {
    event: {
      header: {
        namespace: "Alexa.Discovery",
        name: "Discover.Response",
        payloadVersion: "3",
        messageId: request.directive.header.messageId,
      },
      payload: {
        endpoints: [
          {
            endpointId: "meeting-sensor-001",
            manufacturerName: "Custom",
            friendlyName: "会議センサー",
            description: "Google Meet会議検知センサー",
            displayCategories: ["CONTACT_SENSOR"],
            capabilities: [
              {
                type: "AlexaInterface",
                interface: "Alexa.ContactSensor",
                version: "3",
                properties: {
                  supported: [{ name: "detectionState" }],
                  proactivelyReported: true,
                  retrievable: true,
                },
              },
              {
                type: "AlexaInterface",
                interface: "Alexa.EndpointHealth",
                version: "3",
                properties: {
                  supported: [{ name: "connectivity" }],
                  proactivelyReported: true,
                  retrievable: true,
                },
              },
              {
                type: "AlexaInterface",
                interface: "Alexa",
                version: "3",
              },
            ],
          },
        ],
      },
    },
  };
}

async function handleReportState(request) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId: "default" },
    })
  );

  // 会議状態がない場合はNOT_DETECTEDをデフォルトに
  const currentState = Item?.meetingState || "NOT_DETECTED";

  return {
    event: {
      header: {
        namespace: "Alexa",
        name: "StateReport",
        payloadVersion: "3",
        messageId: generateMessageId(),
        correlationToken: request.directive.header.correlationToken,
      },
      endpoint: {
        endpointId: request.directive.endpoint.endpointId,
      },
      payload: {},
    },
    context: {
      properties: [
        {
          namespace: "Alexa.ContactSensor",
          name: "detectionState",
          value: currentState,
          timeOfSample: new Date().toISOString(),
          uncertaintyInMilliseconds: 0,
        },
      ],
    },
  };
}

async function sendChangeReport(detectionState) {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId: "default" },
    })
  );

  if (!Item || !Item.accessToken) {
    throw new Error("Access token not found");
  }

  const timestamp = new Date().toISOString();
  console.log("Current timestamp:", timestamp);
  console.log("Token from DB:", Item);

  const changeReport = {
    context: {
      properties: [
        {
          namespace: "Alexa.ContactSensor",
          name: "detectionState",
          value: detectionState,
          timeOfSample: timestamp,
          uncertaintyInMilliseconds: 0,
        },
      ],
    },
    event: {
      header: {
        namespace: "Alexa",
        name: "ChangeReport",
        payloadVersion: "3",
        messageId: generateMessageId(),
      },
      endpoint: {
        scope: {
          type: "BearerToken",
          token: Item.accessToken,
        },
        endpointId: "meeting-sensor-001",
      },
      payload: {
        change: {
          cause: { type: "PHYSICAL_INTERACTION" },
          properties: [
            {
              namespace: "Alexa.ContactSensor",
              name: "detectionState",
              value: detectionState,
              timeOfSample: timestamp,
              uncertaintyInMilliseconds: 0,
            },
          ],
        },
      },
    },
  };

  const endpoint = "https://api.fe.amazonalexa.com/v3/events";
  console.log("POST endpoint:", endpoint);
  console.log("POST body:", JSON.stringify(changeReport, null, 2));

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Item.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(changeReport),
  });

  // 会議状態をDynamoDBに保存
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...Item,
        meetingState: detectionState,
        lastUpdated: timestamp,
      },
    })
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Alexa API Error:", response.status, errorBody);

    if (response.status === 401 && Item.refreshToken) {
      console.log("401 error, refreshing token and retrying...");
      const newToken = await refreshAccessToken(Item.refreshToken);
      changeReport.event.endpoint.scope.token = newToken;

      const retryResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${newToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(changeReport),
      });

      if (!retryResponse.ok) {
        const retryError = await retryResponse.text();
        throw new Error(
          `Retry failed: ${retryResponse.status} - ${retryError}`
        );
      }

      return { success: true };
    }

    throw new Error(`Alexa API error: ${response.status} - ${errorBody}`);
  }

  return { success: true };
}

// AcceptGrant: アカウントリンク完了時にcodeを使ってトークンを取得
async function handleAcceptGrant(request) {
  console.log("=== AcceptGrant START ===");
  console.log("Account linking initiated!");

  const code = request.directive.payload.grant.code;
  console.log("Authorization code received:", code.substring(0, 20) + "...");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  console.log("Requesting tokens from Amazon OAuth2...");
  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const tokens = await response.json();
  console.log("Tokens received:", tokens);

  const expiresIn = tokens.expires_in || 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  console.log("Saving tokens to DynamoDB...");
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        userId: "default",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: expiresAt,
        meetingState: "NOT_DETECTED",
        updatedAt: new Date().toISOString(),
      },
    })
  );

  console.log("Tokens saved successfully!");
  console.log("=== AcceptGrant COMPLETE ===");

  return {
    event: {
      header: {
        namespace: "Alexa.Authorization",
        name: "AcceptGrant.Response",
        payloadVersion: "3",
        messageId: generateMessageId(),
      },
      payload: {},
    },
  };
}

// トークンをリフレッシュ
async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const tokens = await response.json();

  const expiresIn = tokens.expires_in || 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        userId: "default",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: expiresAt,
        updatedAt: new Date().toISOString(),
      },
    })
  );

  return tokens.access_token;
}

function generateMessageId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// メインハンドラー
export const handler = async (event) => {
  console.log("Request:", JSON.stringify(event, null, 2));

  try {
    // Lambda Aからの直接呼び出し（会議開始通知）
    if (event.source === "lambda-webhook") {
      const detectionState =
        event.status === "meeting_started" ? "DETECTED" : "NOT_DETECTED";
      return await sendChangeReport(detectionState);
    }

    // Alexaからのリクエスト
    const namespace = event.directive.header.namespace;
    const name = event.directive.header.name;

    // AcceptGrant: アカウントリンク完了時
    if (namespace === "Alexa.Authorization" && name === "AcceptGrant") {
      return await handleAcceptGrant(event);
    }

    // Discovery
    if (namespace === "Alexa.Discovery" && name === "Discover") {
      return handleDiscovery(event);
    }

    // ReportState
    if (namespace === "Alexa" && name === "ReportState") {
      return await handleReportState(event);
    }

    // その他のリクエスト
    return {
      event: {
        header: {
          namespace: "Alexa",
          name: "ErrorResponse",
          payloadVersion: "3",
          messageId: generateMessageId(),
        },
        payload: {
          type: "INVALID_DIRECTIVE",
          message: "Unsupported directive",
        },
      },
    };
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};
