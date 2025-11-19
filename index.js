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
    const res = await axios({ url, responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data, 'binary');
    const [r, g, b] = await ColorThief.getColor(buffer);
    return { r, g, b, rgb: `rgb(${r},${g},${b})` };
  } catch {
    return { r: 80, g: 80, b: 80, rgb: "rgb(80,80,80)" };
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

      messages.push(...fetched.values());
      lastId = fetched.last().id;
    }

    messages.reverse();

    let searchQuery = req.query.search ? req.query.search.toLowerCase() : "";

    if (searchQuery) {
      messages = messages.filter(m =>
        m.content.toLowerCase().includes(searchQuery)
      );
    }

    let html = `
    <html>
    <head>
      <title>Discord Chat Viewer</title>
      <meta http-equiv="refresh" content="10">
      <style>
        body {
          font-family: Arial, sans-serif;
          background: var(--bg);
          color: var(--text);
          padding: 20px;
          transition: background 0.3s, color 0.3s;
        }

        :root {
          --bg: #111;
          --text: white;
          --bubble-text: white;
        }

        .light {
          --bg: #f2f2f2;
          --text: black;
          --bubble-text: black;
        }

        .message {
          display: flex;
          align-items: flex-start;
          margin-bottom: 14px;
          transition: transform 0.15s;
        }

        .message:hover {
          transform: scale(1.02);
        }

        .avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          margin-right: 10px;
        }

        .bubble {
          padding: 10px 14px;
          border-radius: 14px;
          max-width: 70%;
          color: var(--bubble-text);
          font-size: 15px;
          background: #333;
          background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(0,0,0,0.2));
        }

        .meta {
          font-size: 12px;
          margin-bottom: 4px;
          opacity: 0.8;
        }

        .delete-btn {
          margin-left: 10px;
          background: red;
          color: white;
          border: none;
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
        }

        .search-bar {
          margin-bottom: 20px;
        }

        .theme-btn {
          background: #444;
          color: white;
          padding: 6px 10px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          float: right;
        }

        img.inline-img {
          max-width: 300px;
          border-radius: 10px;
          margin-top: 6px;
        }
      </style>

      <script>
      function toggleTheme() {
        document.body.classList.toggle('light');
      }
      </script>

    </head>
    <body>
      <button class="theme-btn" onclick="toggleTheme()">Toggle Theme</button>
      <h1>Discord Chat Log</h1>

      <form class="search-bar" method="GET">
        <input type="text" name="search" placeholder="Search messages..." style="width:200px;">
        <button type="submit">Search</button>
      </form>
    `;

    for (const msg of messages) {
      const avatar = msg.author.displayAvatarURL({ extension: "png", size: 128 });
      const col = await getAvatarColor(avatar);

      const grad = `linear-gradient(135deg, rgba(${col.r},${col.g},${col.b},0.8), rgba(0,0,0,0.6))`;

      html += `
      <div class="message">
        <img class="avatar" src="${avatar}">
        <div>
          <div class="bubble" style="background:${grad}">
            <div class="meta">
              <b>${msg.author.username}</b> • ${formatTime(msg.createdAt)}
            </div>
            <div>${msg.content || ""}</div>
      `;

      if (msg.attachments.size > 0) {
        msg.attachments.forEach(att => {
          if (att.contentType && att.contentType.startsWith("image")) {
            html += `<img class="inline-img" src="${att.url}">`;
          }
        });
      }

      html += `
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
