import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import * as path from "path";

export interface DurableWebhookStackProps extends cdk.StackProps {
  skillLambdaArn: string;
}

export class DurableWebhookStack extends cdk.Stack {
  public readonly meetingStateTable: dynamodb.Table;
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
          executionTimeout: cdk.Duration.hours(24),
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

    // API Gateway
    this.api = new apigateway.RestApi(this, "MeetingApi", {
      restApiName: "Meeting Webhook API",
      description: "API for meeting webhook events",
    });

    // API Gateway → Lambda 非同期統合
    const lambdaIntegration = new apigateway.LambdaIntegration(alias, {
      proxy: false,
      integrationResponses: [
        {
          statusCode: "202",
          responseTemplates: {
            "application/json": '{"message": "Request accepted"}',
          },
        },
      ],
      requestTemplates: {
        "application/json": JSON.stringify({
          body: "$util.escapeJavaScript($input.body)",
          headers: "$input.params().header",
        }),
      },
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestParameters: {
        "integration.request.header.X-Amz-Invocation-Type": "'Event'",
      },
    });

    // /webhook エンドポイント
    const webhookResource = this.api.root.addResource("webhook");
    webhookResource.addMethod("POST", lambdaIntegration, {
      methodResponses: [{ statusCode: "202" }],
    });

    new cdk.CfnOutput(this, "DurableLambdaArn", {
      value: alias.functionArn,
      description: "Durable Webhook Lambda ARN (with alias)",
    });

    new cdk.CfnOutput(this, "MeetingStateTableName", {
      value: this.meetingStateTable.tableName,
      description: "Meeting State DynamoDB Table Name",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      description: "API Gateway URL (async invocation)",
    });
  }
}
