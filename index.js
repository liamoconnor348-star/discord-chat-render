const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const app = express();

const TOKEN = process.env.TOKEN;      // We'll set this on Render
const CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

app.get('/', async (req, res) => {
    const channel = await client.channels.fetch(CHANNEL_ID);
    let messages = [];
    let lastId;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;

        messages.push(...fetched.map(msg => ({
            author: msg.author.username,
            content: msg.content,
            timestamp: msg.createdAt
        })));

        lastId = fetched.last().id;
    }

    let html = `<h1>Chat Log</h1><div>`;
    messages.reverse().forEach(msg => {
        html += `<p><strong>${msg.author}</strong> [${msg.timestamp.toLocaleString()}]: ${msg.content}</p>`;
    });
    html += `</div>`;

    res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

client.login(TOKEN);
