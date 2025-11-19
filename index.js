// index.js — Full Discord Chat Viewer with role emojis

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
    GatewayIntentBits.MessageContent
  ]
});

// Format timestamps
function formatTime(date) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// Escape HTML
function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Deterministic color generator for avatars
function colorFromString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  const r = (hash & 0xFF0000) >> 16;
  const g = (hash & 0x00FF00) >> 8;
  const b = (hash & 0x0000FF);
  const to255 = v => Math.max(60, Math.min(230, v));
  return { r: to255(r), g: to255(g), b: to255(b), rgb: `rgb(${to255(r)},${to255(g)},${to255(b)})` };
}
const colorCache = new Map();
function getCachedColor(key) {
  if (colorCache.has(key)) return colorCache.get(key);
  const c = colorFromString(key);
  colorCache.set(key, c);
  return c;
}

// Map roles to emojis
const roleEmojiMap = {
  "YourRoleName": "👑", // Replace with your role name
  "Admin": "⭐",
  "Moderator": "🔹",
  "Member": "🔸"
};

// Delete message endpoint
app.post('/delete', async (req, res) => {
  const messageId = req.body.messageId;
  if (!messageId) return res.status(400).send('messageId required');
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.send('❌ Invalid CHANNEL_ID');
    await channel.messages.delete(messageId);
    res.redirect('back');
  } catch (err) {
    console.error('Delete error', err);
    res.send(`<p>Error deleting message: ${escapeHtml(err.message)}</p>`);
  }
});

// Render single message
async function renderMessageBlock(msg) {
  const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 128 }) || '';
  const key = (msg.author.id || '') + '|' + avatar;
  const c = getCachedColor(key);
  const grad = `linear-gradient(135deg, rgba(${c.r},${c.g},${c.b},0.92), rgba(0,0,0,0.55))`;
  const authorName = escapeHtml(msg.author.username || 'Unknown');

  // Highest role & emoji
  let roleColor = '#ffffff';
  let roleEmoji = '';
  try {
    if (msg.member && msg.member.roles && msg.member.roles.highest) {
      const roleName = msg.member.roles.highest.name || '';
      roleColor = msg.member.roles.highest.hexColor || '#ffffff';
      if (roleColor === '#000000') roleColor = '#ffffff';
      roleEmoji = roleEmojiMap[roleName] || '';
    }
  } catch (e) { roleColor = '#ffffff'; roleEmoji = ''; }

  const isMe = msg.author.id === client.user.id;
  const indentPx = (msg.reference && msg.reference.messageId) ? 40 : 0;

  const attachmentsHtml = (() => {
    if (!msg.attachments || msg.attachments.size === 0) return '';
    let out = '';
    msg.attachments.forEach(att => {
      const contentType = att.contentType || '';
      if (contentType.startsWith && contentType.startsWith('image')) {
        out += `<img class="inline-img" src="${att.url}" />`;
      } else {
        out += `<div><a href="${escapeHtml(att.url)}" target="_blank">Attachment</a></div>`;
      }
    });
    return out;
  })();

  const contentEscaped = escapeHtml(msg.content || '');

  return `
  <div class="message ${isMe ? 'me' : ''}" data-id="${msg.id}" style="margin-left:${indentPx}px">
    <img class="avatar" src="${avatar}" alt="avatar"/>
    <div>
      <div class="bubble" style="background:${grad}">
        <div class="meta">
          <b style="color:${roleColor}">${authorName}</b> ${roleEmoji} • ${formatTime(msg.createdAt)}
        </div>
        <div class="text">${contentEscaped}</div>
        ${attachmentsHtml}
      </div>
    </div>
    <form method="POST" action="/delete" class="delete-form">
      <input type="hidden" name="messageId" value="${msg.id}" />
      <button class="delete-btn" type="submit">Delete</button>
    </form>
  </div>
  `;
}

// Main page: newest 50 messages
app.get('/', async (req, res) => {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return res.send("❌ Invalid CHANNEL_ID");

    const searchRaw = req.query.search || '';
    const search = String(searchRaw).trim().toLowerCase();

    const fetched = await channel.messages.fetch({ limit: 50 });
    let messages = Array.from(fetched.values()).reverse();

    if (search) messages = messages.filter(m => (m.content || '').toLowerCase().includes(search));

    let blocks = '';
    for (const m of messages) blocks += await renderMessageBlock(m);

    const oldestId = messages.length > 0 ? messages[0].id : '';

    res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Discord Chat Viewer</title>
<meta http-equiv="refresh" content="10">
<style>
:root{--bg:#111;--text:#fff;--bubble-text:#fff;}
.light{--bg:#f2f2f2;--text:#000;--bubble-text:#000;}
body{margin:0;padding:20px;font-family:Arial;background:var(--bg);color:var(--text);transition:background .2s,color .2s}
header{display:flex;align-items:center;gap:12px}
h1{margin:0;font-size:20px;flex:1}
.controls{display:flex;gap:8px;align-items:center}
.search-bar input{padding:6px;width:220px;border-radius:6px;border:1px solid #444}
.theme-btn,.download-btn{padding:6px 10px;border-radius:6px;border:none;cursor:pointer;background:#444;color:white}
.container{margin-top:16px;max-width:1000px}
.message{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;transition:transform .12s}
.message.me{flex-direction:row-reverse}
.message:hover{transform:scale(1.01)}
.avatar{width:44px;height:44px;border-radius:50%;object-fit:cover}
.bubble{padding:10px 14px;border-radius:14px;max-width:70%;color:var(--bubble-text);box-shadow:0 2px 6px rgba(0,0,0,0.4)}
.me .bubble{box-shadow:0 2px 6px rgba(0,0,0,0.6)}
.meta{font-size:12px;margin-bottom:6px;opacity:0.95}
.text{white-space:pre-wrap;word-break:break-word}
.delete-form{margin-left:12px}
.delete-btn{background:#c44;color:white;border:none;padding:6px 10px;border-radius:6px;cursor:pointer}
.inline-img{max-width:360px;border-radius:10px;margin-top:8px;display:block}
#loader{text-align:center;padding:8px 0;color:#aaa}
</style>
</head>
<body data-oldest="${oldestId}">
<header>
<h1>Discord Chat Viewer</h1>
<div class="controls">
<form class="search-bar" method="GET" style="display:inline;">
<input name="search" placeholder="Search messages..." value="${escapeHtml(searchRaw)}" />
<button type="submit">Search</button>
</form>
<button class="theme-btn" onclick="toggleTheme()">Toggle Theme</button>
<button class="download-btn" onclick="downloadChat()">Download TXT</button>
</div>
</header>
<div class="container" id="chat">
${blocks}
<div id="loader">Scroll to top to load older messages</div>
</div>

<script>
function toggleTheme(){document.body.classList.toggle('light');}
function downloadChat(){
const items=document.querySelectorAll('.message');let lines=[];
items.forEach(it=>{
const meta=it.querySelector('.meta')?it.querySelector('.meta').innerText.trim():'';
const text=it.querySelector('.text')?it.querySelector('.text').innerText.trim():'';
lines.push(meta+'\\n'+text+'\\n');
});
const blob=new Blob([lines.join('\\n')],{type:'text/plain'});
const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='chatlog.txt';link.click();
}

// Infinite scroll
let loading=false;
async function loadOlder(){
if(loading) return;
const oldest=document.body.getAttribute('data-oldest');
if(!oldest) return;
loading=true;
const loader=document.getElementById('loader');
loader.innerText='Loading older messages...';
try{
const res=await fetch('/load?before='+oldest+'&limit=50');
if(!res.ok){loader.innerText='No more messages.';loading=false;return;}
const html=await res.text();
if(!html.trim()){loader.innerText='No more messages.';document.body.removeAttribute('data-oldest');loading=false;return;}
const chat=document.getElementById('chat');
chat.insertAdjacentHTML('afterbegin',html);
const firstMsg=chat.querySelector('.message');
if(firstMsg && firstMsg.dataset.id) document.body.setAttribute('data-oldest',firstMsg.dataset.id);
loader.innerText='Scroll to top to load older messages';
}catch(e){loader.innerText='Error loading messages';}finally{loading=false;}
}
window.addEventListener('scroll',()=>{if(window.scrollY<60) loadOlder();});

// Auto-refresh every 10s
setInterval(()=>{
if(document.visibilityState!=='visible') return;
fetch('/refresh').then(r=>r.text()).then(html=>{
const chat=document.getElementById('chat');
const loader=document.getElementById('loader');
chat.innerHTML=html+(loader?loader.outerHTML:'<div id="loader">Scroll to top to load older messages</div>');
}).catch(()=>{});
},10000);
</script>
</body>
</html>`);
});

// Refresh endpoint
app.get('/refresh', async (req,res)=>{
try{
const channel = await client.channels.fetch(CHANNEL_ID);
if(!channel) return res.send('');
const fetched = await channel.messages.fetch({limit:50});
const messages = Array.from(fetched.values()).reverse();
let blocks = '';
for(const m of messages) blocks += await renderMessageBlock(m);
res.send(blocks);
}catch(err){console.error('Refresh error',err);res.status(500).send('');}
});

// Load older messages
app.get('/load', async (req,res)=>{
try{
const before=req.query.before;
if(!before) return res.status(400).send('');
const limit=Math.min(parseInt(req.query.limit||'50',10),100);
const channel = await client.channels.fetch(CHANNEL_ID);
const fetched = await channel.messages.fetch({limit,before});
if(!fetched || fetched.size===0) return res.status(204).send('');
const messages=Array.from(fetched.values()).reverse();
let html='';
for(const m of messages) html+=await renderMessageBlock(m);
res.send(html);
}catch(err){console.error('Load error',err);res.status(500).send('');}
});

// Start server & login
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
client.login(TOKEN).catch(err=>{console.error('Discord login failed:',err);process.exit(1);});
