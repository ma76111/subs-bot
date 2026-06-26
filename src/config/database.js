const Database = require('./sqlite-compat');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './database.sqlite';
const db = new Database(path.resolve(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      full_name TEXT,
      balance REAL DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '📦',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'subscription',
      duration TEXT,
      duration_days INTEGER,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS service_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      is_required INTEGER DEFAULT 1,
      placeholder TEXT,
      help_text TEXT,
      min_length INTEGER,
      max_length INTEGER,
      options TEXT,
      regex_pattern TEXT,
      default_value TEXT,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      field_data TEXT,
      admin_note TEXT,
      delivery_details TEXT,
      subscription_start TEXT,
      subscription_end TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS order_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS charge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      photo_file_id TEXT,
      status TEXT DEFAULT 'pending',
      admin_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS payment_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      number TEXT NOT NULL,
      owner_name TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_replied INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migrations for existing databases
  const migrations = [
    `ALTER TABLE services ADD COLUMN service_type TEXT NOT NULL DEFAULT 'subscription'`,
    `ALTER TABLE services ADD COLUMN duration_days INTEGER`,
    `ALTER TABLE orders ADD COLUMN delivery_details TEXT`,
    `ALTER TABLE orders ADD COLUMN subscription_start TEXT`,
    `ALTER TABLE orders ADD COLUMN subscription_end TEXT`,
    `CREATE TABLE IF NOT EXISTS order_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS order_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch {} // ignore "already exists" or "duplicate column"
  }

  // Default settings
  const defaultSettings = {
    'bot_welcome_message': 'مرحباً بك في متجرنا الرقمي! 🎉',
    'bot_name': 'متجر الاشتراكات الرقمية',
    'support_username': '@support',
    'currency': 'جنيه مصري',
    'min_charge': '50',
  };

  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value);
  }

  // Default categories
  const countCats = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (countCats.c === 0) {
    db.exec(`
      INSERT INTO categories (name, icon, sort_order) VALUES ('إنتاجية', '💼', 1);
      INSERT INTO categories (name, icon, sort_order) VALUES ('تعليم', '📚', 2);
      INSERT INTO categories (name, icon, sort_order) VALUES ('ذكاء اصطناعي', '🤖', 3);
    `);

    // Sample services
    const catId = db.prepare('SELECT id FROM categories WHERE name = ?').get('إنتاجية');
    const eduId = db.prepare('SELECT id FROM categories WHERE name = ?').get('تعليم');
    const aiId = db.prepare('SELECT id FROM categories WHERE name = ?').get('ذكاء اصطناعي');

    db.prepare(`INSERT INTO services (category_id, name, description, price, duration) VALUES (?, ?, ?, ?, ?)`).run(catId.id, 'Canva Pro', 'اشتراك كانفا برو لمدة شهر كامل مع جميع المميزات', 150, 'شهر');
    db.prepare(`INSERT INTO services (category_id, name, description, price, duration) VALUES (?, ?, ?, ?, ?)`).run(eduId.id, 'Coursera Plus', 'اشتراك كورسيرا بلس - وصول غير محدود لجميع الدورات', 400, 'شهر');
    db.prepare(`INSERT INTO services (category_id, name, description, price, duration) VALUES (?, ?, ?, ?, ?)`).run(aiId.id, 'Gemini Advanced', 'اشتراك جيميني أدفانسد من جوجل', 200, 'شهر');
    db.prepare(`INSERT INTO services (category_id, name, description, price, duration) VALUES (?, ?, ?, ?, ?)`).run(aiId.id, 'ChatGPT Plus', 'اشتراك شات جي بي تي بلاس', 250, 'شهر');

    // Default fields for Canva Pro
    const canvaId = db.prepare('SELECT id FROM services WHERE name = ?').get('Canva Pro');
    db.prepare(`INSERT INTO service_fields (service_id, field_key, label, type, is_required, placeholder, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(canvaId.id, 'email', 'البريد الإلكتروني', 'email', 1, 'example@gmail.com', 1);
  }
}

module.exports = { db, initDatabase };
