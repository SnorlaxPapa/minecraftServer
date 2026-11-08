import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';


const START_COMMAND = {
    name: "start",
    description: "Start minecraft server",
    type: 1,
    integration_types: [0], 
    contexts: [0],
}

const END_COMMAND = {
    name: "stop",
    description: "Stop minecraft server",
    type: 1,
    integration_types: [0], 
    contexts: [0],
}

const ALL_COMMANDS = [START_COMMAND, END_COMMAND];
InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);