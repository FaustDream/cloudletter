#!/usr/bin/env node
'use strict';

/**
 * 云笺集 · Fuwari 博客在线编辑服务
 * 零依赖，纯 Node 内置模块。
 * 功能：文章 CRUD（读写 src/content/posts/*.md）+ 保存后触发 pnpm build 重新生成静态站
 * 运行: node server.js   (可选环境变量 PORT / PROJECT_DIR / BUILD_CMD)
 * 由 systemd 托管: systemctl start fuwari-admin
 * 反向代理: nginx location /dev/admin/ -> http://127.0.0.1:3010/
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3010', 10);
const PROJECT_DIR = process.env.PROJECT_DIR || path.resolve(__dirname, '..');
const POSTS_DIR = path.join(PROJECT_DIR, 'src', 'content', 'posts');
const MAX_BODY = 10 * 1024 * 1024; // 单篇文章上限 10MB

fs.mkdirSync(POSTS_DIR, { recursive: true });

/* ---------- 工具 ---------- */

// 名称校验：仅 .md，禁止路径穿越
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

function triggerBuild() {
  if (building) { buildQueue = true; return Promise.resolve('排队中'); }
  building = true;
  return new Promise((resolve, reject) => {
    // BUILD_CMD 形如 "pnpm build"，拆分为命令 + 参数数组
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
      if (code === 0) {
        console.log('[build] 构建完成');
        if (buildQueue) { buildQueue = false; triggerBuild(); }
        resolve('构建完成');
      } else {
        console.error('[build] 构建失败:\n' + out.slice(-2000));
        reject(new Error('构建失败: ' + out.slice(-300)));
      }
    });
    child.on('error', (e) => {
      building = false;
      reject(e);
    });
  });
}

/* ---------- API ---------- */

async function apiList(res) {
  const files = await fsp.readdir(POSTS_DIR).catch(() => []);
  const items = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const abs = path.join(POSTS_DIR, f);
    try {
      const content = await fsp.readFile(abs, 'utf8');
      const meta = parseFrontmatter(content);
      if (meta) {
        items.push({ name: f, ...meta });
      }
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
  try { body = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8')); }
  catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const name = safeName(body.name);
  if (!name) return sendJSON(res, 400, { error: '名称非法（需以 .md 结尾，不含路径）' });
  const abs = path.join(POSTS_DIR, name);
  if (fs.existsSync(abs)) return sendJSON(res, 409, { error: '同名文章已存在' });
  const content = buildFrontmatter(body.meta || {}) + (typeof body.content === 'string' ? body.content : '');
  try {
    await fsp.writeFile(abs, content, 'utf8');
  } catch (e) { return sendJSON(res, 500, { error: e.message }); }
  try {
    await triggerBuild();
    sendJSON(res, 201, { ok: true, name });
  } catch (e) {
    sendJSON(res, 200, { ok: true, name, buildError: e.message });
  }
}

async function apiUpdate(req, res, name) {
  let body;
  try { body = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8')); }
  catch { return sendJSON(res, 400, { error: '参数错误' }); }
  const abs = path.join(POSTS_DIR, name);
  if (!fs.existsSync(abs)) return sendJSON(res, 404, { error: '文章不存在' });
  let content = typeof body.content === 'string' ? body.content : '';
  // 若前端只提交正文+meta，则重组完整文件
  if (body.meta) {
    const old = await fsp.readFile(abs, 'utf8');
    const oldMeta = parseFrontmatter(old);
    const merged = { ...oldMeta, ...body.meta };
    const fm = buildFrontmatter(merged);
    content = content.startsWith('---') ? content : fm + content;
  }
  try {
    await fsp.writeFile(abs, content, 'utf8');
  } catch (e) { return sendJSON(res, 500, { error: e.message }); }
  try {
    await triggerBuild();
    sendJSON(res, 200, { ok: true, name });
  } catch (e) {
    sendJSON(res, 200, { ok: true, name, buildError: e.message });
  }
}

async function apiDelete(req, res, name) {
  const abs = path.join(POSTS_DIR, name);
  try { await fsp.rm(abs, { force: true }); }
  catch (e) { return sendJSON(res, 500, { error: e.message }); }
  try {
    await triggerBuild();
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    sendJSON(res, 200, { ok: true, buildError: e.message });
  }
}

async function apiBuild(_req, res) {
  try {
    await triggerBuild();
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
}

/* ---------- SPA ---------- */

const HTML_PATH = path.join(__dirname, 'public', 'index.html');
let SPA = '';
try { SPA = fs.readFileSync(HTML_PATH, 'utf8'); } catch { SPA = '<h1>UI 缺失</h1>'; }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;
  try {
    // 管理界面（支持 /dev/admin 与 /dev/admin/ 两种访问）
    if (p === '/dev/admin' || p === '/dev/admin/' || p === '/admin' || p === '/admin/' || p === '/') {
      if (req.method !== 'GET') return sendJSON(res, 405, { error: '方法不允许' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(SPA);
    }
    // API（前缀兼容 /api 与 /dev/admin/api）
    const apiPath = p.replace(/^\/dev\/admin/, '').replace(/^\/admin/, '');
    if (apiPath === '/api/articles') {
      if (req.method === 'GET') return await apiList(res);
      if (req.method === 'POST') return await apiCreate(req, res);
    }
    if (apiPath === '/api/build') {
      if (req.method === 'POST') return await apiBuild(req, res);
    }
    const m = apiPath.match(/^\/api\/articles\/(.+)$/);
    if (m) {
      const name = safeName(m[1]);
      if (!name) return sendJSON(res, 400, { error: '名称非法' });
      if (req.method === 'GET') return await apiGet(res, name);
      if (req.method === 'PUT') return await apiUpdate(req, res, name);
      if (req.method === 'DELETE') return await apiDelete(req, res, name);
    }
    sendJSON(res, 404, { error: 'Not Found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, () => console.log(`云笺集在线编辑 on :${PORT} posts=${POSTS_DIR}`));
