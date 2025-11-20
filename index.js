// index.js — Discord Chat Viewer Full Version
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

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageReactions
  ]
});

// Format timestamp
function formatTime(date) {
  try {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return 'Invalid Date';
  }
}

// Escape HTML including backticks
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
    .replace(/`/g,'&#96;');
}

// Deterministic bubble color per user
function getUserBubbleColor(userId, avatarUrl) {
  const str = userId + '|' + avatarUrl;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const r = (hash >> 16) & 0xFF;
  const g = (hash >> 8) & 0xFF;
  const b = hash & 0xFF;
  const clamp = v => Math.max(60, Math.min(220, v));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

// Delete message
app.post('/delete', async (req, res) => {
  const messageId = req.body.messageId;
  if (!messageId) return res.status(400).send('messageId required');
  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) return res.send('❌ Invalid CHANNEL_ID');
    try {
      await channel.messages.delete(messageId);
      res.redirect('back');
    } catch (err) {
      res.send(`<p>Cannot delete message: ${escapeHtml(err.message)}</p>`);
    }
  } catch (err) {
    console.error('Delete error', err);
    res.send(`<p>Error deleting message: ${escapeHtml(err.message)}</p>`);
  }
});

// Add/remove reaction
app.post('/react', async (req, res) => {
  const { messageId, emoji } = req.body;
  if (!messageId || !emoji) return res.status(400).send('Missing messageId or emoji');

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(400).send('Invalid channel');

    const message = await channel.messages.fetch(messageId);
    if (!message) return res.status(404).send('Message not found');

    const existing = message.reactions.cache.get(emoji);
    if (existing && existing.me) {
      await existing.users.remove(client.user.id);
    } else {
      await message.react(emoji);
    }

    res.redirect('back');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Render a single message
async function renderMessageBlock(msg) {
  try {
    const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 128 }) || '';
    const bubbleColor = getUserBubbleColor(msg.author.id, avatar);
    const grad = `linear-gradient(135deg, ${bubbleColor}CC, rgba(0,0,0,0.55))`;
    const authorName = escapeHtml(msg.author.username || 'Unknown');

    // Highest role & emoji
    let roleEmoji = '⬤';
    let roleColor = '#ffffff';
    try {
      const member = msg.member || await msg.guild.members.fetch(msg.author.id);
      if (member && member.roles && member.roles.highest) {
        roleColor = member.roles.highest.hexColor || '#ffffff';
        if (roleColor === '#000000') roleColor = '#ffffff';
        const emojiMap = { "Owner":"👑", "Admin":"⭐", "Moderator":"🔹" };
        roleEmoji = emojiMap[member.roles.highest.name] || '⬤';
      }
    } catch {}

    const isReply = msg.reference && msg.reference.messageId;
    const indentPx = isReply ? 50 : 0;
    const replyClass = isReply ? 'reply' : '';

    let replyPreview = '';
    if (isReply) {
      try {
        const parentMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        if (parentMsg) {
          const preview = escapeHtml(parentMsg.content || '[Embed/Attachment]');
          const parentAvatar = parentMsg.author.displayAvatarURL({ extension:'png', size:32 });
          replyPreview = `<div class="reply-preview"><img src="${parentAvatar}" />↪ ${preview}</div>`;
        }
      } catch {}
    }

    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.size > 0) {
      msg.attachments.forEach(att => {
        const contentType = att.contentType || '';
        if (contentType.startsWith && contentType.startsWith('image')) {
          attachmentsHtml += `<img class="inline-img" src="${att.url}" title="${escapeHtml(att.name || '')}" />`;
        } else {
          attachmentsHtml += `<div><a href="${att.url}" target="_blank" data-preview="File: ${escapeHtml(att.name || '')}">${escapeHtml(att.name || 'Attachment')}</a></div>`;
        }
      });
    }

    // Reactions
    let reactionsHtml = '';
    if (msg.reactions.cache.size > 0) {
      reactionsHtml = '<div class="reactions">';
      msg.reactions.cache.forEach(r => {
        reactionsHtml += `<span class="reaction" data-message-id="${msg.id}" data-emoji="${escapeHtml(r.emoji.name)}">${escapeHtml(r.emoji.name)} ${r.count}</span>`;
      });
      reactionsHtml += '</div>';
    }

    const contentEscaped = escapeHtml(msg.content || '');

    return `
      <div class="message ${replyClass}" data-id="${msg.id}" style="margin-left:${indentPx}px">
        <img class="avatar" src="${avatar}" alt="avatar"/>
        <div>
          <div class="bubble" style="background:${grad}">
            ${replyPreview}
            <div class="meta">
              <b style="color:${roleColor}">${authorName}</b> ${roleEmoji} • ${formatTime(msg.createdAt)}
            </div>
            <div class="text">${contentEscaped}</div>
            ${attachmentsHtml}
            ${reactionsHtml}
          </div>
        </div>
        <form method="POST" action="/delete" class="delete-form">
          <input type="hidden" name="messageId" value="${msg.id}" />
          <button class="delete-btn" type="submit">Delete</button>
        </form>
      </div>
    `;
  } catch { return ''; }
}

// Main page
app.get('/', async (req, res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(()=>null);
    if (!channel) return res.send("❌ Invalid CHANNEL_ID");

    const searchRaw = req.query.search || '';
    const search = String(searchRaw).trim().toLowerCase();

    const fetched = await channel.messages.fetch({ limit: 50 }).catch(()=>[]);
    let messages = Array.from(fetched.values()).reverse();
    if (search) messages = messages.filter(m => (m.content || '').toLowerCase().includes(search));

    // Safe join of message blocks
    const blocks = await Promise.all(messages.map(async m => String(await renderMessageBlock(m))));

    const oldestId = messages.length > 0 ? messages[0].id : '';

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
.reactions{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;}
.reaction{background:#333;padding:2px 6px;border-radius:12px;cursor:pointer;font-size:12px;}
.reply-preview{font-size:12px;opacity:0.7;margin-bottom:4px;display:flex;align-items:center;gap:4px;}
.reply-preview img{width:20px;height:20px;border-radius:50%;}
</style>
</head>
<body data-oldest="${oldestId}">
<h1>Discord Chat Viewer</h1>
<button onclick="downloadChat()">Download TXT</button>
<button onclick="toggleTheme()">Toggle Theme</button>
<form method="GET" class="search-bar">
<input name="search" placeholder="Search messages..." value="${escapeHtml(searchRaw)}"/>
<button type="submit">Search</button>
</form>
<div id="chat">
${blocks.join('')}
</div>
<script>
function toggleTheme(){if(document.body.style.background==='white'){document.body.style.background='#1e1e1e';document.body.style.color='white';}else{document.body.style.background='white';document.body.style.color='black';}}
function downloadChat(){const text=Array.from(document.querySelectorAll('.message .bubble .text')).map(el=>el.innerText).join('\\n');const blob=new Blob([text],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chat.txt';a.click();URL.revokeObjectURL(a.href);}
document.addEventListener('click',async e=>{if(e.target.classList.contains('reaction')){const messageId=e.target.dataset.messageId;const emoji=e.target.dataset.emoji;fetch('/react',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`messageId=${encodeURIComponent(messageId)}&emoji=${encodeURIComponent(emoji)}`}).then(()=>location.reload());}});
let loading=false;window.addEventListener('scroll',async ()=>{if(loading) return;if(window.scrollY+window.innerHeight>=document.body.scrollHeight-100){loading=true;const oldest=document.querySelector('#chat .message')?.dataset.id;if(!oldest) return;const res=await fetch(`/messages?before=${oldest}`);const data=await res.json();const container=document.getElementById('chat');const div=document.createElement('div');div.innerHTML=data.blocks.join('');container.prepend(div);loading=false;}});
window.onload=()=>{window.scrollTo(0,document.body.scrollHeight);};
</script>
</body>
</html>
    `);
  } catch (err) {
    res.send(`<p>Error: ${escapeHtml(err.message)}</p>`);
  }
});

// Messages API for infinite scroll
app.get('/messages', async (req, res) => {
  const beforeId = req.query.before;
  const afterId = req.query.after;
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(400).send('Invalid channel');

    const options = { limit: 50 };
    if (beforeId) options.before = beforeId;
    if (afterId) options.after = afterId;

    const fetched = await channel.messages.fetch(options);
    const messages = Array.from(fetched.values()).reverse();
    const blocks = await Promise.all(messages.map(m => renderMessageBlock(m)));

    const newestId = messages.length > 0 ? messages[messages.length-1].id : null;
    const oldestId = messages.length > 0 ? messages[0].id : null;

    res.json({ blocks, newestId, oldestId, latestId: newestId });
  } catch (err) { res.status(500).send({ error: err.message }); }
});

// Download chat TXT
app.get('/download', async (req,res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.status(400).send('Invalid channel');

    let allMessages=[], lastId;
    while(true){
      const opts={limit:100};
      if(lastId)opts.before=lastId;
      const fetched=await channel.messages.fetch(opts);
      if(fetched.size===0)break;
      allMessages.push(...fetched.values());
      lastId=fetched.last().id;
    }
    allMessages.reverse();
    const txt = allMessages.map(m=>`[${formatTime(m.createdAt)}] ${m.author.username}: ${m.content.replace(/\n/g,' ')}`).join('\n');
    res.setHeader('Content-Disposition','attachment; filename="chat.txt"');
    res.setHeader('Content-Type','text/plain');
    res.send(txt);
  } catch(err){res.status(500).send('Error: '+err.message);}
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));

// Discord login
client.login(TOKEN).catch(err=>{console.error('Discord login failed:',err); process.exit(1);});
