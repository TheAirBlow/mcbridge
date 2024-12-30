import { Client, GatewayIntentBits, SlashCommandBuilder, ActivityType, cleanContent } from 'discord.js';
import config from './config.json' with { type: "json" };
import forge from 'minecraft-protocol-forge';
import { format } from "mc-chat-format";
import mc from "minecraftstatuspinger";
import mineflayer from 'mineflayer';
import process from 'process';

const discordClient = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
let channel;
discordClient.once('ready', async () => {
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);
    channel = await discordClient.channels.fetch(config.channel);
    let guild = await discordClient.guilds.fetch(config.guild);
    await guild.commands.set([
        new SlashCommandBuilder()
            .setName('online')
            .setDescription('Lists currently online players'),
        new SlashCommandBuilder()
            .setName('command')
            .setDescription('Sends a command to the Minecraft bot')
            .addStringOption(option =>
                option.setName('command')
                    .setDescription('Command to send to the Minecraft bot')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('terminator')
            .setDescription('Toggles terminator mode')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('True to enable')
                    .setRequired(true))
    ]);
    
    setInterval(function() {
        if (players) {
            if (players.length === 0) {
                discordClient.user.setActivity(`an empty server`, { type: ActivityType.Watching });
            } else {
                discordClient.user.setActivity(`${players.length} players`, { type: ActivityType.Watching });
            }
        } else {
            discordClient.user.setActivity(`an empty server`, { type: ActivityType.Watching });
        }
    }, 10000);
});

discordClient.on('messageCreate', async message => {
    if (message.channel.id === config.channel && !message.author.bot) {
        let cleaned = cleanContent(message.content, message.channel).replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ':$1:');
        let attachments = message.attachments.map(attachment => `[${attachment.name}]`).join(' ');
        if (attachments) cleaned += ` ${attachments}`;
        bot?.chat(`/say <${message.author.username}> ${cleaned}`);
    }
});

let killaura = false;
discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    const { commandName } = interaction;
    if (commandName === 'online') {
        if (players) {
            if (players.length === 0) {
                await interaction.reply('No players are currently online.');
            } else {
                await interaction.reply(`Currently online players: ${players.join(', ')}`);
            }
        } else {
            await interaction.reply('The bot is currently not connected to the server.');
        }
    } else if (commandName === 'command') {
        if (bot) {
            const command = interaction.options.getString('command');
            if (interaction.member.roles.cache.some(role => role.id === config.role)) {
                bot?.chat(command);
                await interaction.reply(`Successfully sent command \`${command}\``);
            } else {
                await interaction.reply(`You don't have the <@&${config.role}>`);
            }
        } else {
            await interaction.reply('The bot is currently not connected to the server.');
        }
    } else if (commandName === 'terminator') {
        if (bot) {
            killaura = interaction.options.getBool('enabled');
            await interaction.reply(killaura
                ? "The terminator shall expunge every player on spawn"
                : "The bot has been downgraded to a noob"
            );
        } else {
            await interaction.reply('The bot is currently not connected to the server.');
        }
    }
});

let bot;
let spawned;
let players;
function createBot() {
    spawned = false;
    players = [];

    channel?.send(`<:despair:1138855750106632413> Connecting to \`${config.host}\``);
    bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        auth: 'microsoft',
        physicsEnabled: false
    });

    if (config.modded) forge.autoVersionForge(bot._client);

    bot.on('playerJoined', (player) => {
        players.push(player.username);
        if (spawned) channel?.send(`<:Clueless:1268276497727098910> ${player.username} joined the game`);
    });

    bot.on('playerLeft', (player) => {
        players = players.filter(username => username != player.username);
        if (spawned) channel?.send(`<:pointandlaugh:1138432278003974185> ${player.username} left the game`);
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        channel?.send(`*${username}*: ${message}`);
    });

    bot.on('kicked', (reason) => {
        reason = reason.startsWith("{") ? format(JSON.parse(reason)) : reason;
        channel?.send(`<:TrollShrug:1256731287310569563> Bot got kicked: ${reason}`);
        console.error(`Bot was kicked: ${reason}`);
        reconnect();
    });

    bot.on('end', () => {
        channel?.send(`<:awooga:1138432126820286496> The bot got disconnected`);
        bot = spawned = players = undefined;
        reconnect();
    });

    bot.on('whisper', (username, message) => {
        channel?.send(`*${username} whispered to me*: ${message}`);
    });

    bot.once('spawn', () => {
        channel?.send(`<:letsgoo:1138432150304210996> Successfully joined the server`);
        console.log("Successfully joined!")
        spawned = true;
    })

    bot.once('error', (error) => {
        channel?.send(`<:pointandlaugh:1138432278003974185> The bot crashed: \`${error.message}\``);
        console.error("Bot crashed:", error);
        bot.end(error.message);
        bot = spawned = players = undefined;
    })

    bot.on('death', () => {
        setTimeout(() => {
            bot?.respawn();
        }, 1000);
    });

    bot.on('message', (component) => {
        let json = component.json;
        if (json.translate && json.translate.startsWith("death.")) {
            channel?.send(`⚔️ ${format(json)}`);
        }

        if (json.translate === "playerrevive.chat.bleeding") {
            channel?.send(`🩸 ${format(json, { translation: { "playerrevive.chat.bleeding": "%s is bleeding" } })}`);
        }
    });

    let lastAttackTime = 0;
    bot.on('entityMoved', (entity) => {
        if (entity.type === 'player') {
            const nearestPlayer = bot.nearestEntity(e => e.type === 'player');
            if (nearestPlayer) {
                bot.lookAt(nearestPlayer.position.offset(0, nearestPlayer.height, 0), true);
                if (killaura) {
                    const distance = bot.entity.position.distanceTo(nearestPlayer.position);
                    const currentTime = Date.now();
                    if (distance <= 4 && currentTime - lastAttackTime >= 500) {
                        bot.attack(nearestPlayer);
                        lastAttackTime = currentTime;
                    }
                }
            }
        }
    });
}

async function reconnect() {
    try {
        const response = await mc.lookup({ host: config.host, port: config.port })
        if (response.status.players.online > 0) {
            console.log(`Connecting to ${config.host}:${config.port}`);
            createBot();
        } else {
            console.log('No players online. Retrying in 10 seconds...');
            setTimeout(reconnect, 10000);
        }
    } catch (error) {
        console.error('Server status check failed!', error);
        setTimeout(reconnect, 10000);
    }
}

process.on('SIGINT', async function() {
    await channel?.send(`<:awooga:1138432126820286496> TheAirBlow took down the bot`);
    process.exit();
});

(async () => {
    try {
        await discordClient.login(config.token);
        await reconnect();
    } catch (error) {
        console.error('Initialization error:', error);
    }
})();
