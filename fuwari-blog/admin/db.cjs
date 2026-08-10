/**
 * 云笺集 · 数据库层
 * 使用 better-sqlite3（同步、零配置、高性能 SQLite）
 * 如果 better-sqlite3 不可用，回退到 JSON 文件存储
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.resolve(__dirname, 'data', 'cloudletter.db');
const DATA_DIR = path.dirname(DB_PATH);

let db;
try {
  const Database = require('better-sqlite3');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log('[db] SQLite 已连接:', DB_PATH);
} catch (_) {
  console.warn('[db] better-sqlite3 不可用，使用 JSON 文件存储。npm install better-sqlite3');
  db = null;
}

/* ========== 表初始化 ========== */

function initTables() {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      linuxdo_id INTEGER,
      linuxdo_username TEXT,
      linuxdo_avatar TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS page_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      referrer TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      ip_hash TEXT DEFAULT '',
      visited_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_visits_path ON page_visits(path);
    CREATE INDEX IF NOT EXISTS idx_visits_date ON page_visits(visited_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // 迁移：为旧表添加列
  try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN linuxdo_id INTEGER'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN linuxdo_username TEXT'); } catch {}
  try { db.exec('ALTER TABLE users ADD COLUMN linuxdo_avatar TEXT'); } catch {}

  // 默认管理员
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    const hash = hashPassword('admin123');
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('[db] 默认管理员已创建: admin / admin123');
    console.log('[db] 请登录后立即修改密码！');
  }
}

/* ========== 密码工具（Node crypto，零依赖） ========== */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/* ========== 用户操作 ========== */

const userOps = {
  login(username, password) {
    if (!db) return { error: '数据库不可用' };
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return { error: '用户名或密码错误' };
    if (!verifyPassword(password, user.password_hash)) return { error: '用户名或密码错误' };

    // 创建 session，24 小时过期
    const token = generateToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expires);

    // 清理过期 session
    db.prepare('DELETE FROM sessions WHERE expires_at < datetime("now","localtime")').run();

    return { ok: true, username: user.username, token, expires };
  },

  logout(token) {
    if (!db) return;
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  checkToken(token) {
    if (!db) return null;
    if (!token) return null;
    const session = db.prepare(`
      SELECT s.*, u.username FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now','localtime')
    `).get(token);
    return session || null;
  },

  changePassword(username, oldPassword, newPassword) {
    if (!db) return { error: '数据库不可用' };
    if (!newPassword || newPassword.length < 6) return { error: '新密码至少 6 位' };
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return { error: '用户不存在' };
    if (!verifyPassword(oldPassword, user.password_hash)) return { error: '旧密码错误' };
    const hash = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    // 清除所有 session，强制重新登录
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    return { ok: true };
  },

  addUser(newUsername, password) {
    if (!db) return { error: '数据库不可用' };
    if (!newUsername || !password) return { error: '用户名和密码不能为空' };
    if (password.length < 6) return { error: '密码至少 6 位' };
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,30}$/.test(newUsername)) return { error: '用户名只能是 2-30 位字母、数字、下划线或中文' };
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(newUsername);
    if (existing) return { error: '用户名已存在' };
    const hash = hashPassword(password);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(newUsername, hash);
    return { ok: true, username: newUsername };
  },

  register(newUsername, password) {
    return this.addUser(newUsername, password);
  },

  // 邮箱验证码登录：查找用户并创建 session
  loginByEmail(email) {
    if (!db) return { error: '数据库不可用' };
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return { error: '该邮箱未绑定任何账号，请联系管理员' };
    const token = generateToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expires);
    db.prepare('DELETE FROM sessions WHERE expires_at < datetime("now","localtime")').run();
    return { ok: true, username: user.username, token, expires };
  },

  // 设置用户邮箱
  setEmail(username, email) {
    if (!db) return { error: '数据库不可用' };
    if (email && db.prepare('SELECT id FROM users WHERE email = ? AND username != ?').get(email, username)) {
      return { error: '该邮箱已被其他用户使用' };
    }
    db.prepare('UPDATE users SET email = ? WHERE username = ?').run(email || null, username);
    return { ok: true };
  },

  listUsers() {
    if (!db) return [];
    return db.prepare('SELECT id, username, email, created_at FROM users ORDER BY id').all();
  },

  deleteUser(targetUsername, currentUsername) {
    if (!db) return { error: '数据库不可用' };
    if (targetUsername === currentUsername) return { error: '不能删除自己的账号' };
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    if (count <= 1) return { error: '至少保留一个管理员账号' };
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(targetUsername);
    if (!user) return { error: '用户不存在' };
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    return { ok: true };
  },

  resetPassword(username) {
    if (!db) return { error: '数据库不可用' };
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!user) return { error: '用户不存在' };
    const newPassword = crypto.randomBytes(6).toString('hex'); // 12 位随机密码
    const hash = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    return { ok: true, password: newPassword };
  },
};

/* ========== 站点统计 ========== */

const statsOps = {
  recordVisit(path_, referrer, userAgent, ip) {
    if (!db) return;
    const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16) : '';
    db.prepare('INSERT INTO page_visits (path, referrer, user_agent, ip_hash) VALUES (?,?,?,?)')
      .run(path_ || '/', referrer || '', userAgent || '', ipHash);
  },

  getDashboard() {
    if (!db) return { totalVisits: 0, todayVisits: 0, topPages: [] };
    const totalVisits = db.prepare('SELECT COUNT(*) as c FROM page_visits').get().c;
    const todayVisits = db.prepare("SELECT COUNT(*) as c FROM page_visits WHERE date(visited_at) = date('now','localtime')").get().c;
    const topPages = db.prepare(`
      SELECT path, COUNT(*) as c FROM page_visits
      GROUP BY path ORDER BY c DESC LIMIT 10
    `).all();
    const recentVisits = db.prepare(`
      SELECT path, visited_at FROM page_visits ORDER BY visited_at DESC LIMIT 20
    `).all();
    return { totalVisits, todayVisits, topPages, recentVisits };
  },

  getDailyStats(days = 30) {
    if (!db) return [];
    return db.prepare(`
      SELECT date(visited_at) as day, COUNT(*) as c FROM page_visits
      WHERE visited_at >= date('now','localtime','-' || ? || ' days')
      GROUP BY day ORDER BY day
    `).all(days);
  },
};

/* ========== 设置操作（DB + config.ts 双写） ========== */

const settingsOps = {
  get(key) {
    if (!db) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  },

  set(key, value) {
    if (!db) return;
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now","localtime"))')
      .run(key, json);
  },

  getAll() {
    if (!db) return {};
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    for (const r of rows) {
      try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; }
    }
    return obj;
  },
};

/* ========== 初始化 ========== */

initTables();

module.exports = {
  db,
  userOps,
  statsOps,
  settingsOps,
  hashPassword,
  verifyPassword,
  generateToken,
};
