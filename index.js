// index.js — Discord Chat Viewer with Deleted Messages
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!TOKEN || !CHANNEL_ID) {
  console.error('Please set TOKEN and CHANNEL_ID environment variables.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageReactions
  ]
});

// Store deleted messages
const deletedMessages = new Map();

// Escape HTML
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

// Format timestamps
function formatTime(date) {
  try {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return 'Invalid Date';
  }
}

// Deterministic bubble color per user
function getUserBubbleColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash &= hash;
  }
  const r = Math.max(60, Math.min(220, (hash >> 16) & 0xff));
  const g = Math.max(60, Math.min(220, (hash >> 8) & 0xff));
  const b = Math.max(60, Math.min(220, hash & 0xff));
  return `rgb(${r},${g},${b})`;
}

// Track deleted messages
client.on('messageDelete', async (msg) => {
  if (!msg.partial) {
    deletedMessages.set(msg.id, {
      author: msg.author.tag,
      content: msg.content || '',
      timestamp: msg.createdAt,
      attachments: Array.from(msg.attachments.values()).map(a => a.url),
      id: msg.id
    });
    console.log(`Deleted message stored: ${msg.author.tag} • ${msg.content}`);
  }
});

// Delete message via web
app.post('/delete', async (req, res) => {
  const messageId = req.body.messageId;
  if (!messageId) return res.status(400).send('messageId required');
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.messages.delete(messageId);
    res.redirect('back');
  } catch (err) {
    res.send(`<p>Error deleting: ${escapeHtml(err.message)}</p>`);
  }
});

// React to message via web
app.post('/react', async (req, res) => {
  const { messageId, emoji } = req.body;
  if (!messageId || !emoji) return res.status(400).send('Missing messageId or emoji');

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const message = await channel.messages.fetch(messageId);
    const existing = message.reactions.cache.get(emoji);
    if (existing && existing.me) {
      await existing.users.remove(client.user.id);
    } else {
      await message.react(emoji);
    }
    res.redirect('back');
  } catch (err) {
    res.status(500).send(escapeHtml(err.message));
  }
});

// Render a single message
async function renderMessageBlock(msg, isDeleted = false) {
  try {
    const avatar = msg.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) || '';
    const bubbleColor = isDeleted ? 'rgb(100,100,100)' : getUserBubbleColor(msg.author?.id || msg.author);
    const grad = `linear-gradient(135deg, ${bubbleColor}CC, rgba(0,0,0,0.55))`;
    const authorName = escapeHtml(msg.author?.username || msg.author || 'Unknown');

    // Role emoji
    let roleEmoji = '⬤';
    let roleColor = '#ffffff';
    if (!isDeleted) {
      try {
        const member = msg.member || await msg.guild.members.fetch(msg.author.id);
        if (member && member.roles && member.roles.highest) {
          roleColor = member.roles.highest.hexColor || '#ffffff';
          if (roleColor === '#000000') roleColor = '#ffffff';
          const emojiMap = { "Owner":"👑", "Admin":"⭐", "Moderator":"🔹" };
          roleEmoji = emojiMap[member.roles.highest.name] || '⬤';
        }
      } catch {}
    }

    // Attachments
    let attachmentsHtml = '';
    if (!isDeleted && msg.attachments?.length) {
      msg.attachments.forEach(url => {
        attachmentsHtml += `<img class="inline-img" src="${url}" />`;
      });
    }

    const contentEscaped = escapeHtml(msg.content || '');
    const deletedTag = isDeleted ? `<i style="opacity:0.6;">[deleted]</i> ` : '';
    const indentPx = msg.reference?.messageId ? 50 : 0;

    return `<div class="message" data-id="${msg.id}" style="margin-left:${indentPx}px">
      <img class="avatar" src="${avatar}" />
      <div>
        <div class="bubble" style="background:${grad}">
          <div class="meta">
            <b style="color:${roleColor}">${authorName}</b> ${roleEmoji} • ${formatTime(msg.createdAt)}
          </div>
          <div class="text">${deletedTag}${contentEscaped}</div>
          ${attachmentsHtml}
        </div>
      </div>
      ${!isDeleted ? `<form method="POST" action="/delete">
        <input type="hidden" name="messageId" value="${msg.id}" />
        <button class="delete-btn" type="submit">Delete</button>
      </form>` : ''}
    </div>`;
  } catch {
    return '';
  }
}

// Main page
app.get('/', async (req, res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    let messages = Array.from((await channel.messages.fetch({ limit: 50 })).values()).reverse();

    // Add deleted messages that aren’t in the current fetch
    deletedMessages.forEach((msg) => {
      if (!messages.find(m => m.id === msg.id)) {
        messages.push({ ...msg, isDeleted: true });
      }
    });

    const blocks = await Promise.all(messages.map(m => renderMessageBlock(m, m.isDeleted)));

    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Discord Chat Viewer</title>
<meta http-equiv="refresh" content="10">
<style>
body{font-family:'Segoe UI',Arial,sans-serif;background:#1e1e1e;color:white;margin:0;padding:20px;}
h1{margin-bottom:10px;}
#chat{display:flex;flex-direction:column;gap:12px;}
.message{display:flex;align-items:flex-start;transition:transform 0.15s;}
.message:hover{transform:scale(1.02);}
.avatar{width:42px;height:42px;border-radius:50%;margin-right:10px;flex-shrink:0;}
.bubble{padding:10px 14px;border-radius:16px;max-width:70%;font-size:14px;line-height:1.4;position:relative;word-wrap:break-word;color:white;}
.meta{font-size:12px;margin-bottom:4px;opacity:0.85;}
.delete-btn{margin-left:10px;background:#ff4c4c;color:white;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px;}
.inline-img{max-width:300px;margin-top:6px;border-radius:10px;}
</style>
</head>
<body>
<h1>Discord Chat Viewer</h1>
<button onclick="downloadChat()">Download TXT</button>
<form method="GET" class="search-bar">
<input name="search" placeholder="Search messages..." />
<button type="submit">Search</button>
</form>
<div id="chat">
${blocks.join('')}
</div>
<script>
function downloadChat(){
  const text=Array.from(document.querySelectorAll('.message .bubble .text')).map(el=>el.innerText).join('\\n');
  const blob=new Blob([text],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chat.txt';a.click();URL.revokeObjectURL(a.href);
}
window.onload=()=>{window.scrollTo(0,document.body.scrollHeight);}
</script>
</body>
</html>
    `);
  } catch (err) {
    res.send(`<p>Error: ${escapeHtml(err.message)}</p>`);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));

client.login(TOKEN).catch(err => { console.error('Discord login failed:', err); process.exit(1); });
