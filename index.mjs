import { EC2Client, StartInstancesCommand, DescribeInstanceStatusCommand, StopInstancesCommand, DescribeInstancesCommand } from "@aws-sdk/client-ec2"; 
import { SSMClient, GetCommandInvocationCommand, SendCommandCommand } from "@aws-sdk/client-ssm";
import { verifyKey } from 'discord-interactions';

const ec2Client = new EC2Client({ region: "us-east-2" });
const ssmClient = new SSMClient({ region: "us-east-2" });

const INSTANCE_ID = process.env.INSTANCE_ID;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOKEN = process.env.DUCKDNS_TOKEN;
const DOMAIN_NAME = process.env.DOMAIN_NAME;


export const handler = async (event) => {
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

  const action = body.data?.name;

  try{
      if (action === "start"){
        await startServer();
        await waitEC2Start();
        await updateIP();
        await waitMinecraftStart();
      }

      else if (action === "stop"){
        await stopPaperMC();
        await stopServer();
      }
      else{
        throw new Error("Invalid action");
      }
      return {
          statusCode: 200,
      };
  }
  catch(error){
      if (error.message == "Invalid action"){
          return {statusCode: 400};
      }
      return {
        statusCode: 500,
        body: JSON.stringify({
          "error": error.message
        })
      };
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


async function startServer(){
  const input = {
    InstanceIds: [INSTANCE_ID],
    DryRun: false
  };
  
  const command = new StartInstancesCommand(input);
  await ec2Client.send(command);
}

async function waitEC2Start() {
    const command = new DescribeInstanceStatusCommand({
        InstanceIds: [INSTANCE_ID],
        IncludeAllInstances: true,
    });

    const deadline = Date.now() + 90000;

    while (Date.now() < deadline) {
        const data = await ec2Client.send(command);
        const status = data.InstanceStatuses?.[0];

        if (status?.InstanceState?.Name === "running") {
            return;
        }

        await sleep(2000);
    }

    throw new Error("EC2 did not reach running before the deadline");
}


async function waitMinecraftStart(){
  //define command
  const command = new SendCommandCommand({
    InstanceIds: [INSTANCE_ID],
    DocumentName: "AWS-RunShellScript",
    Parameters: {
      commands: ["sudo journalctl -u minecraft -b --no-pager"]
    }
  });

  const deadline = Date.now() + 60000;

  while (Date.now() < deadline){
    //we continuously try to send our command until the server is up and the agent is able to accept commands
    let response;
    try {
      response = await ssmClient.send(command);
    } 
    catch (error) {
      if (error.name !== "InvalidInstanceId") throw new Error(error.message);
      await sleep(2000);
      continue;
    }

    let id = response.Command.CommandId;
    let outputCommand = new GetCommandInvocationCommand({
      CommandId: id, 
      InstanceId: INSTANCE_ID,                 
    });

    //inner loop to check if paperMC has successfully booted up
    let deadlineSuccess = Date.now() + 10000;
    let output;
    while (Date.now() < deadlineSuccess){
      try {
        output = await ssmClient.send(outputCommand);
      } 
      catch (error) {
        if (error.name !== "InvocationDoesNotExist") throw new Error(error.message);
  
        await sleep(200);
        continue;
      }

      if (output?.Status == "Success") break;
      await sleep(200);
    }
    if (output?.Status != "Success"){
      throw new Error(
        `SSM status: ${output?.Status}; stderr: ${output?.StandardErrorContent}`
      );
    }

    if (output?.StandardOutputContent?.includes('For help, type "help"')){
      return;
    }

    await sleep(5000);
  }

  throw new Error("PaperMC server did not reach start before the deadline");
}


async function stopPaperMC(){
  // we send a reques to first stop paperMC as a service
  const command = new SendCommandCommand({
    InstanceIds: [INSTANCE_ID],
    DocumentName: "AWS-RunShellScript",
    Parameters: {
      commands: ["sudo systemctl stop minecraft"]
    }
  });

  const data = await ssmClient.send(command);
  const id = data.Command.CommandId;

  //then we continuously check if paperMC is done shutting down
  const outputRequest = new GetCommandInvocationCommand({
    CommandId: id, 
    InstanceId: INSTANCE_ID,                 
  });

  const deadline = Date.now() + 60000;
  let output;
  while (Date.now() < deadline){
    try {
      output = await ssmClient.send(outputRequest);
    } 
    catch (error) {
      if (error.name !== "InvocationDoesNotExist") throw new Error(error.message);
  
      await sleep(200);
      continue;
    }

    if (output?.Status === "Success") return;
    
    await sleep(1000);
  }

  throw new Error ("Unable to shut down in time");
}

async function stopServer(){
  const command = new StopInstancesCommand({
    InstanceIds: [INSTANCE_ID],
  });

  await ec2Client.send(command);
  return;
}


async function getIP() {
  const response = await ec2Client.send(
    new DescribeInstancesCommand({
      InstanceIds: [INSTANCE_ID],
    })
  );

  const ip = response.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;

  if (!ip) {
    throw new Error("Instance has no public IPv4 address yet");
  }

  return ip;
}

async function updateIP(){
  const ipv4 = await getIP();
  const response = await fetch(`https://www.duckdns.org/update?domains=${DOMAIN_NAME}&token=${TOKEN}&ip=${ipv4}`);
  
  const result = (await response.text()).trim();
  if (!response.ok || result != "OK") {
    throw new Error(`There's an issue with DNS resolution, response: ${result} :)`);
  }
}