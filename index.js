const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const app = express();

const TOKEN = process.env.TOKEN;
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

// Function to format timestamps nicely
function formatTime(date) {
    return date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Web server to render chat
app.get('/', async (req, res) => {
    try {
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
                avatar: msg.author.displayAvatarURL({ dynamic: true, size: 32 }),
                content: msg.content,
                timestamp: msg.createdAt
            })));

            lastId = fetched.last().id;
        }

        // Reverse to show oldest first
        messages.reverse();

        // Build HTML
        let html = `
        <html>
        <head>
        <title>Discord Chat Log</title>
        <style>
            body { font-family: Arial, sans-serif; background: #111; color: #fff; padding: 20px; }
            .message { display: flex; align-items: center; margin-bottom: 10px; }
            .avatar { width: 32px; height: 32px; border-radius: 50%; margin-right: 10px; }
            .content { background: #222; padding: 8px 12px; border-radius: 8px; }
            .author { font-weight: bold; margin-right: 5px; }
            .timestamp { color: #888; font-size: 0.8em; margin-left: 5px; }
        </style>
        <meta http-equiv="refresh" content="10">
        </head>
        <body>
        <h1>Discord Chat Log</h1>
        `;

        messages.forEach(msg => {
            html += `
            <div class="message">
                <img class="avatar" src="${msg.avatar}" />
                <div class="content">
                    <span class="author">${msg.author}</span>
                    <span class="timestamp">[${formatTime(msg.timestamp)}]</span>
                    <div>${msg.content}</div>
                </div>
            </div>
            `;
        });

        html += `</body></html>`;
        res.send(html);
    } catch (err) {
        res.send(`<p>Error fetching channel: ${err.message}</p>`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

client.login(TOKEN);
