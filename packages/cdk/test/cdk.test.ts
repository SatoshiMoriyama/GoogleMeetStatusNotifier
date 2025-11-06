import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ApplicationStage } from "../lib/stage/application-stage";

test("Snapshot Test", () => {
  const app = new cdk.App();
  const stage = new ApplicationStage(app, "Test", {
    alexaClientId: "test-client-id",
    alexaClientSecret: "test-client-secret",
    alexaSkillId: "test-skill-id",
    env: { region: "ap-northeast-1" },
  });

  const assembly = app.synth();
  const stacks = assembly.stacks;

  stacks.forEach((stack) => {
    const template = Template.fromJSON(stack.template);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
