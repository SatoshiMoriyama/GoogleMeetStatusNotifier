
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.SKILL_LAMBDA_REGION || 'us-west-2' });
const SKILL_LAMBDA_ARN = process.env.SKILL_LAMBDA_ARN;

export const handler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const status = body.status;
        
        console.log('Received webhook:', { status });
        
        if (!SKILL_LAMBDA_ARN) {
            throw new Error('SKILL_LAMBDA_ARN environment variable is not set');
        }
        
        // Alexa Smart Home Skill Lambdaを呼び出し
        const alexaPayload = {
            source: 'lambda-webhook',
            status: status
        };
        
        const lambdaCommand = new InvokeCommand({
            FunctionName: SKILL_LAMBDA_ARN,
            InvocationType: 'Event',
            Payload: JSON.stringify(alexaPayload)
        });
        
        await lambdaClient.send(lambdaCommand);
        console.log('Alexa notification sent:', { status, arn: SKILL_LAMBDA_ARN });
        
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST,OPTIONS'
            },
            body: JSON.stringify({ message: 'Success' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST,OPTIONS'
            },
            body: JSON.stringify({ error: error.message })
        };
    }
};
