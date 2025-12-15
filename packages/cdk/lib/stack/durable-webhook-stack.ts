import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

export interface DurableWebhookStackProps extends cdk.StackProps {
  skillLambdaArn: string;
}

export class DurableWebhookStack extends cdk.Stack {
  public readonly meetingStateTable: dynamodb.Table;
  public readonly eventBus: events.EventBus;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: DurableWebhookStackProps) {
    super(scope, id, props);

    // DynamoDB テーブル（会議状態管理）
    this.meetingStateTable = new dynamodb.Table(this, "MeetingStateTable", {
      partitionKey: { name: "meetingId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Durable Webhook Lambda
    const durableWebhookLambda = new lambda.Function(
      this,
      "DurableWebhookFunction",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../lambda/durable-webhook")
        ),
        timeout: cdk.Duration.seconds(30),
        environment: {
          SKILL_LAMBDA_ARN: props.skillLambdaArn,
          MEETING_STATE_TABLE_NAME: this.meetingStateTable.tableName,
        },
        durableConfig: {
          executionTimeout: cdk.Duration.minutes(15),
          retentionPeriod: cdk.Duration.days(7),
        },
      }
    );

    // バージョンとエイリアス（Durable Functions必須）
    const version = durableWebhookLambda.currentVersion;
    const alias = new lambda.Alias(this, "DurableWebhookAlias", {
      aliasName: "live",
      version,
    });

    // Skill Lambdaの呼び出し権限
    const skillLambda = lambda.Function.fromFunctionArn(
      this,
      "SkillLambda",
      props.skillLambdaArn
    );
    skillLambda.grantInvoke(durableWebhookLambda);

    // Durable Execution 権限
    // ARNパターンを直接構築
    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // Lambda関数ARN（CheckpointDurableExecution, GetDurableExecutionState用）
    const lambdaArnPattern = `arn:aws:lambda:${region}:${accountId}:function:Dev-DurableWebhookStack-DurableWebhookFunction*`;

    // Durable Execution ARN（SendDurableExecutionCallbackSuccess用）
    // 形式: arn:aws:lambda:region:account:function:functionName:version/durable-execution/executionName/executionId
    const durableExecutionArnPattern = `arn:aws:lambda:${region}:${accountId}:function:Dev-DurableWebhookStack-DurableWebhookFunction*:*/durable-execution/*`;

    durableWebhookLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "lambda:CheckpointDurableExecution",
          "lambda:GetDurableExecutionState",
        ],
        resources: [lambdaArnPattern, `${lambdaArnPattern}:*`],
      })
    );

    durableWebhookLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "lambda:SendDurableExecutionCallbackSuccess",
          "lambda:SendDurableExecutionCallbackFailure",
        ],
        resources: [durableExecutionArnPattern],
      })
    );

    // DynamoDB の読み書き権限
    this.meetingStateTable.grantReadWriteData(durableWebhookLambda);

    // EventBridge バス
    this.eventBus = new events.EventBus(this, "MeetingEventBus", {
      eventBusName: "meeting-events",
    });

    // API Gateway
    this.api = new apigateway.RestApi(this, "MeetingApi", {
      restApiName: "Meeting Webhook API",
      description: "API for meeting webhook events",
    });

    // API Gateway → EventBridge 統合用の IAM Role
    const apiGatewayEventBridgeRole = new iam.Role(
      this,
      "ApiGatewayEventBridgeRole",
      {
        assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      }
    );

    this.eventBus.grantPutEventsTo(apiGatewayEventBridgeRole);

    // API Gateway → EventBridge 統合
    const eventBridgeIntegration = new apigateway.AwsIntegration({
      service: "events",
      action: "PutEvents",
      options: {
        credentialsRole: apiGatewayEventBridgeRole,
        passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
        requestTemplates: {
          "application/json": `
#set($context.requestOverride.header.X-Amz-Target = "AWSEvents.PutEvents")
#set($context.requestOverride.header.Content-Type = "application/x-amz-json-1.1")
{
  "Entries": [
    {
      "Source": "meeting.webhook",
      "DetailType": "MeetingEvent",
      "Detail": "$util.escapeJavaScript($input.body)",
      "EventBusName": "${this.eventBus.eventBusName}"
    }
  ]
}`,
        },
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": `
#set($inputRoot = $input.path('$'))
{
  "eventId": "$inputRoot.Entries[0].EventId",
  "message": "Event accepted"
}`,
            },
          },
          {
            statusCode: "400",
            selectionPattern: "4\\d{2}",
            responseTemplates: {
              "application/json": '{"message": "Bad request"}',
            },
          },
          {
            statusCode: "500",
            selectionPattern: "5\\d{2}",
            responseTemplates: {
              "application/json": '{"message": "Internal server error"}',
            },
          },
        ],
      },
    });

    // /webhook エンドポイント
    const webhookResource = this.api.root.addResource("webhook");
    webhookResource.addMethod("POST", eventBridgeIntegration, {
      requestParameters: {
        "method.request.header.X-Amz-Target": false,
        "method.request.header.Content-Type": false,
      },
      methodResponses: [
        { statusCode: "200" },
        { statusCode: "400" },
        { statusCode: "500" },
      ],
    });

    // EventBridge ルール: Lambda をターゲットに
    new events.Rule(this, "MeetingEventRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["meeting.webhook"],
        detailType: ["MeetingEvent"],
      },
      targets: [new targets.LambdaFunction(alias)],
    });

    new cdk.CfnOutput(this, "DurableLambdaArn", {
      value: alias.functionArn,
      description: "Durable Webhook Lambda ARN (with alias)",
    });

    new cdk.CfnOutput(this, "MeetingStateTableName", {
      value: this.meetingStateTable.tableName,
      description: "Meeting State DynamoDB Table Name",
    });

    new cdk.CfnOutput(this, "EventBusName", {
      value: this.eventBus.eventBusName,
      description: "EventBridge Event Bus Name",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      description: "API Gateway URL",
    });
  }
}
