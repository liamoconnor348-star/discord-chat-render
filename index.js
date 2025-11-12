const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
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

// Middleware to parse form data
app.use(bodyParser.urlencoded({ extended: true }));

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

// Delete message route
app.post('/delete', async (req, res) => {
  const messageId = req.body.messageId;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.messages.delete(messageId);
    res.redirect('/'); // Refresh the chat page
  } catch (err) {
    res.send(`<p>Error deleting message: ${err.message}</p>`);
  }
});

// Render chat page
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
        id: msg.id,
        author: msg.author.username,
        avatar: msg.author.displayAvatarURL({ dynamic: true, size: 32 }),
        content: msg.content,
        timestamp: msg.createdAt
      })));

      lastId = fetched.last().id;
    }

    messages.reverse();

    let html = `
    <html>
    <head>
    <title>Discord Chat Log</title>
    <style>
      body { font-family: Arial, sans-serif; background: #111; color: #fff; padding: 20px; }
      .message { display: flex; align-items: center; margin-bottom: 10px; }
      .avatar { width: 32px; height: 32px; border-radius: 50%; margin-right: 10px; }
      .content { background: #222; padding: 8px 12px; border-radius: 8px; flex:1; }
      .author { font-weight: bold; margin-right: 5px; }
      .timestamp { color: #888; font-size: 0.8em; margin-left: 5px; }
      .delete-btn { margin-left: 10px; background: red; color: white; border: none; border-radius: 4px; cursor: pointer; }
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
        <form method="POST" action="/delete">
          <input type="hidden" name="messageId" value="${msg.id}" />
          <button class="delete-btn" type="submit">Delete</button>
        </form>
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
