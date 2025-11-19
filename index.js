const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const ColorThief = require('colorthief');
const axios = require('axios');
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

// Parse form data
app.use(bodyParser.urlencoded({ extended: true }));

function formatTime(date) {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Extract dominant color from avatar
async function getAvatarColor(url) {
  try {
    const response = await axios({
      url,
      responseType: 'arraybuffer'
    });

    const buffer = Buffer.from(response.data, 'binary');

    const [r, g, b] = await ColorThief.getColor(buffer);
    return `rgb(${r}, ${g}, ${b})`;
  } catch (err) {
    return "rgb(80,80,80)";
  }
}

// Delete message
app.post('/delete', async (req, res) => {
  const messageId = req.body.messageId;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.messages.delete(messageId);
    res.redirect('/');
  } catch (err) {
    res.send(`<p>Error deleting: ${err.message}</p>`);
  }
});

// Render chat log
app.get('/', async (req, res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    let messages = [];
    let lastId;

    while (true) {
      const opts = { limit: 100 };
      if (lastId) opts.before = lastId;

      const fetched = await channel.messages.fetch(opts);
      if (fetched.size === 0) break;

      for (const msg of fetched.values()) {
        messages.push(msg);
      }

      lastId = fetched.last().id;
    }

    messages.reverse();

    let html = `
    <html>
    <head>
      <title>Discord Chat</title>
      <meta http-equiv="refresh" content="10">
      <style>
        body { font-family: Arial; background: #111; padding: 20px; color: white; }
        .message { display: flex; margin-bottom: 12px; align-items: start; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; }
        .bubble {
          padding: 10px 14px;
          border-radius: 12px;
          max-width: 70%;
          color: white;
          font-size: 15px;
        }
        .meta { font-size: 12px; color: #ddd; margin-bottom: 4px; }
        .delete-btn {
          margin-left: 10px;
          background: red;
          color: white;
          border: none;
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <h1>Discord Chat Log</h1>
    `;

    for (const msg of messages) {
      const avatar = msg.author.displayAvatarURL({ extension: "png", size: 128 });

      // Get color
      const color = await getAvatarColor(avatar);

      html += `
      <div class="message">
        <img class="avatar" src="${avatar}">
        <div>
          <div class="bubble" style="background:${color}">
            <div class="meta">
              <b>${msg.author.username}</b> • ${formatTime(msg.createdAt)}
            </div>
            <div>${msg.content}</div>
          </div>
        </div>

        <form method="POST" action="/delete">
          <input type="hidden" name="messageId" value="${msg.id}">
          <button class="delete-btn">Delete</button>
        </form>
      </div>
      `;
    }

    html += "</body></html>";
    res.send(html);

  } catch (err) {
    res.send(`<p>Error: ${err.message}</p>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));

client.login(TOKEN);
