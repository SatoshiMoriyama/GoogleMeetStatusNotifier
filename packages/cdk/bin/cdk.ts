import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { ApplicationStage } from "../lib/stage/application-stage";

const app = new cdk.App();

new ApplicationStage(app, "Dev", {
  alexaClientId: process.env.ALEXA_CLIENT_ID || "",
  alexaClientSecret: process.env.ALEXA_CLIENT_SECRET || "",
  alexaSkillId: process.env.ALEXA_SKILL_ID || "",
  env: { region: "ap-northeast-1" },
});
