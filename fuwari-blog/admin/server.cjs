#!/usr/bin/env node
'use strict';

/**
 * 云笺集 · 博客管理后台 v2
 * 功能：认证登录、文章 CRUD、站点设置、数据库管理、访问统计
 * 安全：scrypt 密码哈希、Token 会话、速率限制、输入校验
 * 运行: node server.cjs  (可选环境变量 PORT / PROJECT_DIR / BUILD_CMD)
 * systemd: systemctl start fuwari-admin
 * nginx:   location /dev/admin/ -> http://127.0.0.1:3010/
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3010', 10);
const PROJECT_DIR = process.env.PROJECT_DIR || path.resolve(__dirname, '..');
const POSTS_DIR = path.join(PROJECT_DIR, 'src', 'content', 'posts');
const CONFIG_PATH = path.join(PROJECT_DIR, 'src', 'config.ts');
const MAX_BODY = 10 * 1024 * 1024; // 单篇文章上限 10MB

fs.mkdirSync(POSTS_DIR, { recursive: true });

/* ---------- 数据库 ---------- */

const { userOps, statsOps, settingsOps } = require('./db.cjs');

/* ---------- 安全：速率限制 ---------- */

const rateLimitMap = new Map(); // ip -> { count, resetTime }

function checkRateLimit(ip, max = 60, windowSec = 60) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    entry = { count: 1, resetTime: now + windowSec * 1000 };
    rateLimitMap.set(ip, entry);
    return true;
  }
  entry.count++;
  if (entry.count > max) return false;
  return true;
}

// 清理过期限流记录，每 5 分钟
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rateLimitMap) {
    if (now > e.resetTime) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

/* ---------- 工具 ---------- */

function safeName(raw) {
  if (!raw) return null;
  let name;
  try { name = decodeURIComponent(raw); } catch { return null; }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  if (!/^[\w一-龥.\-]+\.md$/i.test(name)) return null;
  return name;
}

function sendJSON(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(b),
    'Access-Control-Allow-Origin': 'null',
    'Access-Control-Allow-Credentials': 'true',
  });
  res.end(b);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('内容过大')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getClientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return cookies;
}

/* ---------- Auth 中间件 ---------- */

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  const token = cookies['cl_token'];
  const session = userOps.checkToken(token);
  if (!session) {
    sendJSON(res, 401, { error: '未登录或会话已过期' });
    return null;
  }
  return session;
}

/* ---------- frontmatter ---------- */

function parseFrontmatter(content) {
  const m = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return null;
  const meta = { title: '', published: '', tags: [], category: '', description: '', draft: false };
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    let val = line.slice(idx + 1).trim();
    if (key === 'tags') {
      meta.tags = val.replace(/^\[|\]$/g, '').split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else if (key === 'title') {
      meta.title = val.replace(/^['"]|['"]$/g, '');
    } else if (key === 'published' || key === 'date') {
      meta.published = val.replace(/^['"]|['"]$/g, '').slice(0, 10);
    } else if (key === 'description') {
      meta.description = val.replace(/^['"]|['"]$/g, '');
    } else if (key === 'category') {
      meta.category = val.replace(/^['"]|['"]$/g, '');
    } else if (key === 'draft') {
      meta.draft = val === 'true';
    }
  }
  return meta;
}

function buildFrontmatter({ title, published, tags, category, description, draft }) {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    '---',
    `title: ${title || '未命名文章'}`,
    `published: ${published || now}`,
    `tags: [${(tags || []).join(', ')}]`,
    `category: ${category || ''}`,
    `description: ${description || ''}`,
    `draft: ${draft ? 'true' : 'false'}`,
    '---',
    '',
  ];
  return lines.join('\n');
}

/* ---------- 构建触发 ---------- */

let building = false;
let buildQueue = false;
let lastBuildTime = null;
let lastBuildStatus = null;

function triggerBuild() {
  if (building) { buildQueue = true; return Promise.resolve('排队中'); }
  building = true;
  return new Promise((resolve, reject) => {
    const buildCmd = process.env.BUILD_CMD || 'pnpm build';
    const parts = buildCmd.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    console.log('[build] 开始构建: ' + buildCmd);
    const child = spawn(cmd, args, {
      cwd: PROJECT_DIR,
      env: { ...process.env, CI: 'true' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      building = false;
      lastBuildTime = new Date().toISOString();
      if (code === 0) {
        lastBuildStatus = 'success';
        console.log('[build] 构建完成');
        if (buildQueue) { buildQueue = false; triggerBuild(); }
        resolve('构建完成');
      } else {
        lastBuildStatus = 'failed';
        console.error('[build] 构建失败:\n' + out.slice(-2000));
        reject(new Error('构建失败: ' + out.slice(-300)));
      }
    });
    child.on('error', (e) => {
      building = false;
      lastBuildStatus = 'error';
      reject(e);
    });
  });
}

/* ---------- 配置读写 ---------- */

function readConfig() {
  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const getStr = (key) => {
    const m = src.match(new RegExp(key + '\\s*:\\s*["\']([^"\']*)["\']'));
    return m ? m[1] : '';
  };
  const getNum = (key) => {
    const m = src.match(new RegExp(key + '\\s*:\\s*(\\d+)'));
    return m ? parseInt(m[1], 10) : 0;
  };
  const getBool = (key) => {
    const m = src.match(new RegExp(key + '\\s*:\\s*(true|false)'));
    return m ? m[1] === 'true' : false;
  };
  const getEnable = (section) => {
    const re = new RegExp(section + '\\s*:\\s*\\{[^}]*?enable\\s*:\\s*(true|false)', 's');
    const m = src.match(re);
    return m ? m[1] === 'true' : false;
  };
  const getTOCTdepth = () => {
    const m = src.match(/toc\s*:\s*\{[\s\S]*?depth\s*:\s*(\d)/);
    return m ? parseInt(m[1], 10) : 2;
  };
  const links = [];
  const profileBlock = src.match(/profileConfig[\s\S]*?links\s*:\s*\[([\s\S]*?)\]/);
  if (profileBlock) {
    const linkRe = /\{\s*name\s*:\s*["']([^"']*)["']\s*,\s*icon\s*:\s*["']([^"']*)["']\s*,\s*url\s*:\s*["']([^"']*)["']\s*\}/g;
    let lm;
    while ((lm = linkRe.exec(profileBlock[1]))) { links.push({ name: lm[1], icon: lm[2], url: lm[3] }); }
  }
  const navLinks = [];
  const navBlock = src.match(/navBarConfig[\s\S]*?links\s*:\s*\[([\s\S]*?)\]/);
  if (navBlock) {
    const presetRe = /LinkPreset\.(Home|Archive|About)/g;
    let pm;
    while ((pm = presetRe.exec(navBlock[1]))) { navLinks.push({ type: 'preset', id: pm[1].toLowerCase() }); }
    const customRe = /\{\s*name\s*:\s*["']([^"']*)["']\s*,\s*url\s*:\s*["']([^"']*)["'](?:\s*,\s*external\s*:\s*(true|false))?\s*\}/g;
    let cm;
    while ((cm = customRe.exec(navBlock[1]))) { navLinks.push({ type: 'custom', name: cm[1], url: cm[2], external: cm[3] === 'true' }); }
  }
  return {
    site: { title: getStr('title'), subtitle: getStr('subtitle'), lang: getStr('lang'), themeHue: getNum('hue'), themeFixed: getBool('fixed') },
    banner: {
      enable: getEnable('banner'), src: getStr('src'), position: getStr('position') || 'center',
      creditEnable: getEnable('credit'),
      creditText: (() => { const m = src.match(/credit\s*:\s*\{[\s\S]*?text\s*:\s*["']([^"']*)["']/); return m ? m[1] : ''; })(),
      creditUrl: (() => { const m = src.match(/credit\s*:\s*\{[\s\S]*?url\s*:\s*["']([^"']*)["']/); return m ? m[1] : ''; })(),
    },
    toc: { enable: getEnable('toc'), depth: getTOCTdepth() },
    profile: { name: getStr('name'), bio: getStr('bio'), links },
    license: {
      enable: (() => { const m = src.match(/licenseConfig[\s\S]*?enable\s*:\s*(true|false)/); return m ? m[1] === 'true' : false; })(),
      name: (() => { const m = src.match(/licenseConfig[\s\S]*?name\s*:\s*["']([^"']*)["']/); return m ? m[1] : ''; })(),
      url: (() => { const m = src.match(/licenseConfig[\s\S]*?url\s*:\s*["']([^"']*)["']/); return m ? m[1] : ''; })(),
    },
    navLinks,
    expressiveCode: { theme: getStr('theme') },
  };
}

function writeConfig(settings) {
  let src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const s = settings;
  const reps = [];
  if (s.site) {
    if (s.site.title !== undefined) reps.push([/(title\s*:\s*["'])([^"']*)(["'])/, `$1${s.site.title}$3`]);
    if (s.site.subtitle !== undefined) reps.push([/(subtitle\s*:\s*["'])([^"']*)(["'])/, `$1${s.site.subtitle}$3`]);
    if (s.site.lang !== undefined) reps.push([/(lang\s*:\s*["'])([^"']*)(["'])/, `$1${s.site.lang}$3`]);
    if (s.site.themeHue !== undefined) reps.push([/(hue\s*:\s*)(\d+)/, `$1${s.site.themeHue}`]);
    if (s.site.themeFixed !== undefined) reps.push([/(fixed\s*:\s*)(true|false)/, `$1${s.site.themeFixed}`]);
  }
  if (s.banner) {
    if (s.banner.enable !== undefined) reps.push([/(banner\s*:\s*\{[\s\S]*?enable\s*:\s*)(true|false)/, `$1${s.banner.enable}`]);
    if (s.banner.src !== undefined) reps.push([/(banner\s*:\s*\{[\s\S]*?src\s*:\s*["'])([^"']*)(["'])/, `$1${s.banner.src}$3`]);
    if (s.banner.position !== undefined) reps.push([/(banner\s*:\s*\{[\s\S]*?position\s*:\s*["'])([^"']*)(["'])/, `$1${s.banner.position}$3`]);
  }
  if (s.toc) {
    if (s.toc.enable !== undefined) reps.push([/(toc\s*:\s*\{[\s\S]*?enable\s*:\s*)(true|false)/, `$1${s.toc.enable}`]);
    if (s.toc.depth !== undefined) reps.push([/(toc\s*:\s*\{[\s\S]*?depth\s*:\s*)(\d)/, `$1${s.toc.depth}`]);
  }
  if (s.profile) {
    if (s.profile.name !== undefined) reps.push([/(profileConfig[\s\S]*?name\s*:\s*["'])([^"']*)(["'])/, `$1${s.profile.name}$3`]);
    if (s.profile.bio !== undefined) reps.push([/(profileConfig[\s\S]*?bio\s*:\s*["'])([^"']*)(["'])/, `$1${s.profile.bio}$3`]);
  }
  if (s.license) {
    if (s.license.enable !== undefined) reps.push([/(licenseConfig[\s\S]*?enable\s*:\s*)(true|false)/, `$1${s.license.enable}`]);
    if (s.license.name !== undefined) reps.push([/(licenseConfig[\s\S]*?name\s*:\s*["'])([^"']*)(["'])/, `$1${s.license.name}$3`]);
    if (s.license.url !== undefined) reps.push([/(licenseConfig[\s\S]*?url\s*:\s*["'])([^"']*)(["'])/, `$1${s.license.url}$3`]);
  }
  for (const [re, rep] of reps) { src = src.replace(re, rep); }
  fs.writeFileSync(CONFIG_PATH, src, 'utf8');
}

/* ---------- API ---------- */

// 登录
async function apiLogin(req, res, ip) {
  if (!checkRateLimit('login:' + ip, 10, 60)) return sendJSON(res, 429, { error: '登录尝试过于频繁，请 1 分钟后重试' });
  let body;
  try { body = JSON.parse((await readBody(req, 4096)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const { username, password } = body;
  if (!username || !password) return sendJSON(res, 400, { error: '用户名和密码不能为空' });
  const result = userOps.login(username, password);
  if (result.error) return sendJSON(res, 401, { error: result.error });
  // 设置 cookie（HttpOnly, SameSite=Strict）
  const expires = new Date(result.expires).toUTCString();
  res.setHeader('Set-Cookie', `cl_token=${result.token}; Path=/dev/admin; HttpOnly; SameSite=Strict; Max-Age=86400`);
  sendJSON(res, 200, { ok: true, username: result.username, expires: result.expires });
}

// 登出
function apiLogout(req, res) {
  const cookies = parseCookies(req);
  const token = cookies['cl_token'];
  if (token) userOps.logout(token);
  res.setHeader('Set-Cookie', 'cl_token=; Path=/dev/admin; HttpOnly; SameSite=Strict; Max-Age=0');
  sendJSON(res, 200, { ok: true });
}

// 检查登录状态
function apiCheck(req, res) {
  const cookies = parseCookies(req);
  const token = cookies['cl_token'];
  const session = userOps.checkToken(token);
  if (!session) return sendJSON(res, 200, { loggedIn: false });
  sendJSON(res, 200, { loggedIn: true, username: session.username });
}

// 注册
async function apiRegister(req, res, ip) {
  if (!checkRateLimit('register:' + ip, 5, 300)) return sendJSON(res, 429, { error: '注册过于频繁，请 5 分钟后重试' });
  let body;
  try { body = JSON.parse((await readBody(req, 2048)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const { username, password } = body;
  if (!username || !password) return sendJSON(res, 400, { error: '用户名和密码不能为空' });
  const result = userOps.register(username, password);
  if (result.error) return sendJSON(res, 400, { error: result.error });
  // 自动登录
  const loginResult = userOps.login(username, password);
  const expires = new Date(loginResult.expires).toUTCString();
  res.setHeader('Set-Cookie', `cl_token=${loginResult.token}; Path=/dev/admin; HttpOnly; SameSite=Strict; Max-Age=86400`);
  sendJSON(res, 201, { ok: true, username: loginResult.username, expires: loginResult.expires });
}

// --- 邮箱验证码系统 ---
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'Cloudletter <noreply@cloudletter.cn>';

// 验证码存储（内存，重启清空）: email -> { code, expires, tries }
const codeStore = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 位数字
}

// 发送验证码邮件
async function sendVerificationCode(email) {
  const code = generateCode();
  codeStore.set(email.toLowerCase(), { code, expires: Date.now() + 5 * 60 * 1000, tries: 0 });

  // 清理过期记录
  for (const [k, v] of codeStore) { if (Date.now() > v.expires) codeStore.delete(k); }

  // 使用 nodemailer 发邮件
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch { return { error: '邮件服务未安装 nodemailer' }; }
  if (!SMTP_HOST || !SMTP_USER) return { error: 'SMTP 邮件服务未配置（环境变量 SMTP_HOST/SMTP_USER/SMTP_PASS）' };

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10000,
    });

    await transporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject: '云笺集 · 登录验证码',
      html: `
        <div style="max-width:480px;margin:0 auto;font-family:sans-serif">
          <h2 style="color:#C2402A">云笺集 · 管理后台</h2>
          <p>您的登录验证码（5 分钟内有效）：</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f5f3ef;border-radius:4px;margin:16px 0">
            ${code}
          </div>
          <p style="color:#888;font-size:13px">如果这不是您本人操作，请忽略此邮件。</p>
        </div>
      `,
    });
    console.log('[email] 验证码已发送至', email);
    return { ok: true, expireMinutes: 5 };
  } catch (e) {
    codeStore.delete(email.toLowerCase());
    return { error: '邮件发送失败: ' + e.message };
  }
}

async function apiSendCode(req, res, ip) {
  if (!checkRateLimit('code:' + ip, 3, 120)) return sendJSON(res, 429, { error: '发送过于频繁，请 2 分钟后重试' });
  let body;
  try { body = JSON.parse((await readBody(req, 2048)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 400, { error: '邮箱地址无效' });

  // 检查是否有绑定该邮箱的用户
  const { db } = require('./db.cjs');
  if (db && !db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return sendJSON(res, 400, { error: '该邮箱未绑定任何账号，请联系管理员' });
  }

  const result = await sendVerificationCode(email);
  if (result.error) return sendJSON(res, 500, { error: result.error });
  sendJSON(res, 200, { ok: true, message: '验证码已发送至 ' + email });
}

async function apiVerifyCode(req, res, ip) {
  if (!checkRateLimit('verify:' + ip, 10, 60)) return sendJSON(res, 429, { error: '尝试过于频繁，请 1 分钟后重试' });
  let body;
  try { body = JSON.parse((await readBody(req, 2048)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const email = (body.email || '').trim().toLowerCase();
  const code = (body.code || '').trim();
  if (!email || !code) return sendJSON(res, 400, { error: '邮箱和验证码不能为空' });

  const record = codeStore.get(email);
  if (!record) return sendJSON(res, 400, { error: '验证码不存在或已过期，请重新获取' });
  if (Date.now() > record.expires) { codeStore.delete(email); return sendJSON(res, 400, { error: '验证码已过期，请重新获取' }); }

  record.tries++;
  if (record.tries > 5) { codeStore.delete(email); return sendJSON(res, 400, { error: '验证码尝试次数过多，请重新获取' }); }
  if (record.code !== code) return sendJSON(res, 400, { error: '验证码错误' });

  // 验证成功，删除验证码，登录
  codeStore.delete(email);
  const result = userOps.loginByEmail(email);
  if (result.error) return sendJSON(res, 401, { error: result.error });

  const expires = new Date(result.expires).toUTCString();
  res.setHeader('Set-Cookie', `cl_token=${result.token}; Path=/dev/admin; HttpOnly; SameSite=Strict; Max-Age=86400`);
  sendJSON(res, 200, { ok: true, username: result.username, email });
}

// 用户邮箱管理 API
async function apiSetEmail(req, res, session) {
  let body;
  try { body = JSON.parse((await readBody(req, 2048)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const { username, email } = body;
  if (!username) return sendJSON(res, 400, { error: '请指定用户名' });
  const result = userOps.setEmail(username, email || null);
  if (result.error) return sendJSON(res, 400, { error: result.error });
  sendJSON(res, 200, result);
}

// 修改密码
async function apiChangePassword(req, res, session) {
  let body;
  try { body = JSON.parse((await readBody(req, 2048)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const { oldPassword, newPassword } = body;
  if (!oldPassword || !newPassword) return sendJSON(res, 400, { error: '请填写新旧密码' });
  const result = userOps.changePassword(session.username, oldPassword, newPassword);
  if (result.error) return sendJSON(res, 400, { error: result.error });
  // 清除 cookie
  res.setHeader('Set-Cookie', 'cl_token=; Path=/dev/admin; HttpOnly; SameSite=Strict; Max-Age=0');
  sendJSON(res, 200, { ok: true, message: '密码已修改，请重新登录' });
}

// 仪表盘数据
function apiDashboard(_req, res) {
  const stats = statsOps.getDashboard();
  const articleFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  stats.articleCount = articleFiles.length;
  stats.buildStatus = { building, lastBuildTime, lastBuildStatus };
  sendJSON(res, 200, stats);
}

// 文章列表
async function apiList(res) {
  const files = await fsp.readdir(POSTS_DIR).catch(() => []);
  const items = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const abs = path.join(POSTS_DIR, f);
    try {
      const content = await fsp.readFile(abs, 'utf8');
      const meta = parseFrontmatter(content);
      if (meta) items.push({ name: f, ...meta });
    } catch { /* ignore */ }
  }
  items.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  sendJSON(res, 200, { items });
}

async function apiGet(res, name) {
  const abs = path.join(POSTS_DIR, name);
  if (!fs.existsSync(abs)) return sendJSON(res, 404, { error: '文章不存在' });
  const content = await fsp.readFile(abs, 'utf8');
  sendJSON(res, 200, { name, content });
}

async function apiCreate(req, res) {
  let body;
  try { body = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const name = safeName(body.name);
  if (!name) return sendJSON(res, 400, { error: '名称非法（需以 .md 结尾，不含路径）' });
  const abs = path.join(POSTS_DIR, name);
  if (fs.existsSync(abs)) return sendJSON(res, 409, { error: '同名文章已存在' });
  const content = buildFrontmatter(body.meta || {}) + (typeof body.content === 'string' ? body.content : '');
  try { await fsp.writeFile(abs, content, 'utf8'); } catch (e) { return sendJSON(res, 500, { error: e.message }); }
  try { await triggerBuild(); sendJSON(res, 201, { ok: true, name }); }
  catch (e) { sendJSON(res, 200, { ok: true, name, buildError: e.message }); }
}

async function apiUpdate(req, res, name) {
  let body;
  try { body = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const abs = path.join(POSTS_DIR, name);
  if (!fs.existsSync(abs)) return sendJSON(res, 404, { error: '文章不存在' });
  let content = typeof body.content === 'string' ? body.content : '';
  if (body.meta) {
    const old = await fsp.readFile(abs, 'utf8');
    const oldMeta = parseFrontmatter(old);
    const merged = { ...oldMeta, ...body.meta };
    const fm = buildFrontmatter(merged);
    content = content.startsWith('---') ? content : fm + content;
  }
  try { await fsp.writeFile(abs, content, 'utf8'); } catch (e) { return sendJSON(res, 500, { error: e.message }); }
  try { await triggerBuild(); sendJSON(res, 200, { ok: true, name }); }
  catch (e) { sendJSON(res, 200, { ok: true, name, buildError: e.message }); }
}

async function apiDelete(req, res, name) {
  const abs = path.join(POSTS_DIR, name);
  try { await fsp.rm(abs, { force: true }); } catch (e) { return sendJSON(res, 500, { error: e.message }); }
  try { await triggerBuild(); sendJSON(res, 200, { ok: true }); }
  catch (e) { sendJSON(res, 200, { ok: true, buildError: e.message }); }
}

async function apiBuild(_req, res) {
  try { await triggerBuild(); sendJSON(res, 200, { ok: true }); }
  catch (e) { sendJSON(res, 500, { error: e.message }); }
}

// 访问统计 API
function apiStats(_req, res) {
  const stats = statsOps.getDashboard();
  stats.daily = statsOps.getDailyStats(30);
  sendJSON(res, 200, stats);
}

// 用户管理 API
function apiListUsers(_req, res) {
  const users = userOps.listUsers();
  sendJSON(res, 200, { users });
}

async function apiAddUser(req, res, session) {
  let body;
  try { body = JSON.parse((await readBody(req, 2048)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const { username, password } = body;
  const result = userOps.addUser(username, password);
  if (result.error) return sendJSON(res, 400, { error: result.error });
  sendJSON(res, 201, result);
}

async function apiDeleteUser(req, res, session, targetUsername) {
  const result = userOps.deleteUser(targetUsername, session.username);
  if (result.error) return sendJSON(res, 400, { error: result.error });
  sendJSON(res, 200, result);
}

async function apiResetPassword(req, res, session, targetUsername) {
  const result = userOps.resetPassword(targetUsername);
  if (result.error) return sendJSON(res, 400, { error: result.error });
  sendJSON(res, 200, result);
}

/* ---------- SPA ---------- */

const HTML_PATH = path.join(__dirname, 'public', 'index.html');
let SPA = '';
try { SPA = fs.readFileSync(HTML_PATH, 'utf8'); } catch { SPA = '<h1>UI 缺失</h1>'; }

/* ---------- 路由 ---------- */

const ROUTES = [
  // 公开路由
  ['GET', '/api/auth/check',    (req, res) => apiCheck(req, res)],
  ['POST','/api/auth/login',    (req, res, ip) => apiLogin(req, res, ip)],
  ['POST','/api/auth/logout',   (req, res) => apiLogout(req, res)],
  ['POST','/api/auth/code/send',   (req, res, ip) => apiSendCode(req, res, ip)],
  ['POST','/api/auth/code/verify', (req, res, ip) => apiVerifyCode(req, res, ip)],

  // 需要认证的路由
  ['GET',    '/api/dashboard',         (req, res, s) => apiDashboard(req, res)],
  ['GET',    '/api/stats',             (req, res, s) => apiStats(req, res)],
  ['POST',   '/api/auth/password',     (req, res, s) => apiChangePassword(req, res, s)],
  ['GET',    '/api/auth/users',        (req, res, s) => apiListUsers(req, res)],
  ['POST',   '/api/auth/users',        (req, res, s) => apiAddUser(req, res, s)],
  ['PUT',    '/api/auth/email',        (req, res, s) => apiSetEmail(req, res, s)],
  ['GET',    '/api/articles',          (req, res, s) => apiList(res)],
  ['POST',   '/api/articles',          (req, res, s) => apiCreate(req, res)],
  ['GET',    '/api/settings',          (req, res, s) => {
    try { sendJSON(res, 200, readConfig()); }
    catch (e) { sendJSON(res, 500, { error: '读取配置失败: ' + e.message }); }
  }],
  ['PUT',    '/api/settings',          async (req, res, s) => {
    let body;
    try { body = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8')); } catch { return sendJSON(res, 400, { error: '参数错误' }); }
    try { writeConfig(body); await triggerBuild(); sendJSON(res, 200, { ok: true }); }
    catch (e) { sendJSON(res, 500, { error: '保存配置失败: ' + e.message }); }
  }],
  ['POST',   '/api/build',            (req, res, s) => apiBuild(req, res)],
];

// 动态文章路由
function handleArticleRoute(method, apiPath, req, res) {
  const m = apiPath.match(/^\/api\/articles\/(.+)$/);
  if (!m) return false;
  const name = safeName(m[1]);
  if (!name) { sendJSON(res, 400, { error: '名称非法' }); return true; }
  if (method === 'GET') apiGet(res, name);
  else if (method === 'PUT') apiUpdate(req, res, name);
  else if (method === 'DELETE') apiDelete(req, res, name);
  else sendJSON(res, 405, { error: '方法不允许' });
  return true;
}

// 动态用户路由
function handleUserRoute(method, apiPath, req, res, session) {
  const m = apiPath.match(/^\/api\/auth\/users\/(.+)$/);
  if (!m) return false;
  const targetUsername = m[1];
  if (!/^[a-zA-Z0-9_]{2,30}$/.test(targetUsername)) {
    sendJSON(res, 400, { error: '用户名非法' });
    return true;
  }
  if (method === 'DELETE') apiDeleteUser(req, res, session, targetUsername);
  else if (method === 'POST' && apiPath.includes('/reset')) apiResetPassword(req, res, session, targetUsername);
  else sendJSON(res, 405, { error: '方法不允许' });
  return true;
}

const server = http.createServer(async (req, res) => {
  const ip = getClientIP(req);

  // 全局速率限制
  if (!checkRateLimit(ip, 200, 60)) {
    res.writeHead(429, { 'Retry-After': '60' });
    return res.end('请求过于频繁');
  }

  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': 'null', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }

  try {
    // SPA 页面（GET 请求走这个）
    if (req.method === 'GET' && (p === '/dev/admin' || p === '/dev/admin/' || p === '/admin' || p === '/admin/' || p === '/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(SPA);
    }

    const apiPath = p.replace(/^\/dev\/admin/, '').replace(/^\/admin/, '');

    // 尝试匹配固定路由
    for (const [method, route, handler] of ROUTES) {
      if (req.method === method && apiPath === route) {
        const isPublic = route.includes('/auth/check') || route.includes('/auth/login') || route.includes('/auth/logout') || route.includes('/auth/code');
        if (!isPublic) {
          const session = requireAuth(req, res);
          if (!session) return;
          return await handler(req, res, session);
        }
        return await handler(req, res, ip);
      }
    }

    // 匹配文章动态路由（需要认证）
    {
      const session = requireAuth(req, res);
      if (!session) return;
      if (handleArticleRoute(req.method, apiPath, req, res)) return;
      if (handleUserRoute(req.method, apiPath, req, res, session)) return;
    }
  } catch (e) {
    console.error('[error]', e);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
    else res.end();
  }

  // 未匹配
  sendJSON(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => console.log(`云笺集管理后台 v2 on :${PORT} posts=${POSTS_DIR}`));
