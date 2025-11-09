import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { ApplicationStage } from "../lib/stage/application-stage";

const app = new cdk.App();

const stage = new ApplicationStage(app, "Dev", {
  alexaClientId: process.env.ALEXA_CLIENT_ID || "",
  alexaClientSecret: process.env.ALEXA_CLIENT_SECRET || "",
  alexaSkillId: process.env.ALEXA_SKILL_ID || "",
  env: { region: "ap-northeast-1" },
});

// CDK Nag チェックを適用
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
