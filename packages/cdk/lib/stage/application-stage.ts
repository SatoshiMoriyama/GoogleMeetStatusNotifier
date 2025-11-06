import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AlexaSkillStack } from "../stack/alexa-skill-stack";
import { WebhookStack } from "../stack/webhook-stack";

export interface ApplicationStageProps extends cdk.StageProps {
  alexaClientId: string;
  alexaClientSecret: string;
  alexaSkillId: string;
}

export class ApplicationStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: ApplicationStageProps) {
    super(scope, id, props);

    const { alexaClientId, alexaClientSecret, alexaSkillId } = props;

    const skillStack = new AlexaSkillStack(this, "AlexaSkillStack", {
      alexaClientId,
      alexaClientSecret,
      alexaSkillId,
      env: { region: "us-west-2" },
    });

    new WebhookStack(this, "WebhookStack", {
      skillLambdaArn: skillStack.skillLambdaArn,
      env: { region: "ap-northeast-1" },
    });
  }
}
