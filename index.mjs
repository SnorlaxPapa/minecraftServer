import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { verifyKey } from 'discord-interactions';

const lambdaClient = new LambdaClient({ region: "us-east-2" });
const ROUTED_FUNC = process.env.internalName;

export const handler = async (event) => {
  //handle discord request, route to internal handler, then return;
  const valid = await verifyDiscord(event);
  if (!valid){
    return { statusCode: 401 };
  }
  const body = JSON.parse(event.body);

  // Handle Discord's "Save Changes" PING test (type 1)
  if (body.type === 1) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 1 }),
    };
  }

  //create payload & invoke asynchronous lambda function
  const payload = {
    action: body?.data?.name,
    applicationId: body.application_id,
    interactionToken: body.token,
  }

  const command = new InvokeCommand({
    FunctionName: ROUTED_FUNC,
    InvocationType: "Event",
    Payload: JSON.stringify(payload)
  })

  await lambdaClient.send(command);
  return {
    statusCode: 200,
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ type: 5 }),
  }
}


async function verifyDiscord(event){
  return await verifyKey(
    event.body,
    event.headers['x-signature-ed25519'],
    event.headers['x-signature-timestamp'],
    process.env.PUBLIC_KEY
  );
}

