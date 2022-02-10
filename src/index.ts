import dotenv from 'dotenv';
import express from 'express';
import Discord from 'discord.js';
import commands from './commands';
import { makeEmbed } from './lib/embed';
import Logger from './lib/logger';

dotenv.config();
const fs = require('fs');
const apm = require('../node_modules/elastic-apm-node').start({
    serviceName: 'discord-bot',
    disableSend: true,
});

export const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

const app = express();
const intents = new Discord.Intents(32767);
const client = new Discord.Client({
    partials: ['USER', 'CHANNEL', 'GUILD_MEMBER', 'MESSAGE', 'REACTION'],
    intents,
});

let healthy = false;

client.on('ready', () => {
    Logger.info(`Logged in as ${client.user.tag}!`);
    healthy = true;
});

client.on('disconnect', () => {
    Logger.warn('Client disconnected');
    healthy = false;
});

client.on('message', async (msg) => {
    const isDm = msg.channel.type === 'DM';
    const guildId = !isDm ? msg.guild.id : 'DM';

    Logger.debug(`Processing message ${msg.id} from user ${msg.author.id} in channel ${msg.channel.id} of server ${guildId}.`);

    if (msg.author.bot === true) {
        Logger.debug('Bailing because message author is a bot.');
        return;
    }

    if (msg.content.startsWith('.')) {
        const transaction = apm.startTransaction('command');
        Logger.debug('Message starts with dot.');

        const usedCommand = msg.content.substring(1, msg.content.includes(' ') ? msg.content.indexOf(' ') : msg.content.length).toLowerCase();
        Logger.info(`Running command '${usedCommand}'`);

        const command = commands[usedCommand];

        if (command) {
            const { executor, name, requiredPermissions } = command;

            const commandsArray = Array.isArray(name) ? name : [name];

            const member = await msg.guild.members.fetch(msg.author);

            if (!requiredPermissions || requiredPermissions.every((permission) => member.permissions.has(permission))) {
                if (commandsArray.includes(usedCommand)) {
                    try {
                        await executor(msg, client);
                        transaction.result = 'success';
                    } catch ({ name, message, stack }) {
                        Logger.error({ name, message, stack });
                        const ErrorEmbed = makeEmbed({
                            color: 'RED',
                            title: 'Error while Executing Command',
                            description: DEBUG_MODE ? `\`\`\`D\n${stack}\`\`\`` : `\`\`\`\n${name}: ${message}\n\`\`\``,
                        });

                        await msg.channel.send({ embeds: [ErrorEmbed] });

                        transaction.result = 'error';
                    }

                    Logger.debug('Command executor done.');
                }
            } else {
                await msg.reply(`you do not have sufficient permissions to use this command. (missing: ${requiredPermissions.join(', ')})`);
            }
        } else {
            Logger.info('Command doesn\'t exist');
            transaction.result = 'error';
        }
        transaction.end();
    }
});

const eventHandlers = fs.readdirSync('./events').filter((file) => file.endsWith('.js'));

for (const handler of eventHandlers) {
    client.on(handler.event, handler.executor);
}

client.login(process.env.BOT_SECRET)
    .then()
    .catch((e) => {
        Logger.error(e);
        process.exit(1);
    });

app.get('/healthz', (req, res) => (healthy ? res.status(200).send('Ready') : res.status(500).send('Not Ready')));
app.listen(3000, () => {
    Logger.info('Server is running at http://localhost:3000');
});

process.on('SIGTERM', () => {
    Logger.info('SIGTERM signal received.');
    client.destroy();
    const server = app.listen(3000);
    server.close(() => {
        Logger.info('Server stopped.');
        process.exit();
    });
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function run(arg0: { serviceName: string; disableSend: boolean; }) {
    throw new Error('Function not implemented.');
}
