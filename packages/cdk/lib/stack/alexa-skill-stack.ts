import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import { LambdaToDynamoDB } from "@aws-solutions-constructs/aws-lambda-dynamodb";
import { Construct } from "constructs";

export interface AlexaSkillProps extends cdk.StackProps {
  alexaClientId: string;
  alexaClientSecret: string;
  alexaSkillId: string;
}

export class AlexaSkillStack extends cdk.Stack {
  public readonly skillLambdaArn: string;

  constructor(scope: Construct, id: string, props: AlexaSkillProps) {
    super(scope, id, props);

    const { alexaClientId, alexaClientSecret, alexaSkillId } = props;

    const lambdaToDynamoDB = new LambdaToDynamoDB(this, "AlexaSkill", {
      lambdaFunctionProps: {
        functionName: "AlexaSkillFunction",
        code: lambda.Code.fromAsset("lambda/skill"),
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        timeout: cdk.Duration.seconds(30),
        environment: {
          ALEXA_CLIENT_ID: alexaClientId,
          ALEXA_CLIENT_SECRET: alexaClientSecret,
        },
      },
      dynamoTableProps: {
        partitionKey: {
          name: "userId",
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    });

    lambdaToDynamoDB.lambdaFunction.addPermission("AlexaPermission", {
      principal: new iam.ServicePrincipal("alexa-connectedhome.amazon.com"),
      eventSourceToken: alexaSkillId,
    });

    this.skillLambdaArn = lambdaToDynamoDB.lambdaFunction.functionArn;
  }
}
