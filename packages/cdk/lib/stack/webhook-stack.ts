import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import { ApiGatewayToLambda } from "@aws-solutions-constructs/aws-apigateway-lambda";

export interface WebhookStackProps extends cdk.StackProps {
  skillLambdaArn: string;
}

export class WebhookStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebhookStackProps) {
    super(scope, id, props);

    const webhookConstruct = new ApiGatewayToLambda(this, "Webhook", {
      lambdaFunctionProps: {
        code: lambda.Code.fromAsset("lambda/webhook"),
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        timeout: cdk.Duration.seconds(30),
        environment: {
          SKILL_LAMBDA_ARN: props.skillLambdaArn,
        },
      },
      apiGatewayProps: {
        proxy: false,
        defaultMethodOptions: {
          authorizationType: apigateway.AuthorizationType.NONE,
        },
      },
    });

    const webhookResource =
      webhookConstruct.apiGateway.root.addResource("webhook");

    webhookResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(webhookConstruct.lambdaFunction)
    );

    const skillLambda = lambda.Function.fromFunctionArn(
      this,
      "SkillLambda",
      props.skillLambdaArn
    );
    skillLambda.grantInvoke(webhookConstruct.lambdaFunction);

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: `${webhookConstruct.apiGateway.url}webhook`,
      description: "Webhook endpoint URL",
    });
  }
}
