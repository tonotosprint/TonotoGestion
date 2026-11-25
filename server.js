const { createServer } = require("node:http");
const { createServer: createHttpsServer } = require("node:https");
const { DatabaseSync } = require("node:sqlite");
const { createHash, randomBytes, scryptSync, timingSafeEqual, X509Certificate } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } = require("node:fs");
const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const ExcelJS = require("exceljs");
const os = require("node:os");
const path = require("node:path");
const { industryTemplates } = require("./scripts/industry-product-catalog");

const dataDirectory = path.join(__dirname, "data");
const databasePath = process.env.DB_PATH || path.join(dataDirectory, "gestion.db");
const port = Number(process.env.PORT || 3000);
const httpsPort = Number(process.env.HTTPS_PORT || 3443);
const httpsPfxPath = path.resolve(__dirname, process.env.HTTPS_PFX_PATH || "data/tls/server.pfx");
const httpsCertificatePath = path.resolve(__dirname, process.env.HTTPS_CERT_PATH || "data/tls/server.cer");

if (!process.env.DB_PATH) mkdirSync(dataDirectory, { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, name)
  );
  CREATE TABLE IF NOT EXISTS user_branches (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, branch_id)
  );
  CREATE TABLE IF NOT EXISTS company_industries (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    industry TEXT NOT NULL,
    PRIMARY KEY (company_id, industry)
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    home_branch_id INTEGER REFERENCES branches(id),
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    access_role TEXT NOT NULL DEFAULT 'admin',
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS online_verifications (
    device_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verified_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS platform_sessions (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_audit_log (
    id INTEGER PRIMARY KEY,
    admin_email TEXT NOT NULL,
    action TEXT NOT NULL,
    company_id INTEGER,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS firebase_sync_jobs (
    company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    generation INTEGER NOT NULL DEFAULT 1,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS api_idempotency (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, operation_id)
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    sku TEXT NOT NULL,
    barcode TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
    bonus_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (bonus_basis_points BETWEEN 0 AND 10000),
    guild_discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (guild_discount_basis_points BETWEEN 0 AND 10000),
    profit_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (profit_basis_points BETWEEN -10000 AND 1000000),
    discounted_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (discounted_cost_cents >= 0),
    price_with_vat_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_with_vat_cents >= 0),
    price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    price2_cents INTEGER NOT NULL DEFAULT 0 CHECK (price2_cents >= 0),
    price3_cents INTEGER NOT NULL DEFAULT 0 CHECK (price3_cents >= 0),
    stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (stock_milli >= 0),
    stock_debt_milli INTEGER NOT NULL DEFAULT 0 CHECK (stock_debt_milli >= 0),
    minimum_stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock_milli >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, sku)
  );
  CREATE TABLE IF NOT EXISTS branch_stock (
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (stock_milli >= 0),
    stock_debt_milli INTEGER NOT NULL DEFAULT 0 CHECK (stock_debt_milli >= 0),
    minimum_stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock_milli >= 0),
    PRIMARY KEY (branch_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    from_branch_id INTEGER NOT NULL REFERENCES branches(id),
    to_branch_id INTEGER NOT NULL REFERENCES branches(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (from_branch_id <> to_branch_id)
  );
  CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY,
    transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    branch_id INTEGER REFERENCES branches(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'purchase')),
    sale_mode TEXT NOT NULL DEFAULT 'paid' CHECK (sale_mode IN ('paid', 'deposit', 'account')),
    number TEXT NOT NULL,
    contact TEXT NOT NULL,
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id),
    product_id INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000),
    price_tier INTEGER NOT NULL DEFAULT 1 CHECK (price_tier BETWEEN 1 AND 3),
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0)
  );
  CREATE TABLE IF NOT EXISTS transaction_documents (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    content BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transaction_payments (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('cash', 'debit', 'credit', 'transfer', 'other')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    UNIQUE (transaction_id, method)
  );
  CREATE TABLE IF NOT EXISTS customer_account_payments (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    cash_session_id INTEGER REFERENCES cash_register_sessions(id),
    method TEXT NOT NULL CHECK (method IN ('cash', 'debit', 'credit', 'transfer', 'other')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transaction_sequences (
    company_id INTEGER NOT NULL REFERENCES companies(id),
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'purchase')),
    last_number INTEGER NOT NULL CHECK (last_number >= 0),
    PRIMARY KEY (company_id, kind)
  );
  CREATE TABLE IF NOT EXISTS transaction_reusable_numbers (
    company_id INTEGER NOT NULL REFERENCES companies(id),
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'purchase')),
    receipt_number INTEGER NOT NULL CHECK (receipt_number > 0),
    PRIMARY KEY (company_id, kind, receipt_number)
  );
  CREATE TABLE IF NOT EXISTS transaction_stock_effects (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    PRIMARY KEY (transaction_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS company_receipt_settings (
    company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL DEFAULT '',
    legal_name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    gross_income TEXT NOT NULL DEFAULT '',
    vat_condition TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    activity_start TEXT NOT NULL DEFAULT '',
    point_of_sale TEXT NOT NULL DEFAULT '0001',
    receipt_title TEXT NOT NULL DEFAULT 'RECIBO',
    receipt_format TEXT NOT NULL DEFAULT 'a4' CHECK (receipt_format IN ('a4', 'ticket')),
    logo_data_uri TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    UNIQUE (company_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS recipe_components (
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    PRIMARY KEY (recipe_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    branch_id INTEGER REFERENCES branches(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    number TEXT NOT NULL,
    contact TEXT NOT NULL,
    contact_tax_id TEXT NOT NULL DEFAULT '',
    contact_vat_condition TEXT NOT NULL DEFAULT 'Consumidor final',
    contact_address TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    general_discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (general_discount_basis_points BETWEEN 0 AND 10000),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    valid_until TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'cancelled')),
    sale_transaction_id INTEGER REFERENCES transactions(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, number)
  );
  CREATE TABLE IF NOT EXISTS quote_items (
    id INTEGER PRIMARY KEY,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000),
    price_tier INTEGER NOT NULL DEFAULT 1 CHECK (price_tier BETWEEN 1 AND 3),
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0)
  );
  CREATE TABLE IF NOT EXISTS quote_sequences (
    company_id INTEGER PRIMARY KEY REFERENCES companies(id),
    last_number INTEGER NOT NULL CHECK (last_number >= 0)
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    tax_id TEXT NOT NULL DEFAULT '',
    vat_condition TEXT NOT NULL DEFAULT 'Consumidor final',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_customers_company_active ON customers(company_id, active, name);
  CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    branch_id INTEGER REFERENCES branches(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id),
    number TEXT NOT NULL,
    contact TEXT NOT NULL,
    contact_tax_id TEXT NOT NULL DEFAULT '',
    contact_vat_condition TEXT NOT NULL DEFAULT 'Consumidor final',
    contact_address TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    general_discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (general_discount_basis_points BETWEEN 0 AND 10000),
    total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'cancelled')),
    transaction_id INTEGER REFERENCES transactions(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, number)
  );
  CREATE TABLE IF NOT EXISTS sales_order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000),
    price_tier INTEGER NOT NULL DEFAULT 1 CHECK (price_tier BETWEEN 1 AND 3),
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0)
  );
  CREATE TABLE IF NOT EXISTS sales_order_sequences (
    company_id INTEGER PRIMARY KEY REFERENCES companies(id),
    last_number INTEGER NOT NULL CHECK (last_number >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_sales_orders_company_date ON sales_orders(company_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS cash_register_sessions (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    branch_id INTEGER REFERENCES branches(id),
    opened_by INTEGER NOT NULL REFERENCES users(id),
    opening_amount_cents INTEGER NOT NULL CHECK (opening_amount_cents >= 0),
    opening_note TEXT NOT NULL DEFAULT '',
    opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_by INTEGER REFERENCES users(id),
    closing_amount_cents INTEGER CHECK (closing_amount_cents >= 0),
    closing_note TEXT NOT NULL DEFAULT '',
    closing_difference_cents INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cash_sessions_company_open ON cash_register_sessions(company_id, closed_at);
  CREATE TABLE IF NOT EXISTS cash_register_movements (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES cash_register_sessions(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
    method TEXT NOT NULL CHECK (method IN ('cash', 'debit', 'credit', 'transfer', 'other')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_products_company_active ON products(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_transactions_company_date ON transactions(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_items_transaction ON transaction_items(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_quotes_company_date ON quotes(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_company_date ON audit_log(company_id, created_at DESC);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

  function writeAudit(user, action, entity, entityId = "", details = "") {
    db.prepare(`
      INSERT INTO audit_log (company_id, user_email, action, entity, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(user.company_id, user.username, action, entity, String(entityId), String(details).slice(0, 500));
  }

  function requireAdmin(user) {
    if (user.access_role !== "admin") {
      throw Object.assign(new Error("Esta función requiere permisos de administrador."), { status: 403 });
    }
  }

  function requireRoles(user, ...roles) {
    if (!roles.includes(user.access_role)) {
      throw Object.assign(new Error("Tu perfil no tiene permiso para realizar esta operación."), { status: 403 });
    }
  }

  function requestBytes(request, maxBytes) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      request.on("data", (chunk) => {
        if (tooLarge) return;
        size += chunk.length;
        if (size > maxBytes) {
          tooLarge = true;
          reject(Object.assign(new Error("El archivo es demasiado grande."), { status: 413 }));
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (!tooLarge) resolve(Buffer.concat(chunks));
      });
      request.on("error", reject);
    });
  }

  function csvCell(value, protectFormula = false) {
    const rawText = String(value ?? "");
    const text = protectFormula && /^[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          cell += character;
        }
      } else if (character === '"' && cell === "") {
        quoted = true;
      } else if (character === ",") {
        row.push(cell);
        cell = "";
      } else if (character === "\n") {
        row.push(cell.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += character;
      }
    }
    if (quoted) throw Object.assign(new Error("El CSV tiene comillas sin cerrar."), { status: 400 });
    if (cell || row.length) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
    }
    return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
  }

  async function parseXlsx(bytes) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      const worksheet = workbook.worksheets.find((sheet) => sheet.state === "visible");
      if (!worksheet) throw new Error("El archivo no contiene una hoja visible.");
      const headers = Array.from(
        worksheet.getRow(1).values.slice(1),
        (value) => String(value ?? "").trim().toLowerCase()
      );
      const rows = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        rows.push(Array.from(row.values.slice(1), (value, index) => {
          if (headers[index] === "barcode") return row.getCell(index + 1).text || "";
          if (value === null || value === undefined) return "";
          if (typeof value === "object") {
            if (value instanceof Date) return value.toISOString();
            if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
            if ("result" in value) return String(value.result ?? "");
            if ("text" in value) return String(value.text);
            return "";
          }
          return String(value);
        }));
      });
      return rows;
    } catch (error) {
      throw Object.assign(new Error(`No se pudo leer el Excel (.xlsx): ${error.message}`), { status: 400 });
    }
  }

  function databaseBackup() {
    return db.serialize();
  }

  function restoreDatabase(bytes, currentUser) {
    const temporaryPath = path.join(os.tmpdir(), `gestion-restore-${randomBytes(12).toString("hex")}.db`);
    const automaticBackupPath = `${databasePath}.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
    const tables = [
      "companies", "branches", "company_industries", "users", "user_branches", "products", "branch_stock", "customers", "transactions", "transaction_items", "transaction_payments",
      "customer_account_payments", "cash_register_sessions", "cash_register_movements",
      "transaction_documents", "transaction_sequences", "transaction_reusable_numbers", "transaction_stock_effects",
      "stock_transfers", "stock_transfer_items", "company_receipt_settings", "recipes", "recipe_components", "quotes", "quote_items",
      "quote_sequences", "sales_orders", "sales_order_items", "sales_order_sequences", "audit_log"
    ];
    let source;
    try {
      writeFileSync(temporaryPath, bytes, { flag: "wx" });
      source = new DatabaseSync(temporaryPath, { readOnly: true });
      let integrity;
      try {
        integrity = source.prepare("PRAGMA integrity_check").get().integrity_check;
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 26) {
          throw Object.assign(new Error("El archivo seleccionado no es una copia SQLite válida."), { status: 400 });
        }
        throw error;
      }
      if (integrity !== "ok") {
        throw Object.assign(new Error("La copia está dañada y no se puede restaurar."), { status: 400 });
      }
      const sourceTables = new Set(source.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      ).all().map((entry) => entry.name));
      const sourceColumns = new Map();
      const optionalTables = new Set([
        "transaction_documents", "customer_account_payments", "cash_register_movements",
        "company_industries", "customers", "cash_register_sessions", "quotes", "quote_items", "quote_sequences",
        "sales_orders", "sales_order_items", "sales_order_sequences", "branches", "user_branches",
        "branch_stock", "stock_transfers", "stock_transfer_items"
      ]);
      for (const table of tables) {
        if (!sourceTables.has(table)) {
          if (optionalTables.has(table)) {
            sourceColumns.set(table, new Set());
            continue;
          }
          throw Object.assign(new Error("La copia no pertenece a una versión compatible de la aplicación."), { status: 400 });
        }
        const expected = db.prepare(`PRAGMA table_info(${table})`).all().map((entry) => entry.name);
        const available = source.prepare(`PRAGMA table_info(${table})`).all().map((entry) => entry.name);
        sourceColumns.set(table, new Set(available));
        const optionalProductColumns = [
          "brand", "bonus_basis_points", "guild_discount_basis_points", "profit_basis_points",
          "discounted_cost_cents", "price_with_vat_cents", "price2_cents", "price3_cents"
        ];
        const optionalCompanyColumns = ["subscription_status", "subscription_state", "subscription_plan", "subscription_until"];
        const optionalUserColumns = ["display_name", "home_branch_id"];
        const optionalTransactionColumns = ["sale_mode", "salesperson_user_id", "salesperson_name", "branch_id"];
        const optionalSalesOrderColumns = ["created_by_name", "branch_id"];
        const optionalQuoteColumns = ["created_by_name", "branch_id"];
        const optionalReceiptColumns = ["receipt_format"];
        const optionalCashColumns = ["opening_note", "closing_note", "closing_difference_cents", "branch_id"];
        if (expected.some((column) => !available.includes(column) &&
          !(table === "products" && optionalProductColumns.includes(column)) &&
          !(table === "companies" && optionalCompanyColumns.includes(column)) &&
          !(table === "users" && optionalUserColumns.includes(column)) &&
          !(table === "transactions" && optionalTransactionColumns.includes(column)) &&
          !(table === "company_receipt_settings" && optionalReceiptColumns.includes(column)) &&
          !(table === "cash_register_sessions" && optionalCashColumns.includes(column)) &&
          !(table === "sales_orders" && optionalSalesOrderColumns.includes(column)) &&
          !(table === "quotes" && optionalQuoteColumns.includes(column)) &&
          !(table === "transaction_items" && column === "price_tier"))) {
          throw Object.assign(new Error("La copia no contiene todas las columnas necesarias para esta versión."), { status: 400 });
        }
      }
      if (!source.prepare("SELECT 1 FROM companies LIMIT 1").get() ||
          source.prepare("PRAGMA foreign_key_check").all().length) {
        throw Object.assign(new Error("La copia no contiene datos íntegros de una empresa."), { status: 400 });
      }
      writeFileSync(automaticBackupPath, databaseBackup(), { flag: "wx" });
      source.close();
      source = null;
      db.exec(`ATTACH DATABASE '${temporaryPath.replace(/'/g, "''")}' AS restore_source`);
      try {
        beginTransaction(() => {
          db.exec("PRAGMA defer_foreign_keys = ON");
          for (const table of [...tables].reverse()) db.exec(`DELETE FROM main.${table}`);
          for (const table of tables) {
            if (!sourceColumns.get(table).size) continue;
            const columns = db.prepare(`PRAGMA table_info(${table})`).all()
              .map((entry) => entry.name)
              .filter((column) => (column !== "id" || table !== "sessions") && sourceColumns.get(table).has(column));
            const safeColumns = columns.map((column) => `"${column}"`).join(", ");
            db.exec(`INSERT INTO main.${table} (${safeColumns}) SELECT ${safeColumns} FROM restore_source.${table}`);
            if (table === "products" && !sourceColumns.get(table).has("profit_basis_points")) {
              db.exec(`
                UPDATE main.products SET profit_basis_points = CASE
                  WHEN ROUND(ROUND(cost_cents * (10000 - bonus_basis_points) / 10000.0) * 121 / 100.0) > 0
                  THEN MAX(0, ROUND(
                    price_cents * 10000.0 /
                    ROUND(ROUND(cost_cents * (10000 - bonus_basis_points) / 10000.0) * 121 / 100.0) - 10000
                  ))
                  ELSE 0
                END
              `);
            }
            if (table === "products" && !sourceColumns.get(table).has("discounted_cost_cents")) {
              db.exec(`
                UPDATE main.products SET discounted_cost_cents =
                  ROUND(cost_cents * (10000 - bonus_basis_points) / 10000.0)
              `);
            }
            if (table === "products" && !sourceColumns.get(table).has("price_with_vat_cents")) {
              db.exec(`
                UPDATE main.products SET price_with_vat_cents =
                  ROUND(discounted_cost_cents * 121 / 100.0)
              `);
            }
            if (table === "products" && !sourceColumns.get(table).has("price2_cents")) {
              db.exec("UPDATE main.products SET price2_cents = price_cents");
            }
            if (table === "products" && !sourceColumns.get(table).has("price3_cents")) {
              db.exec("UPDATE main.products SET price3_cents = price_cents");
            }
            if (table === "users" && !sourceColumns.get(table).has("display_name")) {
              db.exec("UPDATE main.users SET display_name = username WHERE display_name = ''");
            }
            if (table === "companies" && !sourceColumns.get(table).has("subscription_state")) {
              db.exec(`
                UPDATE main.companies
                SET subscription_state = CASE WHEN subscription_status = 'suspended' THEN 'suspended' ELSE 'active' END
              `);
            }
            if (table === "transactions" && !sourceColumns.get(table).has("salesperson_user_id")) {
              db.exec(`
                UPDATE main.transactions SET salesperson_user_id = user_id,
                  salesperson_name = COALESCE((SELECT display_name FROM main.users WHERE main.users.id = main.transactions.user_id), '')
              `);
            }
            if (table === "sales_orders" && !sourceColumns.get(table).has("created_by_name")) {
              db.exec(`
                UPDATE main.sales_orders SET created_by_name =
                  COALESCE((SELECT display_name FROM main.users WHERE main.users.id = main.sales_orders.user_id), '')
              `);
            }
            if (table === "quotes" && !sourceColumns.get(table).has("created_by_name")) {
              db.exec(`
                UPDATE main.quotes SET created_by_name =
                  COALESCE((SELECT display_name FROM main.users WHERE main.users.id = main.quotes.user_id), '')
              `);
            }
          }
          db.exec(`
            INSERT INTO main.branches (company_id, name)
            SELECT companies.id, 'Casa Central' FROM main.companies
            WHERE NOT EXISTS (SELECT 1 FROM main.branches WHERE branches.company_id = companies.id);
            UPDATE main.users SET home_branch_id = (
              SELECT branches.id FROM main.branches
              WHERE branches.company_id = users.company_id ORDER BY branches.id LIMIT 1
            ) WHERE home_branch_id IS NULL;
            INSERT OR IGNORE INTO main.user_branches (user_id, branch_id)
            SELECT id, home_branch_id FROM main.users WHERE home_branch_id IS NOT NULL;
            INSERT OR IGNORE INTO main.branch_stock (
              branch_id, product_id, stock_milli, stock_debt_milli, minimum_stock_milli
            )
            SELECT branches.id, products.id,
              CASE WHEN branches.id = (SELECT MIN(b.id) FROM main.branches b WHERE b.company_id = products.company_id)
                THEN products.stock_milli ELSE 0 END,
              CASE WHEN branches.id = (SELECT MIN(b.id) FROM main.branches b WHERE b.company_id = products.company_id)
                THEN products.stock_debt_milli ELSE 0 END,
              CASE WHEN branches.id = (SELECT MIN(b.id) FROM main.branches b WHERE b.company_id = products.company_id)
                THEN products.minimum_stock_milli ELSE 0 END
            FROM main.products JOIN main.branches ON branches.company_id = products.company_id;
            UPDATE main.transactions SET branch_id = (
              SELECT branches.id FROM main.branches WHERE branches.company_id = transactions.company_id
              ORDER BY branches.id LIMIT 1
            ) WHERE branch_id IS NULL;
            UPDATE main.sales_orders SET branch_id = (
              SELECT branches.id FROM main.branches WHERE branches.company_id = sales_orders.company_id
              ORDER BY branches.id LIMIT 1
            ) WHERE branch_id IS NULL;
            UPDATE main.quotes SET branch_id = (
              SELECT branches.id FROM main.branches WHERE branches.company_id = quotes.company_id
              ORDER BY branches.id LIMIT 1
            ) WHERE branch_id IS NULL;
            UPDATE main.cash_register_sessions SET branch_id = (
              SELECT branches.id FROM main.branches WHERE branches.company_id = cash_register_sessions.company_id
              ORDER BY branches.id LIMIT 1
            ) WHERE branch_id IS NULL;
          `);
          db.exec("DELETE FROM main.sessions");
          const restoredCompanyId = db.prepare("SELECT id FROM main.companies LIMIT 1").get()?.id;
          if (!restoredCompanyId) throw Object.assign(new Error("La copia no contiene una empresa."), { status: 400 });
          db.prepare(`
            INSERT INTO main.audit_log (company_id, user_email, action, entity, details)
            VALUES (?, ?, 'restore', 'backup', ?)
          `).run(restoredCompanyId, currentUser.email, `Copia restaurada; respaldo preventivo: ${path.basename(automaticBackupPath)}`);
        });
      } finally {
        db.exec("DETACH DATABASE restore_source");
      }
      for (const company of db.prepare("SELECT id FROM companies").all()) {
        enqueueFirebaseSync(company.id);
      }
      return automaticBackupPath;
    } catch (error) {
      if (source) source.close();
      try { unlinkSync(temporaryPath); } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") throw cleanupError;
      }
      throw error;
    } finally {
      try { unlinkSync(temporaryPath); } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 1 CHECK (is_admin IN (0, 1))");
const usersHadAccessRole = db.prepare("PRAGMA table_info(users)").all()
  .some((entry) => entry.name === "access_role");
ensureColumn("users", "username", "TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "access_role", "TEXT NOT NULL DEFAULT 'admin'");
ensureColumn("users", "display_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "home_branch_id", "INTEGER REFERENCES branches(id)");
if (!usersHadAccessRole) {
  db.prepare("UPDATE users SET access_role = CASE WHEN is_admin = 1 THEN 'admin' ELSE 'manager' END").run();
}
const occupiedUsernames = new Set();
for (const account of db.prepare("SELECT id, email, username FROM users ORDER BY id").all()) {
  let username = account.username;
  if (!username) {
    username = String(account.email).split("@")[0].toLowerCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._-]/g, "")
      .slice(0, 24);
    if (username.length < 3) username = `usuario${account.id}`;
  }
  if (occupiedUsernames.has(username.toLowerCase())) {
    const base = username.slice(0, 24);
    username = `${base}-${account.id}`;
    let suffix = 2;
    while (occupiedUsernames.has(username.toLowerCase())) {
      username = `${base}-${account.id}-${suffix}`;
      suffix += 1;
    }
  }
  occupiedUsernames.add(username.toLowerCase());
  db.prepare("UPDATE users SET username = ?, is_admin = CASE WHEN access_role = 'admin' THEN 1 ELSE 0 END WHERE id = ?")
    .run(username, account.id);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username COLLATE NOCASE)");
ensureColumn("firebase_sync_jobs", "generation", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("companies", "subscription_status", "TEXT NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'suspended'))");
ensureColumn("companies", "subscription_state", "TEXT NOT NULL DEFAULT 'active' CHECK (subscription_state IN ('active', 'suspended', 'cancelled'))");
ensureColumn("companies", "subscription_plan", "TEXT NOT NULL DEFAULT 'standard'");
ensureColumn("companies", "subscription_until", "TEXT NOT NULL DEFAULT ''");
db.prepare(`
  INSERT INTO branches (company_id, name)
  SELECT companies.id, 'Casa Central' FROM companies
  WHERE NOT EXISTS (SELECT 1 FROM branches WHERE branches.company_id = companies.id)
`).run();
db.exec(`
  UPDATE users SET home_branch_id = (
    SELECT branches.id FROM branches WHERE branches.company_id = users.company_id
    ORDER BY branches.id LIMIT 1
  ) WHERE home_branch_id IS NULL;
  INSERT OR IGNORE INTO user_branches (user_id, branch_id)
  SELECT id, home_branch_id FROM users WHERE home_branch_id IS NOT NULL;
`);
db.exec(`
  UPDATE users SET display_name = username WHERE TRIM(display_name) = '';
  UPDATE companies SET subscription_state = subscription_status
  WHERE subscription_status IN ('active', 'suspended') AND subscription_state = 'active'
    AND subscription_status <> 'active';
`);
ensureColumn("products", "barcode", "TEXT NOT NULL DEFAULT ''");
ensureColumn("products", "brand", "TEXT NOT NULL DEFAULT ''");
ensureColumn("products", "bonus_basis_points", "INTEGER NOT NULL DEFAULT 0 CHECK (bonus_basis_points BETWEEN 0 AND 10000)");
ensureColumn("products", "guild_discount_basis_points", "INTEGER NOT NULL DEFAULT 0 CHECK (guild_discount_basis_points BETWEEN 0 AND 10000)");
const productsHadProfitBasisPoints = db.prepare("PRAGMA table_info(products)").all()
  .some((entry) => entry.name === "profit_basis_points");
ensureColumn("products", "profit_basis_points", "INTEGER NOT NULL DEFAULT 0 CHECK (profit_basis_points BETWEEN -10000 AND 1000000)");
if (!productsHadProfitBasisPoints) {
  db.exec(`
    UPDATE products SET profit_basis_points = CASE
      WHEN ROUND(ROUND(cost_cents * (10000 - bonus_basis_points) / 10000.0) * 121 / 100.0) > 0
      THEN MAX(0, ROUND(
        price_cents * 10000.0 /
        ROUND(ROUND(cost_cents * (10000 - bonus_basis_points) / 10000.0) * 121 / 100.0) - 10000
      ))
      ELSE 0
    END
  `);
}
const productColumnsBeforeCalculatedPrices = new Set(
  db.prepare("PRAGMA table_info(products)").all().map((entry) => entry.name)
);
ensureColumn("products", "discounted_cost_cents", "INTEGER NOT NULL DEFAULT 0 CHECK (discounted_cost_cents >= 0)");
ensureColumn("products", "price_with_vat_cents", "INTEGER NOT NULL DEFAULT 0 CHECK (price_with_vat_cents >= 0)");
if (!productColumnsBeforeCalculatedPrices.has("discounted_cost_cents")) {
  db.exec(`
    UPDATE products SET discounted_cost_cents =
      ROUND(cost_cents * (10000 - bonus_basis_points) / 10000.0)
  `);
}
if (!productColumnsBeforeCalculatedPrices.has("price_with_vat_cents")) {
  db.exec(`
    UPDATE products SET price_with_vat_cents =
      ROUND(discounted_cost_cents * 121 / 100.0)
  `);
}
const productPriceColumns = new Set(db.prepare("PRAGMA table_info(products)").all().map((entry) => entry.name));
ensureColumn("products", "price2_cents", "INTEGER NOT NULL DEFAULT 0 CHECK (price2_cents >= 0)");
ensureColumn("products", "price3_cents", "INTEGER NOT NULL DEFAULT 0 CHECK (price3_cents >= 0)");
if (!productPriceColumns.has("price2_cents")) db.exec("UPDATE products SET price2_cents = price_cents");
if (!productPriceColumns.has("price3_cents")) db.exec("UPDATE products SET price3_cents = price_cents");
ensureColumn("products", "stock_debt_milli", "INTEGER NOT NULL DEFAULT 0 CHECK (stock_debt_milli >= 0)");
db.exec(`
  INSERT OR IGNORE INTO branch_stock (branch_id, product_id, stock_milli, stock_debt_milli, minimum_stock_milli)
  SELECT branches.id, products.id, products.stock_milli, products.stock_debt_milli, products.minimum_stock_milli
  FROM products JOIN branches ON branches.company_id = products.company_id
  WHERE branches.id = (SELECT MIN(b.id) FROM branches b WHERE b.company_id = products.company_id);
`);
ensureColumn("transaction_items", "discount_basis_points", "INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000)");
const transactionItemColumns = db.prepare("PRAGMA table_info(transaction_items)").all();
if (transactionItemColumns.some((entry) => entry.name === "product_id" && entry.notnull) ||
    !transactionItemColumns.some((entry) => entry.name === "price_tier")) {
  db.exec(`
    CREATE TABLE transaction_items_new (
      id INTEGER PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000),
      price_tier INTEGER NOT NULL DEFAULT 1 CHECK (price_tier BETWEEN 1 AND 3),
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0)
    );
    INSERT INTO transaction_items_new
      (id, transaction_id, product_id, product_name, sku, quantity_milli, unit_price_cents, discount_basis_points, subtotal_cents)
    SELECT id, transaction_id, product_id, product_name, sku, quantity_milli, unit_price_cents, discount_basis_points, subtotal_cents
    FROM transaction_items;
    DROP TABLE transaction_items;
    ALTER TABLE transaction_items_new RENAME TO transaction_items;
    CREATE INDEX IF NOT EXISTS idx_items_transaction ON transaction_items(transaction_id);
  `);
} else {
  ensureColumn("transaction_items", "price_tier", "INTEGER NOT NULL DEFAULT 1 CHECK (price_tier BETWEEN 1 AND 3)");
}
ensureColumn("transactions", "general_discount_basis_points", "INTEGER NOT NULL DEFAULT 0 CHECK (general_discount_basis_points BETWEEN 0 AND 10000)");
ensureColumn("transactions", "contact_tax_id", "TEXT NOT NULL DEFAULT ''");
ensureColumn("transactions", "contact_vat_condition", "TEXT NOT NULL DEFAULT 'Consumidor final'");
ensureColumn("transactions", "contact_address", "TEXT NOT NULL DEFAULT ''");
ensureColumn("transactions", "contact_phone", "TEXT NOT NULL DEFAULT ''");
ensureColumn("transactions", "contact_email", "TEXT NOT NULL DEFAULT ''");
ensureColumn("transactions", "customer_id", "INTEGER REFERENCES customers(id)");
ensureColumn("transactions", "cash_session_id", "INTEGER REFERENCES cash_register_sessions(id)");
ensureColumn("transactions", "sale_mode", "TEXT NOT NULL DEFAULT 'paid'");
ensureColumn("transactions", "branch_id", "INTEGER REFERENCES branches(id)");
ensureColumn("sales_orders", "branch_id", "INTEGER REFERENCES branches(id)");
ensureColumn("quotes", "branch_id", "INTEGER REFERENCES branches(id)");
ensureColumn("cash_register_sessions", "branch_id", "INTEGER REFERENCES branches(id)");
db.exec(`
  UPDATE transactions SET branch_id = (
    SELECT branches.id FROM branches WHERE branches.company_id = transactions.company_id
    ORDER BY branches.id LIMIT 1
  ) WHERE branch_id IS NULL;
  UPDATE sales_orders SET branch_id = (
    SELECT branches.id FROM branches WHERE branches.company_id = sales_orders.company_id
    ORDER BY branches.id LIMIT 1
  ) WHERE branch_id IS NULL;
  UPDATE quotes SET branch_id = (
    SELECT branches.id FROM branches WHERE branches.company_id = quotes.company_id
    ORDER BY branches.id LIMIT 1
  ) WHERE branch_id IS NULL;
  UPDATE cash_register_sessions SET branch_id = (
    SELECT branches.id FROM branches WHERE branches.company_id = cash_register_sessions.company_id
    ORDER BY branches.id LIMIT 1
  ) WHERE branch_id IS NULL;
`);
ensureColumn("cash_register_sessions", "opening_note", "TEXT NOT NULL DEFAULT ''");
ensureColumn("cash_register_sessions", "closing_note", "TEXT NOT NULL DEFAULT ''");
ensureColumn("cash_register_sessions", "closing_difference_cents", "INTEGER NOT NULL DEFAULT 0");
db.exec(`
  INSERT INTO cash_register_sessions (company_id, branch_id, opened_by, opening_amount_cents)
  SELECT companies.id, branches.id, COALESCE(MIN(CASE WHEN users.access_role = 'admin' THEN users.id END), MIN(users.id)), 0
  FROM companies JOIN users ON users.company_id = companies.id
  JOIN branches ON branches.company_id = companies.id AND branches.id = (
    SELECT MIN(branch.id) FROM branches branch WHERE branch.company_id = companies.id
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM cash_register_sessions sessions WHERE sessions.company_id = companies.id
  )
  GROUP BY companies.id
`);
ensureColumn("company_receipt_settings", "receipt_format", "TEXT NOT NULL DEFAULT 'a4'");
ensureColumn("transactions", "salesperson_user_id", "INTEGER");
ensureColumn("transactions", "salesperson_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sales_orders", "created_by_name", "TEXT NOT NULL DEFAULT ''");
ensureColumn("quotes", "created_by_name", "TEXT NOT NULL DEFAULT ''");
db.exec(`
  UPDATE transactions
  SET salesperson_user_id = user_id,
      salesperson_name = COALESCE(NULLIF(salesperson_name, ''), (
        SELECT display_name FROM users WHERE users.id = transactions.user_id
      ))
  WHERE salesperson_user_id IS NULL OR salesperson_name = '';
  UPDATE sales_orders
  SET created_by_name = (SELECT display_name FROM users WHERE users.id = sales_orders.user_id)
  WHERE created_by_name = '';
  UPDATE quotes
  SET created_by_name = (SELECT display_name FROM users WHERE users.id = quotes.user_id)
  WHERE created_by_name = '';
`);
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_products_company_barcode
    ON products(company_id, barcode) WHERE barcode <> '';
  INSERT INTO transaction_sequences (company_id, kind, last_number)
  SELECT company_id, kind, MAX(CAST(SUBSTR(number, 3) AS INTEGER))
  FROM transactions GROUP BY company_id, kind
  ON CONFLICT (company_id, kind) DO NOTHING
;
  INSERT INTO company_receipt_settings (company_id, business_name, legal_name)
  SELECT id, name, name FROM companies WHERE true
  ON CONFLICT (company_id) DO NOTHING
`);

const dummyPasswordHash = scryptSync("not-a-real-password", Buffer.alloc(16, 7), 64);
const loginAttempts = new Map();
const platformLoginAttempts = new Map();
const sessionLifetimeSeconds = 8 * 60 * 60;
const platformSessionLifetimeSeconds = 12 * 60 * 60;
const onlineVerificationLifetimeMs = 72 * 60 * 60 * 1000;
const publicDirectory = path.join(__dirname, "public");
const releaseInfoPath = path.join(__dirname, ".tonotos-release-info.json");

function initializeFirebase() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "tonotogestion";
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credentialsConfigured = Boolean(serviceAccountJson || credentialsPath);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return getApps().find((app) => app.name === "[DEFAULT]") || initializeApp({ projectId });
  }
  if (credentialsPath && !serviceAccountJson && !existsSync(credentialsPath)) {
    const message = `Firebase sync is disabled because GOOGLE_APPLICATION_CREDENTIALS does not exist: ${credentialsPath}`;
    if (process.env.FIREBASE_SYNC_REQUIRED === "true") throw new Error(message);
    console.warn(`${message}. The application will continue using local storage.`);
    return null;
  }
  if (!credentialsConfigured && process.env.FIREBASE_SYNC_REQUIRED !== "true") {
    console.warn("Firebase sync is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.");
    return null;
  }
  if (serviceAccountJson) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
    }
    return initializeApp({ credential: cert(serviceAccount), projectId });
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

const firebaseApp = initializeFirebase();
const firestore = firebaseApp ? getFirestore(firebaseApp) : null;
const activeSyncs = new Map();
const companiesPendingDeletion = new Set();

function safeEqual(left, right) {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function passwordHash(password) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, savedHash) {
  const [saltHex, hashHex] = savedHash.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === 64 && safeEqual(scryptSync(password, Buffer.from(saltHex, "hex"), 64), expected);
}

function beginTransaction(operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function deleteCompanyData(companyId) {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((entry) => entry.name);
  const quoted = (identifier) => `"${identifier.replace(/"/g, '""')}"`;
  const ownedRows = new Map();
  const pendingRows = new Map();
  const deletionOrder = [];

  function addOwnedRows(table, rowIds) {
    if (!rowIds.length) return;
    if (!ownedRows.has(table)) {
      ownedRows.set(table, new Set());
      pendingRows.set(table, []);
      deletionOrder.push(table);
    }
    const owned = ownedRows.get(table);
    const pending = pendingRows.get(table);
    for (const rowId of rowIds) {
      if (owned.has(rowId)) continue;
      owned.add(rowId);
      pending.push(rowId);
    }
  }

  addOwnedRows("companies", [companyId]);
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quoted(table)})`).all();
    if (columns.some((column) => column.name === "company_id")) {
      addOwnedRows(table, db.prepare(`SELECT rowid AS rowId FROM ${quoted(table)} WHERE company_id = ?`).all(companyId)
        .map((row) => row.rowId));
    }
  }

  const processedRows = new Map();
  for (let index = 0; index < deletionOrder.length; index += 1) {
    const parentTable = deletionOrder[index];
    const owned = ownedRows.get(parentTable);
    const processed = processedRows.get(parentTable) || new Set();
    const pending = [...pendingRows.get(parentTable)].filter((rowId) => !processed.has(rowId));
    for (const rowId of pending) processed.add(rowId);
    processedRows.set(parentTable, processed);
    if (!pending.length) continue;

    for (const childTable of tables) {
      const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quoted(childTable)})`).all()
        .filter((foreignKey) => foreignKey.table === parentTable);
      const groups = new Map();
      for (const foreignKey of foreignKeys) {
        const group = groups.get(foreignKey.id) || [];
        group.push(foreignKey);
        groups.set(foreignKey.id, group);
      }
      for (const group of groups.values()) {
        const join = group.map((foreignKey) => {
          const parentColumn = foreignKey.to || db.prepare(`PRAGMA table_info(${quoted(parentTable)})`).all()
            .find((column) => column.pk)?.name;
          if (!parentColumn) throw new Error(`No se pudo identificar la clave de ${parentTable}.`);
          return `child.${quoted(foreignKey.from)} = parent.${quoted(parentColumn)}`;
        }).join(" AND ");
        for (let offset = 0; offset < pending.length; offset += 500) {
          const chunk = pending.slice(offset, offset + 500);
          if (chunk.some((rowId) => rowId === undefined || rowId === null)) {
            throw new Error(`Se encontró una clave vacía al eliminar datos de ${parentTable}.`);
          }
          const placeholders = chunk.map(() => "?").join(", ");
          const childRows = db.prepare(`
            SELECT DISTINCT child.rowid AS rowId
            FROM ${quoted(childTable)} AS child
            JOIN ${quoted(parentTable)} AS parent ON ${join}
            WHERE parent.rowid IN (${placeholders})
          `).all(...chunk).map((row) => row.rowId);
          addOwnedRows(childTable, childRows);
        }
      }
    }
  }

  db.exec("PRAGMA defer_foreign_keys = ON");
  for (const table of deletionOrder.reverse()) {
    const rowIds = [...ownedRows.get(table)];
    for (let offset = 0; offset < rowIds.length; offset += 500) {
      const chunk = rowIds.slice(offset, offset + 500);
      const placeholders = chunk.map(() => "?").join(", ");
      db.prepare(`DELETE FROM ${quoted(table)} WHERE rowid IN (${placeholders})`).run(...chunk);
    }
  }
}

function sendJson(response, status, payload, extraHeaders = {}) {
  if (response.tenantIdempotency && status >= 200 && status < 300) {
    db.prepare(`
      INSERT OR IGNORE INTO api_idempotency (user_id, operation_id, status_code, response_json)
      VALUES (?, ?, ?, ?)
    `).run(response.tenantIdempotency.userId, response.tenantIdempotency.operationId, status, JSON.stringify(payload));
  }
  if (response.tenantCompanyId && status >= 200 && status < 300) {
    enqueueFirebaseSync(response.tenantCompanyId);
    response.tenantSyncQueued = true;
  }
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function setSessionCookie(response, token, maxAge = sessionLifetimeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `gestion_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`
  );
}

function sessionUser(request) {
  let token = null;
  const match = request.headers.cookie?.match(/(?:^|;\s*)gestion_session=([a-f0-9]{64})(?:;|$)/);
  if (match) {
    token = match[1];
  } else {
    const authHeader = request.headers["authorization"];
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      token = authHeader.substring(7).trim();
    } else if (request.headers["x-session-token"]) {
      token = String(request.headers["x-session-token"]).trim();
    }
  }
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = db.prepare(`
    SELECT users.id, users.company_id, users.home_branch_id, users.username, users.display_name, users.email, users.is_admin,
      users.access_role, companies.name AS company_name,
      companies.subscription_state, companies.subscription_until,
      CASE WHEN companies.subscription_until <> '' AND
        companies.subscription_until < date('now', '-3 hours') THEN 1 ELSE 0 END AS subscription_expired
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    JOIN companies ON companies.id = users.company_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND companies.subscription_state = 'active'
  `).get(hashSessionToken(token), Math.floor(Date.now() / 1000));
  if (!session) return null;
  const requestedBranchId = request.headers["x-branch-id"];
  const branchId = requestedBranchId === undefined
    ? session.home_branch_id
    : Number(requestedBranchId);
  if (!Number.isSafeInteger(branchId) || branchId < 1) {
    throw Object.assign(new Error("Seleccioná una sucursal válida."), { status: 400 });
  }
  const branch = db.prepare(`
    SELECT id, name FROM branches
    WHERE id = ? AND company_id = ? AND active = 1
  `).get(branchId, session.company_id);
  if (!branch) {
    throw Object.assign(new Error("La sucursal seleccionada no existe o está inactiva."), { status: 403 });
  }
  if (!["admin", "manager"].includes(session.access_role) &&
      !db.prepare("SELECT 1 FROM user_branches WHERE user_id = ? AND branch_id = ?").get(session.id, branchId)) {
    throw Object.assign(new Error("Tu usuario no tiene acceso a esa sucursal."), { status: 403 });
  }
  return { ...session, branch_id: branch.id, branch_name: branch.name };
}

function listUserBranches(user) {
  const branches = db.prepare(`
    SELECT id, name FROM branches WHERE company_id = ? AND active = 1 ORDER BY name COLLATE NOCASE
  `).all(user.company_id);
  if (["admin", "manager"].includes(user.access_role)) return branches;
  return branches.filter((branch) => db.prepare(
    "SELECT 1 FROM user_branches WHERE user_id = ? AND branch_id = ?"
  ).get(user.id, branch.id));
}

function mainBranchId(companyId) {
  let branch = db.prepare("SELECT id FROM branches WHERE company_id = ? ORDER BY id LIMIT 1").get(companyId);
  if (!branch) {
    branch = { id: Number(db.prepare(
      "INSERT INTO branches (company_id, name) VALUES (?, 'Casa Central')"
    ).run(companyId).lastInsertRowid) };
  }
  return branch.id;
}

function assignUserBranch(userId, branchId) {
  db.prepare("UPDATE users SET home_branch_id = ? WHERE id = ?").run(branchId, userId);
  db.prepare("INSERT OR IGNORE INTO user_branches (user_id, branch_id) VALUES (?, ?)")
    .run(userId, branchId);
}

function platformAdminEmail() {
  return String(process.env.PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase();
}

function platformSession(request) {
  const token = request.headers.cookie?.match(/(?:^|;\s*)tonoto_platform_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  return db.prepare(`
    SELECT email FROM platform_sessions
    WHERE token_hash = ? AND expires_at > ?
  `).get(hashSessionToken(token), Math.floor(Date.now() / 1000)) || null;
}

function setPlatformSessionCookie(response, token, maxAge = platformSessionLifetimeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `tonoto_platform_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`
  );
}

function recordPlatformAction(admin, action, companyId, details) {
  db.prepare(`
    INSERT INTO platform_audit_log (admin_email, action, company_id, details)
    VALUES (?, ?, ?, ?)
  `).run(admin.email, action, companyId, String(details).slice(0, 500));
}

const tenantSnapshotQueries = [
  ["company_industries", "SELECT company_id, industry FROM company_industries WHERE company_id = ?", "company_id,industry"],
  ["branches", "SELECT * FROM branches WHERE company_id = ?", "id"],
  ["users", "SELECT id, company_id, home_branch_id, username, display_name, is_admin, access_role, created_at FROM users WHERE company_id = ?", "id"],
  ["user_branches", `SELECT user_branches.* FROM user_branches
    JOIN users ON users.id = user_branches.user_id WHERE users.company_id = ?`, "user_id,branch_id"],
  ["products", "SELECT * FROM products WHERE company_id = ?", "id"],
  ["branch_stock", `SELECT branch_stock.* FROM branch_stock
    JOIN branches ON branches.id = branch_stock.branch_id WHERE branches.company_id = ?`, "branch_id,product_id"],
  ["stock_transfers", "SELECT * FROM stock_transfers WHERE company_id = ?", "id"],
  ["stock_transfer_items", `SELECT items.* FROM stock_transfer_items items
    JOIN stock_transfers ON stock_transfers.id = items.transfer_id WHERE stock_transfers.company_id = ?`, "id"],
  ["transactions", "SELECT * FROM transactions WHERE company_id = ?", "id"],
  ["transaction_items", `SELECT items.* FROM transaction_items items
    JOIN transactions ON transactions.id = items.transaction_id WHERE transactions.company_id = ?`, "id"],
  ["transaction_payments", `SELECT payments.* FROM transaction_payments payments
    JOIN transactions ON transactions.id = payments.transaction_id WHERE transactions.company_id = ?`, "id"],
  ["customer_account_payments", "SELECT * FROM customer_account_payments WHERE company_id = ?", "id"],
  ["transaction_sequences", "SELECT kind, last_number FROM transaction_sequences WHERE company_id = ?", "kind"],
  ["transaction_reusable_numbers", "SELECT kind, receipt_number FROM transaction_reusable_numbers WHERE company_id = ?", "kind,receipt_number"],
  ["transaction_stock_effects", `SELECT effects.* FROM transaction_stock_effects effects
    JOIN transactions ON transactions.id = effects.transaction_id WHERE transactions.company_id = ?`, "transaction_id,product_id"],
  ["receipt_settings", "SELECT * FROM company_receipt_settings WHERE company_id = ?", "company_id"],
  ["recipes", "SELECT * FROM recipes WHERE company_id = ?", "id"],
  ["recipe_components", `SELECT components.* FROM recipe_components components
    JOIN recipes ON recipes.id = components.recipe_id WHERE recipes.company_id = ?`, "recipe_id,product_id"],
  ["quotes", "SELECT * FROM quotes WHERE company_id = ?", "id"],
  ["quote_items", `SELECT items.* FROM quote_items items
    JOIN quotes ON quotes.id = items.quote_id WHERE quotes.company_id = ?`, "id"],
  ["quote_sequences", "SELECT company_id, last_number FROM quote_sequences WHERE company_id = ?", "company_id"],
  ["customers", "SELECT * FROM customers WHERE company_id = ?", "id"],
  ["sales_orders", "SELECT * FROM sales_orders WHERE company_id = ?", "id"],
  ["sales_order_items", `SELECT items.* FROM sales_order_items items
    JOIN sales_orders ON sales_orders.id = items.order_id WHERE sales_orders.company_id = ?`, "id"],
  ["sales_order_sequences", "SELECT company_id, last_number FROM sales_order_sequences WHERE company_id = ?", "company_id"],
  ["cash_register_sessions", "SELECT * FROM cash_register_sessions WHERE company_id = ?", "id"],
  ["cash_register_movements", "SELECT * FROM cash_register_movements WHERE company_id = ?", "id"],
  ["audit_log", "SELECT * FROM audit_log WHERE company_id = ?", "id"]
];

function requestedCompanyIndustries(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > Object.keys(industryTemplates).length) {
    throw Object.assign(new Error("Elegí al menos un rubro para la empresa."), { status: 400 });
  }
  const industries = [...new Set(value)];
  if (industries.some((industry) => typeof industry !== "string" || !Object.hasOwn(industryTemplates, industry))) {
    throw Object.assign(new Error("Uno de los rubros seleccionados no es válido."), { status: 400 });
  }
  return industries;
}

async function replaceTenantCollection(tenantRef, collectionName, rows, keyColumns) {
  const collection = tenantRef.collection("collections").doc(collectionName).collection("records");
  const existing = await collection.get();
  const currentIds = new Set(rows.map((row) => keyColumns.map((column) => row[column]).join("-")));
  const operations = [];
  for (const document of existing.docs) {
    if (!currentIds.has(document.id)) operations.push({ type: "delete", ref: document.ref });
  }
  for (const row of rows) {
    const id = keyColumns.map((column) => row[column]).join("-");
    operations.push({ type: "set", ref: collection.doc(id), data: row });
  }
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = firestore.batch();
    for (const operation of operations.slice(offset, offset + 450)) {
      if (operation.type === "delete") batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data);
    }
    await batch.commit();
  }
}

async function syncTenantDocumentsToFirebase(tenantRef, companyId) {
  const documents = db.prepare(`
    SELECT transaction_documents.transaction_id, transaction_documents.file_name,
      transaction_documents.media_type, transaction_documents.file_size, transaction_documents.content
    FROM transaction_documents
    JOIN transactions ON transactions.id = transaction_documents.transaction_id
    WHERE transactions.company_id = ?
  `).all(companyId);
  const collection = tenantRef.collection("collections").doc("transaction_documents").collection("records");
  const existing = await collection.get();
  const currentIds = new Set(documents.map((document) => String(document.transaction_id)));
  for (const record of existing.docs) {
    if (currentIds.has(record.id)) continue;
    const chunks = await record.ref.collection("chunks").get();
    for (let offset = 0; offset < chunks.docs.length; offset += 450) {
      const batch = firestore.batch();
      for (const chunk of chunks.docs.slice(offset, offset + 450)) batch.delete(chunk.ref);
      await batch.commit();
    }
    await record.ref.delete();
  }
  for (const document of documents) {
    const record = collection.doc(String(document.transaction_id));
    const bytes = Buffer.from(document.content);
    const chunkSize = 512 * 1024;
    const chunks = Array.from({ length: Math.ceil(bytes.length / chunkSize) }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      contentBase64: bytes.subarray(index * chunkSize, Math.min(bytes.length, (index + 1) * chunkSize)).toString("base64")
    }));
    const previousChunks = await record.collection("chunks").get();
    const retainedChunkIds = new Set(chunks.map((chunk) => chunk.id));
    const batch = firestore.batch();
    batch.set(record, {
      transactionId: document.transaction_id,
      fileName: document.file_name,
      mediaType: document.media_type,
      fileSize: document.file_size,
      chunkCount: chunks.length
    });
    for (const oldChunk of previousChunks.docs) {
      if (!retainedChunkIds.has(oldChunk.id)) batch.delete(oldChunk.ref);
    }
    await batch.commit();
    for (let offset = 0; offset < chunks.length; offset += 450) {
      const chunkBatch = firestore.batch();
      for (const chunk of chunks.slice(offset, offset + 450)) {
        chunkBatch.set(record.collection("chunks").doc(chunk.id), {
          index: Number(chunk.id),
          contentBase64: chunk.contentBase64
        });
      }
      await chunkBatch.commit();
    }
  }
}

async function syncTenantToFirebase(companyId) {
  if (!firestore) throw new Error("Firebase credentials have not been configured.");
  const tenant = db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId);
  if (!tenant) return;
  const tenantRef = firestore.collection("tenants").doc(String(companyId));
  await tenantRef.set({
    companyId,
    name: tenant.name,
    createdAt: tenant.created_at,
    legacySubscriptionStatus: tenant.subscription_status,
    subscriptionStatus: tenant.subscription_state,
    subscriptionPlan: tenant.subscription_plan,
    subscriptionUntil: tenant.subscription_until,
    updatedAt: new Date().toISOString()
  });
  for (const [collectionName, sql, keyColumns] of tenantSnapshotQueries) {
    const rows = db.prepare(sql).all(companyId);
    await replaceTenantCollection(tenantRef, collectionName, rows, keyColumns.split(","));
  }
  await syncTenantDocumentsToFirebase(tenantRef, companyId);
}

async function processFirebaseSync(companyId) {
  if (!firestore || companiesPendingDeletion.has(companyId) || activeSyncs.has(companyId)) return activeSyncs.get(companyId);
  const operation = (async () => {
    let rerun = false;
    try {
      const job = db.prepare("SELECT generation FROM firebase_sync_jobs WHERE company_id = ?").get(companyId);
      if (!job) return;
      await syncTenantToFirebase(companyId);
      const deleted = db.prepare(`
        DELETE FROM firebase_sync_jobs WHERE company_id = ? AND generation = ?
      `).run(companyId, job.generation);
      rerun = Number(deleted.changes) === 0 &&
        Boolean(db.prepare("SELECT 1 FROM firebase_sync_jobs WHERE company_id = ?").get(companyId));
    } catch (error) {
      db.prepare(`
        UPDATE firebase_sync_jobs SET attempts = attempts + 1, last_error = ?,
          requested_at = CURRENT_TIMESTAMP WHERE company_id = ?
      `).run(String(error.message || error).slice(0, 500), companyId);
      console.error(`Firebase sync failed for tenant ${companyId}:`, error);
      setTimeout(() => processFirebaseSync(companyId), 30_000).unref();
    } finally {
      activeSyncs.delete(companyId);
      if (rerun) setImmediate(() => processFirebaseSync(companyId));
    }
  })();
  activeSyncs.set(companyId, operation);
  return operation;
}

function enqueueFirebaseSync(companyId) {
  if (companiesPendingDeletion.has(companyId)) return;
  db.prepare(`
    INSERT INTO firebase_sync_jobs (company_id) VALUES (?)
    ON CONFLICT (company_id) DO UPDATE SET
      requested_at = CURRENT_TIMESTAMP, generation = firebase_sync_jobs.generation + 1
  `).run(companyId);
  if (firestore) setImmediate(() => processFirebaseSync(companyId));
}

function requestBody(request, maximumSize = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bodySize = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      if (bodySize + chunk.length > maximumSize) {
        tooLarge = true;
        reject(Object.assign(new Error("El formulario es demasiado grande."), { status: 413 }));
        return;
      }
      chunks.push(chunk);
      bodySize += chunk.length;
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("El formato de los datos no es válido."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function requiredText(value, label, maxLength = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw Object.assign(new Error(`Ingresá ${label} (máximo ${maxLength} caracteres).`), { status: 400 });
  }
  return value.trim();
}

function requiredUsername(value) {
  const username = requiredText(value, "un usuario", 32).toLowerCase();
  if (username.length < 3 || !/^[a-z0-9][a-z0-9._-]*$/.test(username)) {
    throw Object.assign(new Error("El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo."), { status: 400 });
  }
  return username;
}

function normalizePurchaseDocument(document) {
  if (document === undefined || document === null) return null;
  if (!document || typeof document !== "object" || typeof document.dataBase64 !== "string") {
    throw Object.assign(new Error("El comprobante adjunto no tiene un formato válido."), { status: 400 });
  }
  const mediaType = document.mediaType;
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    throw Object.assign(new Error("Adjuntá un comprobante PDF, JPG, PNG o WebP."), { status: 400 });
  }
  const fileName = requiredText(document.fileName, "el nombre del comprobante", 180)
    .replace(/[\\/\r\n"]/g, "_");
  const encoded = document.dataBase64;
  if (encoded.length > 7_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw Object.assign(new Error("El comprobante adjunto está dañado o es demasiado grande."), { status: 400 });
  }
  const content = Buffer.from(encoded, "base64");
  if (!content.length || content.length > 5 * 1024 * 1024 || content.toString("base64") !== encoded) {
    throw Object.assign(new Error("El comprobante no puede superar los 5 MB."), { status: 400 });
  }
  const validContent = mediaType === "application/pdf"
    ? content.subarray(0, 5).toString("ascii") === "%PDF-"
    : mediaType === "image/png"
      ? content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mediaType === "image/jpeg"
        ? content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
        : content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  if (!validContent) {
    throw Object.assign(new Error("El tipo de archivo no coincide con el comprobante adjunto."), { status: 400 });
  }
  return { fileName, mediaType, content };
}

function purchaseDocumentMetadata(transactionId) {
  const document = db.prepare(`
    SELECT file_name AS fileName, media_type AS mediaType, file_size AS fileSize
    FROM transaction_documents WHERE transaction_id = ?
  `).get(transactionId);
  return document || null;
}

function decimalUnits(value, scale, label, { required = true, allowZero = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return 0;
    throw Object.assign(new Error(`Ingresá ${label}.`), { status: 400 });
  }
  const text = typeof value === "number" ? String(value) : value;
  const expression = scale === 0
    ? /^(?:0|[1-9]\d*)$/
    : new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`);
  if (typeof text !== "string" || !expression.test(text)) {
    throw Object.assign(new Error(`${label} debe ser un número válido con hasta ${scale} decimales.`), { status: 400 });
  }
  const [whole, fraction = ""] = text.split(".");
  const parsed = Number(whole) * (10 ** scale) + Number(fraction.padEnd(scale, "0"));
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw Object.assign(new Error(`${label} debe ser un valor ${allowZero ? "positivo o cero" : "mayor que cero"}.`), { status: 400 });
  }
  return parsed;
}

function wholePriceCents(value, label) {
  const cents = decimalUnits(value, 0, label) * 100;
  if (!Number.isSafeInteger(cents)) {
    throw Object.assign(new Error(`${label} excede el límite permitido.`), { status: 400 });
  }
  return cents;
}

function percentageBasisPoints(value, label) {
  const basisPoints = decimalUnits(value, 2, label, { required: false });
  if (basisPoints > 10000) {
    throw Object.assign(new Error(`${label} debe estar entre 0 y 100.`), { status: 400 });
  }
  return basisPoints;
}

function profitBasisPoints(value) {
  if (value === undefined || value === null || value === "") return 0;
  const basisPoints = signedDecimalUnits(value, 2, "El porcentaje de ganancia");
  if (basisPoints < -10000 || basisPoints > 1_000_000) {
    throw Object.assign(new Error("El porcentaje de ganancia debe estar entre -100 y 10000."), { status: 400 });
  }
  return basisPoints;
}

function priceWithVatCents(costCents, bonusBasisPoints) {
  const discountedCostCents = Math.round(costCents * (10000 - bonusBasisPoints) / 10000);
  return Math.round(discountedCostCents * 121 / 100);
}

function publicPriceFromBaseCents(basePriceCents, profitBasisPoints) {
  const price = Math.round(Math.round(basePriceCents * (10000 + profitBasisPoints) / 10000) / 100) * 100;
  if (!Number.isSafeInteger(price)) {
    throw Object.assign(new Error("El precio de venta calculado es demasiado grande."), { status: 400 });
  }
  return price;
}

function profitBasisPointsForPrice(priceCents, basePrice) {
  return basePrice > 0 ? Math.max(-10000, Math.round((priceCents / basePrice - 1) * 10000)) : 0;
}

function signedDecimalUnits(value, scale, label) {
  if (value === undefined || value === null || value === "") {
    throw Object.assign(new Error(`Ingresá ${label}.`), { status: 400 });
  }
  const text = typeof value === "number" ? String(value) : value;
  const expression = new RegExp(`^-?(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`);
  if (typeof text !== "string" || !expression.test(text)) {
    throw Object.assign(new Error(`${label} debe ser un número válido con hasta ${scale} decimales.`), { status: 400 });
  }
  const negative = text.startsWith("-");
  const parsed = decimalUnits(negative ? text.slice(1) : text, scale, label);
  return negative ? -parsed : parsed;
}

function serializeProduct(product) {
  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode || "",
    name: product.name,
    category: product.category,
    brand: product.brand || "",
    cost: product.cost_cents / 100,
    bonusPercent: (product.bonus_basis_points || 0) / 100,
    discountedCost: product.discounted_cost_cents / 100,
    priceWithVat: product.price_with_vat_cents / 100,
    profitPercent: (product.profit_basis_points || 0) / 100,
    guildDiscountPercent: (product.guild_discount_basis_points || 0) / 100,
    price: product.price_cents / 100,
    price2: (product.price2_cents ?? product.price_cents) / 100,
    price3: (product.price3_cents ?? product.price_cents) / 100,
    stock: (product.stock_milli - product.stock_debt_milli) / 1000,
    minimumStock: product.minimum_stock_milli / 1000,
    active: Boolean(product.active),
    createdAt: product.created_at
  };
}

function productAtBranch(product, branchId) {
  const stock = db.prepare(`
    SELECT stock_milli, stock_debt_milli, minimum_stock_milli
    FROM branch_stock WHERE branch_id = ? AND product_id = ?
  `).get(branchId, product.id);
  return {
    ...product,
    stock_milli: stock?.stock_milli || 0,
    stock_debt_milli: stock?.stock_debt_milli || 0,
    minimum_stock_milli: stock?.minimum_stock_milli || 0
  };
}

function initializeBranchStock(branchId, productId, stockMilli = 0, stockDebtMilli = 0, minimumStockMilli = 0) {
  db.prepare(`
    INSERT INTO branch_stock (branch_id, product_id, stock_milli, stock_debt_milli, minimum_stock_milli)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (branch_id, product_id) DO NOTHING
  `).run(branchId, productId, stockMilli, stockDebtMilli, minimumStockMilli);
}

function initializeProductBranchStocks(companyId, productId, initialBranchId, stockMilli = 0, stockDebtMilli = 0, minimumStockMilli = 0) {
  db.prepare(`
    INSERT OR IGNORE INTO branch_stock (branch_id, product_id, stock_milli, stock_debt_milli, minimum_stock_milli)
    SELECT branches.id, ?, CASE WHEN branches.id = ? THEN ? ELSE 0 END,
      CASE WHEN branches.id = ? THEN ? ELSE 0 END,
      CASE WHEN branches.id = ? THEN ? ELSE 0 END
    FROM branches WHERE branches.company_id = ?
  `).run(productId, initialBranchId, stockMilli, initialBranchId, stockDebtMilli,
    initialBranchId, minimumStockMilli, companyId);
}

function serializeTransaction(transaction) {
  return {
    id: transaction.id,
    kind: transaction.kind,
    number: transaction.number,
    contact: transaction.contact,
    createdBy: transaction.created_by || transaction.createdBy || "",
    salespersonName: transaction.salesperson_name || transaction.salespersonName || transaction.created_by || "",
    contactTaxId: transaction.contact_tax_id || "",
    contactVatCondition: transaction.contact_vat_condition || "Consumidor final",
    contactAddress: transaction.contact_address || "",
    ...(transaction.kind === "purchase" ? { place: transaction.contact_address || "" } : {}),
    contactPhone: transaction.contact_phone || "",
    contactEmail: transaction.contact_email || "",
    generalDiscountPercent: (transaction.general_discount_basis_points || 0) / 100,
    saleMode: transaction.sale_mode || "paid",
    total: transaction.total_cents / 100,
    createdAt: transaction.created_at,
    items: transaction.items || [],
    payments: transaction.payments || [],
    customerId: transaction.customer_id ?? transaction.customerId ?? null
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatReceiptDate(value) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatReceiptMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2
  }).format(value);
}

function receiptHtml(transaction, settings) {
  const paymentLabels = {
    cash: "Efectivo",
    debit: "Tarjeta de débito",
    credit: "Tarjeta de crédito",
    transfer: "Transferencia",
    other: "Otro medio"
  };
  const receiptItemDetails = transactionItems(transaction.id);
  const items = receiptItemDetails.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.sku)}</strong></td>
      <td>${escapeHtml(item.name)}</td>
      <td>${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(item.quantity)}</td>
      <td>${formatReceiptMoney(item.unitPrice)}</td>
      <td>${formatReceiptMoney(item.discount)}</td>
      <td>${formatReceiptMoney(item.subtotal)}</td>
    </tr>`).join("");
  const payments = paymentDetails(transaction.id);
  const outstandingCents = Math.max(0, transaction.total_cents - payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0));
  const paymentRows = payments.length
    ? payments.map((payment) => `
        <div class="receipt-payment"><span>${escapeHtml(paymentLabels[payment.method] || payment.method)}</span><strong>${formatReceiptMoney(payment.amount)}</strong></div>`).join("")
    : '<div class="receipt-payment"><span>Medio de pago</span><strong>No registrado</strong></div>';
  const generalDiscountCents = receiptItemDetails.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0) - transaction.total_cents;
  const logo = settings.logo_data_uri
    ? `<img class="seller-logo" src="${escapeHtml(settings.logo_data_uri)}" alt="Logo de ${escapeHtml(settings.business_name)}">`
    : "";
  const sellerLines = [
    `RAZÓN SOCIAL: ${settings.legal_name || settings.business_name}`,
    settings.address && `DOMICILIO: ${settings.address}`,
    settings.vat_condition && `CONDICIÓN FRENTE AL IVA: ${settings.vat_condition}`,
    settings.tax_id && `CUIT: ${settings.tax_id}`,
    settings.email && `MAIL: ${settings.email}`,
    settings.phone && `TEL.: ${settings.phone}`,
    settings.activity_start && `INICIO DE ACTIVIDADES: ${settings.activity_start}`
  ].filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  const customerLines = [
    ["RAZÓN SOCIAL", transaction.contact],
    ["CUIT", transaction.contact_tax_id],
    ["CONDICIÓN FRENTE AL IVA", transaction.contact_vat_condition],
    ["DOMICILIO COMERCIAL", transaction.contact_address],
    ["TEL.", transaction.contact_phone],
    ["MAIL", transaction.contact_email]
  ].filter(([, value]) => value).map(([label, value]) => `<div><strong>${label}:</strong> ${escapeHtml(value)}</div>`).join("");
  const issueDate = formatReceiptDate(transaction.created_at);
  return `<!doctype html>
    <html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Comprobante ${escapeHtml(transaction.number)}</title>
      <link rel="stylesheet" href="/receipt.css">
      <script src="/receipt.js" defer></script>
    </head><body><main class="receipt ${settings.receipt_format === "ticket" ? "receipt-ticket" : "receipt-a4"}">
      <div class="receipt-copy">ORIGINAL</div>
      <header class="receipt-header">
        <div class="seller">
          ${logo}
          <strong class="seller-name">${escapeHtml(settings.business_name)}</strong>
          <div class="seller-data">${sellerLines}</div>
        </div>
        <div class="document-type"><span class="document-mark">X</span><h1>${escapeHtml(settings.receipt_title)}</h1>
          <div class="receipt-meta">
            <div>PUNTO DE VENTA: ${escapeHtml(settings.point_of_sale)} &nbsp; COMP. NÚMERO: ${escapeHtml(transaction.number.split("-").pop())}</div>
            <div>FECHA DE EMISIÓN: ${escapeHtml(issueDate)}</div>
            <div>CUIT: ${escapeHtml(settings.tax_id)}</div>
            <div>INGRESOS BRUTOS: ${escapeHtml(settings.gross_income)}</div>
            <div>FECHA DE INICIO DE ACTIVIDADES: ${escapeHtml(settings.activity_start || "—")}</div>
            ${transaction.salesperson_name ? `<div>ATENDIÓ: ${escapeHtml(transaction.salesperson_name)}</div>` : ""}
          </div>
        </div>
      </header>
      <div class="billing-period"><span>PERÍODO FACTURADO DESDE: ${escapeHtml(issueDate.split(" a las ")[0])}</span>
        <span>HASTA: ${escapeHtml(issueDate.split(" a las ")[0])}</span><span>FECHA DE VENCIMIENTO: Contado</span></div>
      <section class="customer-data">${customerLines}</section>
      <table><thead><tr><th>CÓDIGO</th><th>PRODUCTO</th><th>CANTIDAD</th><th>VAL. UNIT.</th><th>DESCUENTO</th><th>SUBTOTAL</th></tr></thead><tbody>${items}</tbody></table>
      <div class="receipt-bottom"><div class="fiscal-notice">COMPROBANTE INTERNO · NO VÁLIDO COMO FACTURA NI COMPROBANTE FISCAL</div>
        <div class="totals">
          ${generalDiscountCents > 0 ? `<div><span>DESCUENTO GENERAL (${transaction.general_discount_basis_points / 100} %)</span><strong>− ${formatReceiptMoney(generalDiscountCents / 100)}</strong></div>` : ""}
          ${paymentRows}
          <div class="receipt-total"><span>TOTAL</span><strong>${formatReceiptMoney(transaction.total_cents / 100)}</strong></div>
          ${outstandingCents > 0 ? `<div class="receipt-total"><span>SALDO PENDIENTE</span><strong>${formatReceiptMoney(outstandingCents / 100)}</strong></div>` : ""}
        </div></div>
      <div class="actions"><button id="print-receipt" type="button">Imprimir comprobante</button></div>
    </main></body></html>`;
}

function receiptSettings(companyId) {
  return db.prepare("SELECT * FROM company_receipt_settings WHERE company_id = ?").get(companyId);
}

function paymentDetails(transactionId) {
  return db.prepare(`
    SELECT method, amount_cents / 100.0 AS amount
    FROM transaction_payments WHERE transaction_id = ?
    UNION ALL
    SELECT method, amount_cents / 100.0 AS amount
    FROM customer_account_payments WHERE transaction_id = ? ORDER BY method
  `).all(transactionId, transactionId);
}

function cashSessionSummary(sessionId) {
  const totals = db.prepare(`
    SELECT method, SUM(amount_cents) / 100.0 AS amount FROM (
      SELECT transaction_payments.method, transaction_payments.amount_cents
      FROM transaction_payments JOIN transactions ON transactions.id = transaction_payments.transaction_id
      WHERE transactions.cash_session_id = ? AND transactions.kind = 'sale'
      UNION ALL
      SELECT method, amount_cents FROM customer_account_payments WHERE cash_session_id = ?
      UNION ALL
      SELECT method, CASE WHEN kind = 'in' THEN amount_cents ELSE -amount_cents END
      FROM cash_register_movements WHERE session_id = ?
    ) GROUP BY method
  `).all(sessionId, sessionId, sessionId);
  const movements = db.prepare(`
    SELECT kind, method, amount_cents / 100.0 AS amount, description, created_at AS createdAt
    FROM cash_register_movements WHERE session_id = ? ORDER BY id DESC
  `).all(sessionId);
  const byMethod = Object.fromEntries(totals.map((entry) => [entry.method, entry.amount]));
  return {
    byMethod,
    cashSales: db.prepare(`
      SELECT COALESCE(SUM(transaction_payments.amount_cents), 0) / 100.0 AS amount
      FROM transaction_payments JOIN transactions ON transactions.id = transaction_payments.transaction_id
      WHERE transactions.cash_session_id = ? AND transactions.kind = 'sale' AND transaction_payments.method = 'cash'
    `).get(sessionId).amount,
    expectedCash: byMethod.cash || 0,
    movements
  };
}

function transactionItems(transactionId) {
  return db.prepare(`
    SELECT product_name AS name, sku, price_tier AS priceTier, quantity_milli / 1000.0 AS quantity,
      unit_price_cents / 100.0 AS unitPrice, discount_basis_points / 100.0 AS discountPercent,
      ROUND(quantity_milli * unit_price_cents / 1000.0) / 100.0 AS gross,
      (ROUND(quantity_milli * unit_price_cents / 1000.0) -
        subtotal_cents) / 100.0 AS discount,
      subtotal_cents / 100.0 AS subtotal
    FROM transaction_items WHERE transaction_id = ? ORDER BY id
  `).all(transactionId);
}

function quoteItems(quoteId) {
  return db.prepare(`
    SELECT id, product_id AS productId, product_name AS name, sku,
      quantity_milli / 1000.0 AS quantity, unit_price_cents / 100.0 AS unitPrice,
      discount_basis_points / 100.0 AS discountPercent, price_tier AS priceTier,
      ROUND(quantity_milli * unit_price_cents / 1000.0) / 100.0 AS gross,
      (ROUND(quantity_milli * unit_price_cents / 1000.0) - subtotal_cents) / 100.0 AS discount,
      subtotal_cents / 100.0 AS subtotal
    FROM quote_items WHERE quote_id = ? ORDER BY id
  `).all(quoteId);
}

function serializeQuote(quote) {
  const items = quoteItems(quote.id);
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    id: quote.id,
    number: quote.number,
    contact: quote.contact,
    contactTaxId: quote.contact_tax_id,
    contactVatCondition: quote.contact_vat_condition,
    contactAddress: quote.contact_address,
    contactPhone: quote.contact_phone,
    contactEmail: quote.contact_email,
    generalDiscountPercent: quote.general_discount_basis_points / 100,
    total: quote.total_cents / 100,
    subtotal,
    validUntil: quote.valid_until,
    status: quote.status,
    saleTransactionId: quote.sale_transaction_id,
    createdAt: quote.created_at,
    createdBy: quote.created_by_name || quote.created_by || "",
    items
  };
}

function serializeCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    taxId: customer.tax_id,
    vatCondition: customer.vat_condition,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    discountPercent: customer.discount_basis_points / 100,
    createdAt: customer.created_at
  };
}

function salesOrderItems(orderId) {
  return db.prepare(`
    SELECT id, product_id AS productId, product_name AS name, sku,
      quantity_milli / 1000.0 AS quantity, unit_price_cents / 100.0 AS unitPrice,
      discount_basis_points / 100.0 AS discountPercent, price_tier AS priceTier,
      subtotal_cents / 100.0 AS subtotal
    FROM sales_order_items WHERE order_id = ? ORDER BY id
  `).all(orderId);
}

function serializeSalesOrder(order) {
  const items = salesOrderItems(order.id);
  return {
    id: order.id,
    number: order.number,
    contact: order.contact,
    customerId: order.customer_id ?? null,
    generalDiscountPercent: order.general_discount_basis_points / 100,
    total: order.total_cents / 100,
    status: order.status,
    transactionId: order.transaction_id,
    createdAt: order.created_at,
    createdBy: order.created_by_name || order.created_by || "",
    items
  };
}

function quotePrintHtml(quote, settings) {
  const items = quoteItems(quote.id);
  const itemSubtotalCents = items.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0);
  const generalDiscount = itemSubtotalCents - quote.total_cents;
  const rows = items.map((item) => `
    <tr><td>${escapeHtml(item.sku || "—")}</td><td>${escapeHtml(item.name)}</td>
    <td>${formatQuantityForReceipt(item.quantity)}</td>
    <td>${formatReceiptMoney(item.unitPrice)}</td>
    <td>${formatReceiptMoney(item.discount)}</td><td>${formatReceiptMoney(item.subtotal)}</td></tr>`).join("");
  const customer = [
    ["Cliente", quote.contact],
    ["CUIT / identificación", quote.contact_tax_id],
    ["Condición frente al IVA", quote.contact_vat_condition],
    ["Domicilio", quote.contact_address],
    ["Teléfono", quote.contact_phone],
    ["Correo", quote.contact_email]
  ].filter(([, value]) => value).map(([label, value]) =>
    `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`
  ).join("");
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Presupuesto ${escapeHtml(quote.number)}</title>
    <script src="/print.js" defer></script>
    <link rel="stylesheet" href="/quote-print.css"></head><body><main>
    <header><div><h2>${escapeHtml(settings.business_name || settings.legal_name || "Presupuesto")}</h2>
      <div>${escapeHtml(settings.address || "")}</div><div>${escapeHtml(settings.phone || "")}</div>
      <div>${escapeHtml(settings.email || "")}</div></div>
      <div class="meta"><h1>PRESUPUESTO</h1><strong>${escapeHtml(quote.number)}</strong>
      <div>Fecha: ${escapeHtml(quote.created_at.slice(0, 10))}</div><div>Válido hasta: ${escapeHtml(quote.valid_until)}</div></div></header>
    <section class="customer">${customer || `<div><strong>Cliente:</strong> ${escapeHtml(quote.contact)}</div>`}</section>
    <table><thead><tr><th>Código</th><th>Descripción</th><th>Cant.</th><th>Precio unit.</th><th>Descuento</th><th>Subtotal</th></tr></thead>
    <tbody>${rows}</tbody></table><section class="totals">
      <div><span>Subtotal</span><strong>${formatReceiptMoney(itemSubtotalCents / 100)}</strong></div>
      ${generalDiscount > 0 ? `<div><span>Descuento general (${quote.general_discount_basis_points / 100}%)</span><strong>− ${formatReceiptMoney(generalDiscount / 100)}</strong></div>` : ""}
      <div class="grand"><span>TOTAL</span><strong>${formatReceiptMoney(quote.total_cents / 100)}</strong></div>
    </section><div class="notice">Este presupuesto no reserva stock y no es un comprobante fiscal.</div>
    <div class="actions"><button type="button" data-print>Imprimir presupuesto</button></div>
    </main></body></html>`;
}

function formatQuantityForReceipt(value) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(value);
}

function optionalText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalIsoDate(value, label) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw Object.assign(new Error(`${label} debe ser una fecha válida.`), { status: 400 });
  }
  const date = optionalText(value, 10);
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error(`${label} debe ser una fecha válida.`), { status: 400 });
  }
  return date;
}

function nextTransactionNumber(companyId, kind) {
  const prefix = kind === "sale" ? "V" : "C";
  db.prepare(`
    INSERT INTO transaction_sequences (company_id, kind, last_number) VALUES (?, ?, 0)
    ON CONFLICT (company_id, kind) DO NOTHING
  `).run(companyId, kind);
  while (true) {
    const lastNumber = db.prepare(
      "SELECT last_number FROM transaction_sequences WHERE company_id = ? AND kind = ?"
    ).get(companyId, kind).last_number;
    const reusableNumbers = db.prepare(`
      SELECT receipt_number FROM transaction_reusable_numbers
      WHERE company_id = ? AND kind = ? ORDER BY receipt_number ASC
    `).all(companyId, kind).map((row) => row.receipt_number);
    const reusableSet = new Set(reusableNumbers);

    if (lastNumber > 0 && reusableSet.has(lastNumber)) {
      let firstReusedNumber = lastNumber;
      while (reusableSet.has(firstReusedNumber - 1)) firstReusedNumber -= 1;
      db.prepare(`
        DELETE FROM transaction_reusable_numbers
        WHERE company_id = ? AND kind = ? AND receipt_number = ?
      `).run(companyId, kind, firstReusedNumber);
      db.prepare(`
        UPDATE transaction_sequences SET last_number = ?
        WHERE company_id = ? AND kind = ?
      `).run(firstReusedNumber - 1, companyId, kind);
      const reusedNumber = `${prefix}-${String(firstReusedNumber).padStart(6, "0")}`;
      if (!db.prepare(
        "SELECT 1 FROM transactions WHERE company_id = ? AND kind = ? AND number = ?"
      ).get(companyId, kind, reusedNumber)) return firstReusedNumber;
      continue;
    }
    db.prepare(`
      DELETE FROM transaction_reusable_numbers
      WHERE company_id = ? AND kind = ? AND receipt_number < ?
    `).run(companyId, kind, lastNumber);
    const nextReusable = db.prepare(`
      SELECT receipt_number FROM transaction_reusable_numbers
      WHERE company_id = ? AND kind = ? ORDER BY receipt_number ASC LIMIT 1
    `).get(companyId, kind);
    if (nextReusable?.receipt_number === lastNumber + 1) {
      db.prepare(`
        DELETE FROM transaction_reusable_numbers
        WHERE company_id = ? AND kind = ? AND receipt_number = ?
      `).run(companyId, kind, nextReusable.receipt_number);
      db.prepare(`
        UPDATE transaction_sequences SET last_number = ?
        WHERE company_id = ? AND kind = ?
      `).run(nextReusable.receipt_number, companyId, kind);
      const reusedNumber = `${prefix}-${String(nextReusable.receipt_number).padStart(6, "0")}`;
      if (!db.prepare(
        "SELECT 1 FROM transactions WHERE company_id = ? AND kind = ? AND number = ?"
      ).get(companyId, kind, reusedNumber)) return nextReusable.receipt_number;
      continue;
    }
    const number = db.prepare(`
      INSERT INTO transaction_sequences (company_id, kind, last_number) VALUES (?, ?, 1)
      ON CONFLICT (company_id, kind) DO UPDATE SET last_number = last_number + 1
      RETURNING last_number
    `).get(companyId, kind).last_number;
    if (!Number.isSafeInteger(number) || number < 1) {
      throw Object.assign(new Error("Se alcanzó el límite de numeración de comprobantes."), { status: 409 });
    }
    const receiptNumber = `${prefix}-${String(number).padStart(6, "0")}`;
    if (!db.prepare(
      "SELECT 1 FROM transactions WHERE company_id = ? AND kind = ? AND number = ?"
    ).get(companyId, kind, receiptNumber)) return number;
  }
}

function applyStockMovement(companyId, branchId, productId, quantityMilli, kind) {
  const product = db.prepare(
    "SELECT id, name FROM products WHERE id = ? AND company_id = ?"
  ).get(productId, companyId);
  if (!product) {
    throw Object.assign(new Error("No se pudo actualizar el inventario: uno de los productos ya no existe."), { status: 409 });
  }
  initializeBranchStock(branchId, productId);
  const stockRow = db.prepare(
    "SELECT stock_milli, stock_debt_milli FROM branch_stock WHERE branch_id = ? AND product_id = ?"
  ).get(branchId, productId);
  let stock;
  let stockDebt;
  if (kind === "sale") {
    const availableStock = Math.max(0, stockRow.stock_milli - stockRow.stock_debt_milli);
    stockDebt = stockRow.stock_debt_milli + Math.max(0, quantityMilli - availableStock);
    stock = Math.max(0, stockRow.stock_milli - quantityMilli);
  } else {
    const paidDebt = Math.min(stockRow.stock_debt_milli, quantityMilli);
    stock = stockRow.stock_milli + quantityMilli - paidDebt;
    stockDebt = stockRow.stock_debt_milli - paidDebt;
  }
  if (!Number.isSafeInteger(stock) || !Number.isSafeInteger(stockDebt)) {
    throw Object.assign(new Error(`El inventario de ${product.name} excede el límite permitido.`), { status: 400 });
  }
  const result = db.prepare(
    "UPDATE branch_stock SET stock_milli = ?, stock_debt_milli = ? WHERE branch_id = ? AND product_id = ?"
  ).run(stock, stockDebt, branchId, productId);
  if (Number(result.changes) !== 1) {
    throw Object.assign(new Error(`No se pudo actualizar el stock de ${product.name}.`), { status: 409 });
  }
}

function createTransaction(user, body, kind, options = {}) {
  const saleMode = kind === "sale" ? (body.saleMode || "paid") : "paid";
  if (!new Set(["paid", "deposit", "account"]).has(saleMode)) {
    throw Object.assign(new Error("Elegí una modalidad de cobro válida."), { status: 400 });
  }
  const submittedCustomerId = kind === "sale" && body.customerId !== undefined && body.customerId !== null && body.customerId !== ""
    ? Number(body.customerId)
    : null;
  if (submittedCustomerId !== null && (!Number.isSafeInteger(submittedCustomerId) || submittedCustomerId < 1)) {
    throw Object.assign(new Error("El cliente seleccionado no es válido."), { status: 400 });
  }
  const customer = submittedCustomerId === null ? null : db.prepare(
    "SELECT * FROM customers WHERE id = ? AND company_id = ? AND active = 1"
  ).get(submittedCustomerId, user.company_id);
  if (submittedCustomerId !== null && !customer) {
    throw Object.assign(new Error("El cliente no existe o está archivado."), { status: 404 });
  }
  if (kind === "sale" && saleMode !== "paid" && !customer) {
    throw Object.assign(new Error("Las señas y los fiados requieren un cliente registrado."), { status: 400 });
  }
  const cashSession = kind === "sale"
    ? db.prepare("SELECT id FROM cash_register_sessions WHERE company_id = ? AND branch_id = ? AND closed_at IS NULL")
      .get(user.company_id, user.branch_id)
    : null;
  const contact = customer?.name || (kind === "sale" && (typeof body.contact !== "string" || !body.contact.trim())
    ? "Consumidor final"
    : requiredText(body.contact, kind === "sale" ? "el cliente" : "el proveedor"));
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    throw Object.assign(new Error("Agregá entre 1 y 100 productos al movimiento."), { status: 400 });
  }
  const generalDiscountBasisPoints = kind === "sale"
    ? decimalUnits(body.generalDiscountPercent ?? "0", 2, "El descuento general")
    : 0;
  if (generalDiscountBasisPoints > 10000) {
    throw Object.assign(new Error("El descuento general no puede superar el 100 %."), { status: 400 });
  }
  const contactTaxId = kind === "sale" ? (customer?.tax_id || optionalText(body.contactTaxId, 32)) : "";
  const contactVatCondition = kind === "sale"
    ? (customer?.vat_condition || optionalText(body.contactVatCondition, 80) || "Consumidor final")
    : "";
  const contactAddress = kind === "sale" ? (customer?.address || optionalText(body.contactAddress, 200)) : "";
  const contactPhone = kind === "sale" ? (customer?.phone || optionalText(body.contactPhone, 40)) : "";
  const contactEmail = kind === "sale" ? (customer?.email || optionalText(body.contactEmail, 254)) : "";
  const purchasePlace = kind === "purchase" ? optionalText(body.place, 200) : "";
  const purchaseDocument = kind === "purchase" ? normalizePurchaseDocument(body.document) : null;
  const items = body.items.map((item) => {
    const isCustom = (kind === "sale" || kind === "purchase") && item && item.custom === true;
    const productId = isCustom ? null : item?.productId;
    if (isCustom) {
      if (!optionalText(item.name, 120)) {
        throw Object.assign(new Error("Describí cada artículo libre de la venta."), { status: 400 });
      }
    } else if (!Number.isSafeInteger(productId) || productId < 1) {
      throw Object.assign(new Error("Uno de los productos seleccionados no es válido."), { status: 400 });
    }
    const priceTier = kind === "sale" ? Number(item.priceTier ?? 1) : 1;
    if (!Number.isInteger(priceTier) || priceTier < 1 || priceTier > 3) {
      throw Object.assign(new Error("Elegí un nivel de precio válido."), { status: 400 });
    }
    const submittedDiscountBasisPoints = kind === "sale"
      ? decimalUnits(item.discountPercent ?? "0", 2, "El descuento")
      : 0;
    if (submittedDiscountBasisPoints > 10000) {
      throw Object.assign(new Error("El descuento no puede superar el 100 %."), { status: 400 });
    }
    const discountBasisPoints = kind === "sale"
      ? Math.min(10000, submittedDiscountBasisPoints + (options.skipCustomerDiscount ? 0 : customer?.discount_basis_points || 0))
      : submittedDiscountBasisPoints;
    const quantityMilli = kind === "sale"
      ? decimalUnits(item.quantity, 0, "La cantidad", { allowZero: false }) * 1000
      : decimalUnits(item.quantity, 3, "La cantidad", { allowZero: false });
    if (!Number.isSafeInteger(quantityMilli)) {
      throw Object.assign(new Error("La cantidad excede el límite permitido."), { status: 400 });
    }
    return {
      productId,
      isCustom,
      name: isCustom ? requiredText(item.name, "la descripción del artículo", 120) : "",
      customSku: kind === "purchase" && isCustom ? optionalText(item.sku, 40) : "",
      customUnitPriceCents: isCustom ? decimalUnits(item.unitPrice, 2, kind === "purchase" ? "El precio de compra" : "El precio") : null,
      submittedUnitPriceCents: !isCustom && item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== ""
        ? decimalUnits(item.unitPrice, 2, "El precio")
        : null,
      storedUnitPriceCents: options.useStoredPrices ? item.storedUnitPriceCents : null,
      priceTier,
      quantityMilli,
      discountBasisPoints
    };
  });

  const create = () => {
    const transactionItems = items.map((item) => {
      const product = item.isCustom
        ? item.customSku
          ? db.prepare("SELECT * FROM products WHERE sku = ? COLLATE NOCASE AND company_id = ? AND active = 1")
            .get(item.customSku, user.company_id)
          : null
        : db.prepare("SELECT * FROM products WHERE id = ? AND company_id = ? AND active = 1")
          .get(item.productId, user.company_id);
      if (item.isCustom && item.customSku && !product) {
        throw Object.assign(new Error(`No existe un producto activo con el SKU ${item.customSku}.`), { status: 404 });
      }
      if (!item.isCustom && !product) {
        throw Object.assign(new Error("Un producto no existe o no está disponible."), { status: 404 });
      }
      const unitPriceCents = item.isCustom
        ? item.customUnitPriceCents
        : item.submittedUnitPriceCents !== null
          ? item.submittedUnitPriceCents
        : options.useStoredPrices
          ? item.storedUnitPriceCents
          : kind === "sale"
          ? product[["price_cents", "price2_cents", "price3_cents"][item.priceTier - 1]]
          : product.cost_cents;
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
        throw Object.assign(new Error("El precio del artículo no es válido."), { status: 400 });
      }
      const grossCents = Math.round((item.quantityMilli * unitPriceCents) / 1000);
      const discountCents = Math.round((grossCents * item.discountBasisPoints) / 10000);
      const subtotalCents = grossCents - discountCents;
      if (!Number.isSafeInteger(grossCents) || !Number.isSafeInteger(subtotalCents)) {
        throw Object.assign(new Error("El importe del movimiento excede el límite permitido."), { status: 400 });
      }
      return { ...item, product, unitPriceCents, discountCents, subtotalCents };
    });
    const subtotalCents = transactionItems.reduce((sum, item) => sum + item.subtotalCents, 0);
    const generalDiscountCents = Math.round((subtotalCents * generalDiscountBasisPoints) / 10000);
    const totalCents = subtotalCents - generalDiscountCents;
    if (!Number.isSafeInteger(totalCents)) {
      throw Object.assign(new Error("El importe total excede el límite permitido."), { status: 400 });
    }
    const allowedPaymentMethods = new Set(["cash", "debit", "credit", "transfer", "other"]);
    const submittedPayments = body.payments ?? [];
    if (!Array.isArray(submittedPayments) || submittedPayments.length > allowedPaymentMethods.size) {
      throw Object.assign(new Error("Seleccioná hasta cinco medios de pago."), { status: 400 });
    }
    const paymentMethods = new Set();
    const payments = submittedPayments.map((payment) => {
      if (!payment || !allowedPaymentMethods.has(payment.method)) {
        throw Object.assign(new Error("Uno de los medios de pago no es válido."), { status: 400 });
      }
      if (paymentMethods.has(payment.method)) {
        throw Object.assign(new Error("Cada medio de pago debe aparecer una sola vez."), { status: 400 });
      }
      paymentMethods.add(payment.method);
      return {
        method: payment.method,
        amountCents: decimalUnits(payment.amount, 2, "El importe del medio de pago")
      };
    }).filter((payment) => payment.amountCents > 0);
    const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (kind === "sale" && (paidCents > totalCents ||
        (saleMode === "paid" && paidCents !== totalCents) ||
        (saleMode === "deposit" && (paidCents < 1 || paidCents >= totalCents)))) {
      throw Object.assign(new Error(saleMode === "paid"
        ? "La suma de los medios de pago debe coincidir con el total de la venta."
        : "La seña debe ser mayor que cero y menor que el total de la venta."), { status: 400 });
    }
    const sequence = nextTransactionNumber(user.company_id, kind);
    const number = `${kind === "sale" ? "V" : "C"}-${String(sequence).padStart(6, "0")}`;
    const transactionId = Number(db.prepare(`
      INSERT INTO transactions (
        company_id, branch_id, user_id, kind, sale_mode, number, contact, total_cents, general_discount_basis_points,
        contact_tax_id, contact_vat_condition, contact_address, contact_phone, contact_email,
        customer_id, cash_session_id, salesperson_user_id, salesperson_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.company_id, user.branch_id, user.id, kind, saleMode, number, contact, totalCents, generalDiscountBasisPoints,
      contactTaxId, contactVatCondition, kind === "purchase" ? purchasePlace : contactAddress, contactPhone, contactEmail,
      customer?.id || null, cashSession?.id || null,
      options.salespersonUserId || user.id,
      options.salespersonName || user.display_name || user.username
    ).lastInsertRowid);
    if (purchaseDocument) {
      db.prepare(`
        INSERT INTO transaction_documents (transaction_id, file_name, media_type, file_size, content)
        VALUES (?, ?, ?, ?, ?)
      `).run(transactionId, purchaseDocument.fileName, purchaseDocument.mediaType,
        purchaseDocument.content.length, purchaseDocument.content);
    }
    const addPayment = db.prepare(`
      INSERT INTO transaction_payments (transaction_id, method, amount_cents)
      VALUES (?, ?, ?)
    `);
    for (const payment of payments) {
      addPayment.run(transactionId, payment.method, payment.amountCents);
    }
    const addItem = db.prepare(`
      INSERT INTO transaction_items
        (transaction_id, product_id, product_name, sku, quantity_milli, unit_price_cents, discount_basis_points, price_tier, subtotal_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const stockEffects = new Map();
    for (const item of transactionItems) {
      addItem.run(transactionId, item.product?.id ?? null, item.isCustom ? item.name : item.product?.name, item.product?.sku || item.customSku || "", item.quantityMilli, item.unitPriceCents, item.discountBasisPoints, item.priceTier, item.subtotalCents);
      if (item.isCustom && !item.product) continue;
      let components = [];
      if (kind === "sale") {
        const recipe = db.prepare("SELECT id FROM recipes WHERE company_id = ? AND product_id = ?")
          .get(user.company_id, item.product.id);
        if (recipe) {
          components = db.prepare(`
            SELECT product_id AS productId, quantity_milli AS quantityMilli
            FROM recipe_components WHERE recipe_id = ?
          `).all(recipe.id);
        }
      }
      if (!components.length) components = [{ productId: item.product.id, quantityMilli: 1000 }];
      for (const component of components) {
        const quantityMilli = kind === "sale"
          ? Math.round((component.quantityMilli * item.quantityMilli) / 1000)
          : item.quantityMilli;
        if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 1) {
          throw Object.assign(new Error(`La cantidad de inventario para ${item.product.name} es demasiado pequeña.`), { status: 400 });
        }
        const totalQuantity = (stockEffects.get(component.productId) || 0) + quantityMilli;
        if (!Number.isSafeInteger(totalQuantity)) {
          throw Object.assign(new Error("La cantidad total de inventario excede el límite permitido."), { status: 400 });
        }
        stockEffects.set(component.productId, totalQuantity);
      }
    }
    const addStockEffect = db.prepare(`
      INSERT INTO transaction_stock_effects (transaction_id, product_id, quantity_milli) VALUES (?, ?, ?)
    `);
    for (const [productId, quantityMilli] of stockEffects) {
      applyStockMovement(user.company_id, user.branch_id, productId, quantityMilli, kind);
      addStockEffect.run(transactionId, productId, quantityMilli);
    }
    writeAudit(user, "create", kind, transactionId, `${number}; ${contact}; ${totalCents / 100}`);
    return serializeTransaction({
      id: transactionId,
      kind,
      number,
      contact,
      contact_tax_id: contactTaxId,
      contact_vat_condition: contactVatCondition,
      contact_address: kind === "purchase" ? purchasePlace : contactAddress,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      general_discount_basis_points: generalDiscountBasisPoints,
      sale_mode: saleMode,
      total_cents: totalCents,
      salesperson_name: options.salespersonName || user.display_name || user.username,
      created_at: db.prepare("SELECT created_at FROM transactions WHERE id = ?").get(transactionId).created_at,
      items: transactionItems.map((item) => ({
        name: item.isCustom ? item.name : item.product?.name,
        sku: item.product?.sku || item.customSku || "",
        quantity: item.quantityMilli / 1000,
        unitPrice: item.unitPriceCents / 100,
        discountPercent: item.discountBasisPoints / 100,
        gross: (item.discountCents + item.subtotalCents) / 100,
        discount: item.discountCents / 100,
        subtotal: item.subtotalCents / 100
      })),
      payments: payments.map((payment) => ({ method: payment.method, amount: payment.amountCents / 100 })),
      createdBy: user.username,
      customerId: customer?.id || null,
      cashSessionId: cashSession?.id || null
    });
  };
  return options.withinTransaction ? create() : beginTransaction(create);
}

function listRecipes(companyId) {
  return db.prepare(`
    SELECT recipes.id, products.id AS product_id, products.name AS product_name, products.sku AS product_sku
    FROM recipes JOIN products ON products.id = recipes.product_id
    WHERE recipes.company_id = ? ORDER BY products.name
  `).all(companyId).map((recipe) => ({
    id: recipe.id,
    productId: recipe.product_id,
    productName: recipe.product_name,
    productSku: recipe.product_sku,
    components: db.prepare(`
      SELECT products.id AS productId, products.name, products.sku,
        recipe_components.quantity_milli / 1000.0 AS quantity
      FROM recipe_components JOIN products ON products.id = recipe_components.product_id
      WHERE recipe_components.recipe_id = ? ORDER BY products.name
    `).all(recipe.id)
  }));
}

function validateRecipeComponents(body) {
  if (!Array.isArray(body.components) || body.components.length < 2 || body.components.length > 50) {
    throw Object.assign(new Error("Una receta debe combinar entre 2 y 50 productos."), { status: 400 });
  }
  const ids = new Set();
  return body.components.map((component) => {
    if (!component || !Number.isSafeInteger(component.productId) || component.productId < 1 || ids.has(component.productId)) {
      throw Object.assign(new Error("Cada ingrediente debe ser un producto válido y aparecer una sola vez."), { status: 400 });
    }
    ids.add(component.productId);
    return {
      productId: component.productId,
      quantityMilli: decimalUnits(component.quantity, 3, "La cantidad de cada ingrediente", { allowZero: false })
    };
  });
}

function createUserSession(response, userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    hashSessionToken(token),
    userId,
    Math.floor(Date.now() / 1000) + sessionLifetimeSeconds
  );
  setSessionCookie(response, token);
  return token;
}

const scannerQueues = new Map();

async function handleApi(request, response, url) {
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/platform/session") {
    return sendJson(response, 200, { authenticated: Boolean(platformSession(request)) });
  }

  if (request.method === "POST" && pathname === "/api/platform/login") {
    const configuredEmail = platformAdminEmail();
    const configuredPassword = process.env.PLATFORM_ADMIN_PASSWORD || "";
    if (!configuredEmail || configuredPassword.length < 8) {
      return sendJson(response, 503, {
        error: "El panel global no está configurado. Definí PLATFORM_ADMIN_EMAIL y una PLATFORM_ADMIN_PASSWORD de al menos 8 caracteres."
      });
    }
    const address = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempts = (platformLoginAttempts.get(address) || []).filter((time) => now - time < 15 * 60 * 1000);
    if (attempts.length >= 8) {
      platformLoginAttempts.set(address, attempts);
      return sendJson(response, 429, { error: "Demasiados intentos. Esperá 15 minutos antes de probar de nuevo." });
    }
    const body = await requestBody(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!safeEqual(email, configuredEmail) || !safeEqual(password, configuredPassword)) {
      attempts.push(now);
      platformLoginAttempts.set(address, attempts);
      return sendJson(response, 401, { error: "El correo o la contraseña no son correctos." });
    }
    platformLoginAttempts.delete(address);
    const token = randomBytes(32).toString("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + platformSessionLifetimeSeconds;
    db.prepare("INSERT INTO platform_sessions (token_hash, email, expires_at) VALUES (?, ?, ?)")
      .run(hashSessionToken(token), configuredEmail, expiresAt);
    setPlatformSessionCookie(response, token);
    return sendJson(response, 200, { admin: { email: configuredEmail } });
  }

  if (request.method === "POST" && pathname === "/api/platform/logout") {
    const token = request.headers.cookie?.match(/(?:^|;\s*)tonoto_platform_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) db.prepare("DELETE FROM platform_sessions WHERE token_hash = ?").run(hashSessionToken(token));
    setPlatformSessionCookie(response, "", 0);
    return sendJson(response, 200, { ok: true });
  }

  if (pathname.startsWith("/api/platform/")) {
    const admin = platformSession(request);
    if (!admin || admin.email !== platformAdminEmail()) {
      return sendJson(response, 401, { error: "Iniciá sesión como administrador global." });
    }
    if (request.method === "GET" && pathname === "/api/platform/companies") {
      const companies = db.prepare(`
        SELECT companies.id, companies.name, companies.subscription_state AS status,
          companies.subscription_plan AS plan, companies.subscription_until AS subscriptionUntil,
          CASE WHEN companies.subscription_until <> '' AND
            companies.subscription_until < date('now', '-3 hours') THEN 1 ELSE 0 END AS expired,
          companies.created_at AS createdAt, COUNT(users.id) AS userCount
        FROM companies LEFT JOIN users ON users.company_id = companies.id
        GROUP BY companies.id ORDER BY companies.id DESC
      `).all();
      return sendJson(response, 200, {
        companies,
        firebase: {
          configured: Boolean(firestore),
          projectId: process.env.FIREBASE_PROJECT_ID || "tonotogestion",
          queuedSyncs: db.prepare("SELECT COUNT(*) AS count FROM firebase_sync_jobs").get().count,
          syncFailures: db.prepare(`
            SELECT companies.name AS company, firebase_sync_jobs.attempts, firebase_sync_jobs.last_error AS error
            FROM firebase_sync_jobs JOIN companies ON companies.id = firebase_sync_jobs.company_id
            WHERE firebase_sync_jobs.last_error <> '' ORDER BY firebase_sync_jobs.requested_at DESC LIMIT 5
          `).all()
        }
      });
    }

    if (request.method === "POST" && pathname === "/api/platform/companies") {
      const body = await requestBody(request);
      const companyName = requiredText(body.company, "el nombre de la empresa", 120);
      const username = requiredUsername(body.username);
      const industries = requestedCompanyIndustries(body.industries);
      const subscriptionStatus = body.status ?? "active";
      if (!["active", "suspended", "cancelled"].includes(subscriptionStatus)) {
        throw Object.assign(new Error("Elegí un estado de suscripción válido."), { status: 400 });
      }
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
        throw Object.assign(new Error("La contraseña debe tener entre 8 y 128 caracteres."), { status: 400 });
      }
      const subscriptionUntil = optionalIsoDate(body.subscriptionUntil, "La fecha de vencimiento");
      const created = beginTransaction(() => {
        if (db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username)) {
          throw Object.assign(new Error("Ese usuario ya está utilizado en otra empresa."), { status: 409 });
        }
        const companyId = Number(db.prepare(`
          INSERT INTO companies (name, subscription_status, subscription_state, subscription_plan, subscription_until)
          VALUES (?, ?, ?, ?, ?)
        `).run(companyName, subscriptionStatus === "cancelled" ? "suspended" : subscriptionStatus,
          subscriptionStatus, optionalText(body.plan, 40) || "standard", subscriptionUntil).lastInsertRowid);
        const branchId = mainBranchId(companyId);
        const saveIndustry = db.prepare(
          "INSERT INTO company_industries (company_id, industry) VALUES (?, ?)"
        );
        const saveTemplateProduct = db.prepare(`
          INSERT INTO products (
            company_id, sku, name, category, cost_cents, discounted_cost_cents,
            price_with_vat_cents, price_cents, price2_cents, price3_cents, stock_milli
          ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
        `);
        for (const industry of industries) {
          const template = industryTemplates[industry];
          saveIndustry.run(companyId, industry);
          template.products.forEach((productName, index) => {
            const sku = `INI-${industry.slice(0, 3).toUpperCase()}-${String(index + 1).padStart(3, "0")}`;
            saveTemplateProduct.run(companyId, sku, productName, template.name);
          });
        }
        db.prepare(`
          INSERT INTO branch_stock (branch_id, product_id)
          SELECT ?, id FROM products WHERE company_id = ?
        `).run(branchId, companyId);
        db.prepare("INSERT INTO company_receipt_settings (company_id, business_name, legal_name) VALUES (?, ?, ?)")
          .run(companyId, companyName, companyName);
        const displayName = optionalText(body.displayName, 80) || username;
        const userId = Number(db.prepare(
          "INSERT INTO users (company_id, email, username, display_name, password_hash, is_admin, access_role) VALUES (?, ?, ?, ?, ?, 1, 'admin')"
        ).run(companyId, `${username}@users.tonotogestion.local`, username, displayName,
          passwordHash(body.password)).lastInsertRowid);
        assignUserBranch(userId, branchId);
        db.prepare(`
          INSERT INTO cash_register_sessions (company_id, branch_id, opened_by, opening_amount_cents)
          VALUES (?, ?, ?, 0)
        `).run(companyId, branchId, userId);
        return { companyId, userId };
      });
      recordPlatformAction(admin, "create-company", created.companyId, `${companyName}; ${username}`);
      enqueueFirebaseSync(created.companyId);
      return sendJson(response, 201, { company: { id: created.companyId, name: companyName, ownerUsername: username } });
    }

    const platformCompanyMatch = pathname.match(/^\/api\/platform\/companies\/(\d+)$/);
    if (platformCompanyMatch && request.method === "DELETE") {
      const companyId = Number(platformCompanyMatch[1]);
      if (!db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId)) {
        return sendJson(response, 404, { error: "No se encontró la empresa." });
      }
      if (companiesPendingDeletion.has(companyId)) {
        return sendJson(response, 409, { error: "La empresa ya se está eliminando." });
      }
      companiesPendingDeletion.add(companyId);
      let localDeleted = false;
      try {
        const activeSync = activeSyncs.get(companyId);
        if (activeSync) await activeSync;
        if (firestore) await firestore.recursiveDelete(firestore.collection("tenants").doc(String(companyId)));
        beginTransaction(() => deleteCompanyData(companyId));
        localDeleted = true;
        recordPlatformAction(admin, "delete-company", companyId, "Empresa y datos asociados eliminados");
        return sendJson(response, 200, { ok: true });
      } catch (error) {
        if (!localDeleted && firestore) {
          companiesPendingDeletion.delete(companyId);
          enqueueFirebaseSync(companyId);
        }
        throw error;
      } finally {
        companiesPendingDeletion.delete(companyId);
      }
    }
    if (platformCompanyMatch && request.method === "PUT") {
      const body = await requestBody(request);
      if (!["active", "suspended", "cancelled"].includes(body.status)) {
        throw Object.assign(new Error("El estado debe ser active, suspended o cancelled."), { status: 400 });
      }
      const companyId = Number(platformCompanyMatch[1]);
      const currentCompany = db.prepare("SELECT subscription_plan, subscription_until, subscription_state FROM companies WHERE id = ?")
        .get(companyId);
      if (!currentCompany) return sendJson(response, 404, { error: "No se encontró la empresa." });
      const plan = body.plan === undefined ? currentCompany.subscription_plan : optionalText(body.plan, 40);
      const subscriptionUntil = body.subscriptionUntil === undefined
        ? currentCompany.subscription_until
        : optionalIsoDate(body.subscriptionUntil, "La fecha de vencimiento");
      const result = db.prepare(`
        UPDATE companies SET subscription_status = ?, subscription_state = ?, subscription_plan = ?, subscription_until = ?
        WHERE id = ?
      `).run(body.status === "cancelled" ? "suspended" : body.status,
        body.status, plan || "standard", subscriptionUntil, companyId);
      if (Number(result.changes) !== 1) return sendJson(response, 404, { error: "No se encontró la empresa." });
      if (body.status !== "active") {
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)")
          .run(companyId);
      }
      recordPlatformAction(admin, `subscription-${body.status}`, companyId, subscriptionUntil || "");
      enqueueFirebaseSync(companyId);
      return sendJson(response, 200, { ok: true });
    }

    const platformUsersMatch = pathname.match(/^\/api\/platform\/companies\/(\d+)\/users$/);
    if (platformUsersMatch) {
      const companyId = Number(platformUsersMatch[1]);
      const company = db.prepare("SELECT id, name FROM companies WHERE id = ?").get(companyId);
      if (!company) return sendJson(response, 404, { error: "No se encontró la empresa." });
      if (request.method === "GET") {
        const users = db.prepare(`
          SELECT id, username, display_name AS displayName, access_role AS role, created_at AS createdAt
          FROM users WHERE company_id = ? ORDER BY id
        `).all(companyId);
        return sendJson(response, 200, { company, users });
      }
      if (request.method === "POST") {
        const body = await requestBody(request);
        const username = requiredUsername(body.username);
        if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
          throw Object.assign(new Error("La contraseña debe tener entre 8 y 128 caracteres."), { status: 400 });
        }
        const role = body.role;
        if (!["admin", "manager", "cashier", "seller"].includes(role)) {
          throw Object.assign(new Error("Elegí un perfil válido."), { status: 400 });
        }
        const userId = beginTransaction(() => {
          if (db.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE").get(username)) {
            throw Object.assign(new Error("Ese usuario ya está utilizado en otra empresa."), { status: 409 });
          }
          const userId = Number(db.prepare(`
            INSERT INTO users (company_id, email, username, display_name, password_hash, is_admin, access_role)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(companyId, `${username}@users.tonotogestion.local`, username,
            optionalText(body.displayName, 80) || username, passwordHash(body.password),
            role === "admin" ? 1 : 0, role).lastInsertRowid);
          assignUserBranch(userId, mainBranchId(companyId));
          return userId;
        });
        recordPlatformAction(admin, "create-user", companyId, `${username} (${role})`);
        enqueueFirebaseSync(companyId);
        return sendJson(response, 201, {
          user: { id: userId, username, displayName: optionalText(body.displayName, 80) || username, role }
        });
      }
    }

    if (request.method === "GET" && pathname === "/api/platform/audit") {
      const entries = db.prepare(`
        SELECT id, admin_email AS adminEmail, action, company_id AS companyId, details, created_at AS createdAt
        FROM platform_audit_log ORDER BY id DESC LIMIT 200
      `).all();
      return sendJson(response, 200, { entries });
    }

    const platformUserMatch = pathname.match(
      /^\/api\/platform\/companies\/(\d+)\/users\/(\d+)(?:\/password)?$/
    );
    if (platformUserMatch) {
      const companyId = Number(platformUserMatch[1]);
      const userId = Number(platformUserMatch[2]);
      const target = db.prepare(`
        SELECT id, username, display_name, access_role AS role FROM users WHERE id = ? AND company_id = ?
      `).get(userId, companyId);
      if (!target) return sendJson(response, 404, { error: "No se encontró ese usuario de la empresa." });

      if (request.method === "POST" && pathname.endsWith("/password")) {
        const body = await requestBody(request);
        if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
          throw Object.assign(new Error("La contraseña debe tener entre 8 y 128 caracteres."), { status: 400 });
        }
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND company_id = ?")
          .run(passwordHash(body.password), userId, companyId);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
        recordPlatformAction(admin, "reset-user-password", companyId, target.username);
        enqueueFirebaseSync(companyId);
        return sendJson(response, 200, { ok: true });
      }

      if (request.method === "PUT" && !pathname.endsWith("/password")) {
        const body = await requestBody(request);
        const role = body.role === undefined ? target.role : body.role;
        if (!["admin", "manager", "cashier", "seller"].includes(role)) {
          throw Object.assign(new Error("Elegí un perfil válido."), { status: 400 });
        }
        const displayName = body.displayName === undefined
          ? target.display_name
          : requiredText(body.displayName, "el nombre visible", 80);
        if (target.role === "admin" && role !== "admin" &&
            db.prepare("SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND access_role = 'admin'")
              .get(companyId).count <= 1) {
          throw Object.assign(new Error("La empresa debe conservar al menos un administrador."), { status: 409 });
        }
        db.prepare("UPDATE users SET access_role = ?, is_admin = ?, display_name = ? WHERE id = ? AND company_id = ?")
          .run(role, role === "admin" ? 1 : 0, displayName, userId, companyId);
        if (role !== target.role) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
        recordPlatformAction(admin, "update-user", companyId, `${target.username}; ${displayName}; ${role}`);
        enqueueFirebaseSync(companyId);
        return sendJson(response, 200, { ok: true, user: { id: userId, username: target.username, displayName, role } });
      }

      if (request.method === "DELETE" && !pathname.endsWith("/password")) {
        if (target.role === "admin" &&
            db.prepare("SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND access_role = 'admin'")
              .get(companyId).count <= 1) {
          throw Object.assign(new Error("La empresa debe conservar al menos un administrador."), { status: 409 });
        }
        const replacementUser = db.prepare(`
          SELECT id FROM users WHERE company_id = ? AND id <> ?
          ORDER BY CASE access_role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 1
        `).get(companyId, userId);
        if (!replacementUser) {
          throw Object.assign(new Error("No se puede eliminar el único usuario de la empresa."), { status: 409 });
        }
        beginTransaction(() => {
          db.prepare(`
            UPDATE transactions SET user_id = ?, salesperson_user_id =
              CASE WHEN salesperson_user_id = ? THEN NULL ELSE salesperson_user_id END
            WHERE company_id = ? AND user_id = ?
          `).run(replacementUser.id, userId, companyId, userId);
          db.prepare("UPDATE quotes SET user_id = ? WHERE company_id = ? AND user_id = ?")
            .run(replacementUser.id, companyId, userId);
          db.prepare("UPDATE sales_orders SET user_id = ? WHERE company_id = ? AND user_id = ?")
            .run(replacementUser.id, companyId, userId);
          db.prepare("UPDATE cash_register_sessions SET opened_by = ? WHERE company_id = ? AND opened_by = ?")
            .run(replacementUser.id, companyId, userId);
          db.prepare("UPDATE cash_register_sessions SET closed_by = ? WHERE company_id = ? AND closed_by = ?")
            .run(replacementUser.id, companyId, userId);
          recordPlatformAction(admin, "delete-user", companyId, `${target.username}; historial conservado`);
          db.prepare("DELETE FROM users WHERE id = ? AND company_id = ?").run(userId, companyId);
        });
        enqueueFirebaseSync(companyId);
        return sendJson(response, 200, { ok: true });
      }
    }

    return sendJson(response, 404, { error: "No se encontró esa operación del panel global." });
  }

  if (request.method === "GET" && pathname === "/api/session") {
    const user = sessionUser(request);
    return sendJson(response, 200, {
      needsSetup: process.env.NODE_ENV === "test" &&
        !platformAdminEmail() && !db.prepare("SELECT 1 FROM users LIMIT 1").get(),
      user: user ? {
        username: user.username, displayName: user.display_name || user.username,
        email: user.username, role: user.access_role,
        company: user.company_name, companyId: user.company_id, isAdmin: user.access_role === "admin",
        branchId: user.branch_id, branchName: user.branch_name,
        subscriptionExpired: Boolean(user.subscription_expired),
        subscriptionUntil: user.subscription_until || ""
      } : null
    });
  }

  if ((request.method === "GET" || request.method === "POST") && pathname === "/api/online-verification") {
    const user = sessionUser(request);
    if (!user) return sendJson(response, 401, { error: "Iniciá sesión para verificar la conexión." });

    const deviceId = String(request.headers["x-tonotos-device-id"] || "");
    if (!/^[a-f0-9]{32}$/.test(deviceId)) {
      return sendJson(response, 400, { error: "No se pudo identificar esta PC. Recargá la aplicación para volver a intentar." });
    }

    if (request.method === "GET") {
      const verification = db.prepare(`
        SELECT verified_at AS verifiedAt FROM online_verifications
        WHERE device_id = ? AND user_id = ?
      `).get(deviceId, user.id);
      const verifiedAt = verification?.verifiedAt || null;
      return sendJson(response, 200, {
        configured: Boolean(firestore),
        projectId: process.env.FIREBASE_PROJECT_ID || "tonotogestion",
        verifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null,
        due: !verifiedAt || Date.now() - verifiedAt >= onlineVerificationLifetimeMs,
        expiresInMs: verifiedAt
          ? Math.max(0, verifiedAt + onlineVerificationLifetimeMs - Date.now())
          : 0
      });
    }

    if (!firestore) {
      return sendJson(response, 503, {
        error: "La verificación en línea no está disponible. El administrador debe configurar Firebase en la PC servidor."
      });
    }

    const verifiedAt = Date.now();
    db.prepare(`
      INSERT INTO online_verifications (device_id, user_id, verified_at)
      VALUES (?, ?, ?)
      ON CONFLICT (device_id, user_id) DO UPDATE SET verified_at = excluded.verified_at
    `).run(deviceId, user.id, verifiedAt);
    return sendJson(response, 200, {
      verifiedAt: new Date(verifiedAt).toISOString(),
      expiresInMs: onlineVerificationLifetimeMs
    });
  }

  if (request.method === "POST" && pathname === "/api/setup") {
    if (process.env.NODE_ENV !== "test" || platformAdminEmail()) {
      return sendJson(response, 403, { error: "Las cuentas se crean desde el panel de administración global." });
    }
    const body = await requestBody(request);
    const companyName = requiredText(body.company, "el nombre de la empresa");
    const email = requiredText(body.email, "un correo electrónico", 254).toLowerCase();
    const password = body.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error("Ingresá un correo electrónico válido."), { status: 400 });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      throw Object.assign(new Error("La contraseña debe tener entre 8 y 128 caracteres."), { status: 400 });
    }
    const username = requiredUsername(email.split("@")[0]);
    const userId = beginTransaction(() => {
      if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
        throw Object.assign(new Error("La configuración inicial ya se completó."), { status: 409 });
      }
      const companyId = Number(db.prepare("INSERT INTO companies (name) VALUES (?)").run(companyName).lastInsertRowid);
      const branchId = mainBranchId(companyId);
      db.prepare("INSERT INTO company_receipt_settings (company_id, business_name, legal_name) VALUES (?, ?, ?)")
        .run(companyId, companyName, companyName);
      const id = Number(db.prepare(`
        INSERT INTO users (company_id, email, username, display_name, password_hash, is_admin, access_role)
        VALUES (?, ?, ?, ?, ?, 1, 'admin')
      `).run(companyId, email, username, username, passwordHash(password)).lastInsertRowid);
      assignUserBranch(id, branchId);
      db.prepare(`
        INSERT INTO cash_register_sessions (company_id, branch_id, opened_by, opening_amount_cents)
        VALUES (?, ?, ?, 0)
      `).run(companyId, branchId, id);
      return id;
    });
    createUserSession(response, userId);
    const companyId = db.prepare("SELECT company_id FROM users WHERE id = ?").get(userId).company_id;
    enqueueFirebaseSync(companyId);
    return sendJson(response, 201, { user: { email, company: companyName, companyId, isAdmin: true } });
  }

  if (request.method === "POST" && pathname === "/api/login") {
    const address = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempts = (loginAttempts.get(address) || []).filter((time) => now - time < 15 * 60 * 1000);
    if (attempts.length >= 8) {
      loginAttempts.set(address, attempts);
      return sendJson(response, 429, { error: "Demasiados intentos. Esperá 15 minutos antes de probar de nuevo." });
    }
    const body = await requestBody(request);
    const usernameInput = typeof body.username === "string"
      ? body.username.trim().toLowerCase()
      : typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const username = typeof body.username === "string"
      ? usernameInput
      : usernameInput.includes("@") ? usernameInput.split("@")[0] : usernameInput;
    const password = typeof body.password === "string" ? body.password : "";
    const user = db.prepare(`
      SELECT users.id, users.username, users.display_name, users.password_hash, users.access_role,
        companies.subscription_state, companies.subscription_until
      FROM users JOIN companies ON companies.id = users.company_id WHERE users.username = ? COLLATE NOCASE
    `).get(username);
    const passwordValid = verifyPassword(password, user?.password_hash || `${Buffer.alloc(16, 7).toString("hex")}:${dummyPasswordHash.toString("hex")}`);
    if (!user || !passwordValid) {
      attempts.push(now);
      loginAttempts.set(address, attempts);
      return sendJson(response, 401, { error: "El usuario o la contraseña no son correctos." });
    }
    if (user.subscription_state !== "active") {
      if (user.subscription_state === "cancelled") {
        return sendJson(response, 403, {
          subscriptionCancelled: true,
          error: "Agradecemos de corazón la confianza que depositaste en Tonotos Gestión y el tiempo que compartimos acompañando a tu empresa. Si más adelante querés volver, acá estaremos para recibirte con las puertas abiertas."
        });
      }
      return sendJson(response, 403, {
        error: "La suscripción de esta empresa está suspendida. Contactá al administrador del sistema."
      });
    }
    if (user.subscription_until && user.subscription_until < db.prepare("SELECT date('now', '-3 hours') AS today").get().today) {
      return sendJson(response, 403, {
        error: "La suscripción de esta empresa venció. Aboná el servicio y contactá al administrador para reactivarla.",
        subscriptionExpired: true
      });
    }
    loginAttempts.delete(address);
    const token = createUserSession(response, user.id);
    const loggedInUser = db.prepare(`
      SELECT users.company_id, users.home_branch_id, users.access_role, users.display_name,
        branches.name AS branch_name, companies.name AS company,
        companies.subscription_until
      FROM users JOIN companies ON companies.id = users.company_id
      LEFT JOIN branches ON branches.id = users.home_branch_id
      WHERE users.id = ?
    `).get(user.id);
    return sendJson(response, 200, {
      user: {
        username: user.username, displayName: loggedInUser.display_name || user.username,
        email: user.username, role: loggedInUser.access_role,
        company: loggedInUser.company, companyId: loggedInUser.company_id,
        isAdmin: loggedInUser.access_role === "admin",
        branchId: loggedInUser.home_branch_id, branchName: loggedInUser.branch_name || "Casa Central",
        subscriptionExpired: false, subscriptionUntil: loggedInUser.subscription_until || ""
      },
      token
    });
  }

  if (request.method === "POST" && pathname === "/api/logout") {
    let token = null;
    const match = request.headers.cookie?.match(/(?:^|;\s*)gestion_session=([a-f0-9]{64})(?:;|$)/);
    if (match) token = match[1];
    else if (request.headers["authorization"]?.toLowerCase().startsWith("bearer ")) token = request.headers["authorization"].substring(7).trim();
    else if (request.headers["x-session-token"]) token = String(request.headers["x-session-token"]).trim();
    if (token && /^[a-f0-9]{64}$/.test(token)) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
    setSessionCookie(response, "", 0);
    return sendJson(response, 200, { ok: true });
  }

  const user = sessionUser(request);
  if (!user) return sendJson(response, 401, { error: "Iniciá sesión para continuar." });
  if (user.subscription_expired) {
    return sendJson(response, 402, {
      error: "La suscripción venció. Aboná el servicio y contactá al administrador para recuperar el acceso.",
      subscriptionExpired: true,
      subscriptionUntil: user.subscription_until
    });
  }

  if (pathname === "/api/branches" && request.method === "GET") {
    const branches = listUserBranches(user).map((branch) => ({
      id: branch.id,
      name: branch.name,
      active: true,
      selected: branch.id === user.branch_id
    }));
    const users = user.access_role === "admin"
      ? db.prepare(`
        SELECT users.id, users.username, users.display_name AS displayName,
          users.access_role AS role, users.home_branch_id AS branchId,
          branches.name AS branchName
        FROM users LEFT JOIN branches ON branches.id = users.home_branch_id
        WHERE users.company_id = ? ORDER BY users.username
      `).all(user.company_id)
      : [];
    return sendJson(response, 200, { branches, users });
  }

  if (pathname === "/api/branches" && request.method === "POST") {
    requireAdmin(user);
    const body = await requestBody(request);
    const name = requiredText(body.name, "el nombre de la sucursal", 80);
    try {
      const branchId = Number(db.prepare(
        "INSERT INTO branches (company_id, name) VALUES (?, ?)"
      ).run(user.company_id, name).lastInsertRowid);
      db.prepare(`
        INSERT INTO branch_stock (branch_id, product_id)
        SELECT ?, id FROM products WHERE company_id = ?
      `).run(branchId, user.company_id);
      writeAudit(user, "create", "branch", branchId, name);
      enqueueFirebaseSync(user.company_id);
      return sendJson(response, 201, { branch: { id: branchId, name, active: true } });
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 2067) {
        return sendJson(response, 409, { error: "Ya existe una sucursal con ese nombre." });
      }
      throw error;
    }
  }

  const branchUserMatch = pathname.match(/^\/api\/branches\/users\/(\d+)$/);
  if (request.method === "PUT" && branchUserMatch) {
    requireAdmin(user);
    const body = await requestBody(request);
    const targetUserId = Number(branchUserMatch[1]);
    const branchId = Number(body.branchId);
    const target = db.prepare("SELECT id FROM users WHERE id = ? AND company_id = ?")
      .get(targetUserId, user.company_id);
    const branch = db.prepare("SELECT id, name FROM branches WHERE id = ? AND company_id = ? AND active = 1")
      .get(branchId, user.company_id);
    if (!target || !branch) {
      return sendJson(response, 404, { error: "No se encontró el usuario o la sucursal activa." });
    }
    if (targetUserId === user.id) {
      return sendJson(response, 409, { error: "No podés cambiar la sucursal de tu propia cuenta." });
    }
    db.prepare("DELETE FROM user_branches WHERE user_id = ?").run(targetUserId);
    assignUserBranch(targetUserId, branch.id);
    writeAudit(user, "assign", "user-branch", targetUserId, branch.name);
    enqueueFirebaseSync(user.company_id);
    return sendJson(response, 200, { ok: true, branchId: branch.id, branchName: branch.name });
  }

  if (pathname === "/api/branches/transfers" && request.method === "GET") {
    requireRoles(user, "admin", "manager");
    const transfers = db.prepare(`
      SELECT transfers.id, transfers.status, transfers.created_at AS createdAt,
        source.name AS fromBranch, destination.name AS toBranch,
        users.display_name AS createdBy, COUNT(items.id) AS itemCount
      FROM stock_transfers transfers
      JOIN branches source ON source.id = transfers.from_branch_id
      JOIN branches destination ON destination.id = transfers.to_branch_id
      JOIN users ON users.id = transfers.user_id
      LEFT JOIN stock_transfer_items items ON items.transfer_id = transfers.id
      WHERE transfers.company_id = ?
      GROUP BY transfers.id ORDER BY transfers.id DESC LIMIT 100
    `).all(user.company_id);
    return sendJson(response, 200, { transfers });
  }

  if (pathname === "/api/branches/transfers" && request.method === "POST") {
    requireRoles(user, "admin", "manager");
    const body = await requestBody(request);
    const fromBranchId = Number(body.fromBranchId);
    const toBranchId = Number(body.toBranchId);
    if (!Number.isSafeInteger(fromBranchId) || !Number.isSafeInteger(toBranchId) ||
        fromBranchId === toBranchId) {
      throw Object.assign(new Error("Elegí dos sucursales distintas."), { status: 400 });
    }
    const fromBranch = db.prepare(
      "SELECT id, name FROM branches WHERE id = ? AND company_id = ? AND active = 1"
    ).get(fromBranchId, user.company_id);
    const toBranch = db.prepare(
      "SELECT id, name FROM branches WHERE id = ? AND company_id = ? AND active = 1"
    ).get(toBranchId, user.company_id);
    if (!fromBranch || !toBranch) {
      throw Object.assign(new Error("Las sucursales de la transferencia deben estar activas y pertenecer a la empresa."), { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
      throw Object.assign(new Error("La transferencia debe incluir entre 1 y 100 productos."), { status: 400 });
    }
    const items = body.items.map((item) => ({
      productId: Number(item?.productId),
      quantityMilli: decimalUnits(item?.quantity, 3, "La cantidad transferida", { allowZero: false })
    }));
    if (items.some((item) => !Number.isSafeInteger(item.productId) || item.productId < 1) ||
        new Set(items.map((item) => item.productId)).size !== items.length) {
      throw Object.assign(new Error("Cada producto debe ser válido y aparecer una sola vez."), { status: 400 });
    }
    const transferId = beginTransaction(() => {
      for (const item of items) {
        const product = db.prepare(
          "SELECT id, name FROM products WHERE id = ? AND company_id = ? AND active = 1"
        ).get(item.productId, user.company_id);
        if (!product) throw Object.assign(new Error("La transferencia incluye un producto inactivo o inexistente."), { status: 404 });
        initializeBranchStock(fromBranchId, product.id);
        const stock = db.prepare(`
          SELECT stock_milli, stock_debt_milli FROM branch_stock
          WHERE branch_id = ? AND product_id = ?
        `).get(fromBranchId, product.id);
        if (stock.stock_milli - stock.stock_debt_milli < item.quantityMilli) {
          throw Object.assign(new Error(`Stock insuficiente en ${fromBranch.name} para ${product.name}.`), { status: 409 });
        }
      }
      const id = Number(db.prepare(`
        INSERT INTO stock_transfers (company_id, from_branch_id, to_branch_id, user_id)
        VALUES (?, ?, ?, ?)
      `).run(user.company_id, fromBranchId, toBranchId, user.id).lastInsertRowid);
      const addItem = db.prepare(
        "INSERT INTO stock_transfer_items (transfer_id, product_id, quantity_milli) VALUES (?, ?, ?)"
      );
      for (const item of items) {
        applyStockMovement(user.company_id, fromBranchId, item.productId, item.quantityMilli, "sale");
        applyStockMovement(user.company_id, toBranchId, item.productId, item.quantityMilli, "purchase");
        addItem.run(id, item.productId, item.quantityMilli);
      }
      return id;
    });
    writeAudit(user, "transfer", "stock", transferId, `${fromBranch.name} → ${toBranch.name}; ${items.length} productos`);
    enqueueFirebaseSync(user.company_id);
    return sendJson(response, 201, { transferId, fromBranch: fromBranch.name, toBranch: toBranch.name });
  }

  if (request.method === "GET" && pathname === "/api/update-info") {
    if (!existsSync(releaseInfoPath)) return sendJson(response, 200, { update: null });
    const update = JSON.parse(readFileSync(releaseInfoPath, "utf8").replace(/^\uFEFF/, ""));
    return sendJson(response, 200, {
      update: {
        tag: String(update.tag || ""),
        name: String(update.name || ""),
        publishedAt: String(update.publishedAt || ""),
        releaseNotes: String(update.releaseNotes || "").slice(0, 20000),
        previousTag: String(update.previousTag || ""),
        commitLookupMessage: String(update.commitLookupMessage || ""),
        commits: Array.isArray(update.commits) ? update.commits.slice(0, 20).map((commit) => ({
          sha: String(commit.sha || "").slice(0, 12),
          message: String(commit.message || "").slice(0, 300)
        })) : []
      }
    }, { "Cache-Control": "no-store" });
  }

  if (request.method === "GET" && pathname === "/api/network-info") {
    const addresses = Object.values(os.networkInterfaces()).flatMap((entries) =>
      (entries || []).filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => entry.address));
    const address = addresses[0] || "";
    return sendJson(response, 200, {
      address: address ? `http://${address}:${port}` : `http://127.0.0.1:${port}`,
      port,
      addresses: addresses.map((ip) => `http://${ip}:${port}`)
    });
  }

  if (request.method === "POST" && pathname === "/api/scanner/scan") {
    const body = await requestBody(request);
    const barcode = String(body.barcode || body.code || "").trim();
    if (!barcode) return sendJson(response, 400, { error: "El código de barras es requerido." });
    const scannerQueueKey = `${user.company_id}:${user.branch_id}`;
    if (!scannerQueues.has(scannerQueueKey)) {
      scannerQueues.set(scannerQueueKey, []);
    }
    const queue = scannerQueues.get(scannerQueueKey);
    const event = {
      id: Date.now() + Math.random(),
      barcode,
      timestamp: Date.now(),
      userEmail: user.email
    };
    queue.push(event);
    if (queue.length > 50) queue.shift();
    return sendJson(response, 200, { ok: true, event });
  }

  if (request.method === "GET" && pathname === "/api/scanner/events") {
    const since = Number(url.searchParams.get("since") || 0);
    const queue = scannerQueues.get(`${user.company_id}:${user.branch_id}`) || [];
    const events = queue.filter((e) => e.id > since);
    return sendJson(response, 200, { events });
  }

  const purchaseDocumentMatch = pathname.match(/^\/api\/transactions\/(\d+)\/document$/);
  if (request.method === "GET" && purchaseDocumentMatch) {
    const document = db.prepare(`
      SELECT transaction_documents.file_name, transaction_documents.media_type, transaction_documents.content
      FROM transaction_documents
      JOIN transactions ON transactions.id = transaction_documents.transaction_id
      WHERE transactions.id = ? AND transactions.company_id = ? AND transactions.branch_id = ?
        AND transactions.kind = 'purchase'
    `).get(Number(purchaseDocumentMatch[1]), user.company_id, user.branch_id);
    if (!document) return sendJson(response, 404, { error: "No se encontró el comprobante adjunto." });
    const fallbackName = document.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    response.writeHead(200, {
      "Content-Type": document.media_type,
      "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(document.file_name)}`,
      "Content-Length": document.content.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    });
    return response.end(document.content);
  }

  if (request.method === "POST" && pathname === "/api/account/password") {
    return sendJson(response, 403, { error: "Los cambios de contraseña se gestionan desde la consola de administración." });
  }

  if (request.method === "PUT" && pathname === "/api/account/profile") {
    return sendJson(response, 403, { error: "El nombre visible se gestiona desde la consola de administración." });
  }

  if (pathname === "/api/customers" && request.method === "GET") {
    const customers = db.prepare(`
      SELECT * FROM customers WHERE company_id = ? AND active = 1 ORDER BY name
    `).all(user.company_id).map(serializeCustomer);
    return sendJson(response, 200, { customers });
  }

  if ((pathname === "/api/customers" && request.method === "POST") ||
      (/^\/api\/customers\/\d+$/.test(pathname) && ["PUT", "DELETE"].includes(request.method))) {
    requireRoles(user, "admin", "manager");
    const customerMatch = pathname.match(/^\/api\/customers\/(\d+)$/);
    if (request.method === "DELETE" && customerMatch) {
      const result = db.prepare(
        "UPDATE customers SET active = 0 WHERE id = ? AND company_id = ? AND active = 1"
      ).run(Number(customerMatch[1]), user.company_id);
      if (Number(result.changes) !== 1) return sendJson(response, 404, { error: "No se encontró ese cliente." });
      writeAudit(user, "archive", "customer", customerMatch[1], "Cliente archivado");
      return sendJson(response, 200, { ok: true });
    }
    const body = await requestBody(request);
    const name = requiredText(body.name, "el nombre del cliente", 120);
    const discountBasisPoints = decimalUnits(body.discountPercent ?? "0", 2, "El descuento del cliente");
    if (discountBasisPoints > 10000) {
      throw Object.assign(new Error("El descuento del cliente no puede superar el 100 %."), { status: 400 });
    }
    const fields = [
      name, optionalText(body.taxId, 32),
      optionalText(body.vatCondition, 80) || "Consumidor final",
      optionalText(body.phone, 40), optionalText(body.email, 254),
      optionalText(body.address, 200), discountBasisPoints
    ];
    const duplicate = db.prepare(`
      SELECT id FROM customers WHERE company_id = ? AND name = ? COLLATE NOCASE AND active = 1
        AND id != COALESCE(?, -1)
    `).get(user.company_id, name, customerMatch ? Number(customerMatch[1]) : null);
    if (duplicate) throw Object.assign(new Error("Ya existe un cliente con ese nombre."), { status: 409 });
    let customerId;
    if (request.method === "POST") {
      customerId = Number(db.prepare(`
        INSERT INTO customers (company_id, name, tax_id, vat_condition, phone, email, address, discount_basis_points)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(user.company_id, ...fields).lastInsertRowid);
      writeAudit(user, "create", "customer", customerId, name);
    } else {
      customerId = Number(customerMatch[1]);
      const result = db.prepare(`
        UPDATE customers SET name = ?, tax_id = ?, vat_condition = ?, phone = ?, email = ?,
          address = ?, discount_basis_points = ? WHERE id = ? AND company_id = ? AND active = 1
      `).run(...fields, customerId, user.company_id);
      if (Number(result.changes) !== 1) return sendJson(response, 404, { error: "No se encontró ese cliente." });
      writeAudit(user, "update", "customer", customerId, name);
    }
    const customer = db.prepare("SELECT * FROM customers WHERE id = ? AND company_id = ?")
      .get(customerId, user.company_id);
    return sendJson(response, request.method === "POST" ? 201 : 200, { customer: serializeCustomer(customer) });
  }

  if (pathname === "/api/accounts" && request.method === "GET") {
    requireRoles(user, "admin", "manager", "cashier", "seller");
    const accounts = db.prepare(`
      SELECT transactions.id AS transaction_id, transactions.number, transactions.contact,
        transactions.total_cents, transactions.created_at, customers.name AS customer_name,
        COALESCE((SELECT SUM(amount_cents) FROM transaction_payments WHERE transaction_id = transactions.id), 0) +
        COALESCE((SELECT SUM(amount_cents) FROM customer_account_payments WHERE transaction_id = transactions.id), 0) AS paid_cents
      FROM transactions JOIN customers ON customers.id = transactions.customer_id
      WHERE transactions.company_id = ? AND transactions.branch_id = ? AND transactions.kind = 'sale'
        AND transactions.sale_mode IN ('deposit', 'account')
        AND transactions.total_cents >
          COALESCE((SELECT SUM(amount_cents) FROM transaction_payments WHERE transaction_id = transactions.id), 0) +
          COALESCE((SELECT SUM(amount_cents) FROM customer_account_payments WHERE transaction_id = transactions.id), 0)
      ORDER BY transactions.created_at, transactions.id
    `).all(user.company_id, user.branch_id).map((entry) => ({
      transactionId: entry.transaction_id,
      number: entry.number,
      customerName: entry.customer_name,
      createdAt: entry.created_at,
      total: entry.total_cents / 100,
      paid: entry.paid_cents / 100,
      balance: (entry.total_cents - entry.paid_cents) / 100
    }));
    return sendJson(response, 200, { accounts });
  }

  const accountPaymentMatch = pathname.match(/^\/api\/accounts\/(\d+)\/payments$/);
  if (request.method === "POST" && accountPaymentMatch) {
    requireRoles(user, "admin", "manager", "cashier");
    const body = await requestBody(request);
    const allowedMethods = new Set(["cash", "debit", "credit", "transfer", "other"]);
    if (!allowedMethods.has(body.method)) throw Object.assign(new Error("Elegí un medio de pago válido."), { status: 400 });
    const amountCents = decimalUnits(body.amount, 2, "el importe del cobro", { allowZero: false });
    const transactionId = Number(accountPaymentMatch[1]);
    const result = beginTransaction(() => {
      const sale = db.prepare(`
        SELECT id, total_cents FROM transactions
        WHERE id = ? AND company_id = ? AND branch_id = ? AND kind = 'sale'
          AND sale_mode IN ('deposit', 'account')
      `).get(transactionId, user.company_id, user.branch_id);
      if (!sale) throw Object.assign(new Error("No se encontró una cuenta pendiente."), { status: 404 });
      const paid = db.prepare(`
        SELECT COALESCE((SELECT SUM(amount_cents) FROM transaction_payments WHERE transaction_id = ?), 0) +
          COALESCE((SELECT SUM(amount_cents) FROM customer_account_payments WHERE transaction_id = ?), 0) AS total
      `).get(transactionId, transactionId).total;
      if (amountCents > sale.total_cents - paid) {
        throw Object.assign(new Error("El cobro no puede superar el saldo pendiente."), { status: 400 });
      }
      const session = body.method === "cash"
        ? db.prepare("SELECT id FROM cash_register_sessions WHERE company_id = ? AND branch_id = ? AND closed_at IS NULL")
          .get(user.company_id, user.branch_id)
        : null;
      if (body.method === "cash" && !session) {
        throw Object.assign(new Error("Abrí la caja antes de registrar un cobro en efectivo."), { status: 409 });
      }
      db.prepare(`
        INSERT INTO customer_account_payments (transaction_id, company_id, user_id, cash_session_id, method, amount_cents)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(transactionId, user.company_id, user.id, session?.id || null, body.method, amountCents);
      writeAudit(user, "collect", "customer-account", transactionId, `${body.method}; ${amountCents / 100}`);
      return sale.total_cents - paid - amountCents;
    });
    return sendJson(response, 201, { ok: true, balance: result / 100 });
  }

  if (pathname === "/api/cash-register" && request.method === "GET") {
    requireRoles(user, "admin", "manager", "cashier");
    const session = db.prepare(`
      SELECT cash_register_sessions.*, users.username AS opened_by_username
      FROM cash_register_sessions JOIN users ON users.id = cash_register_sessions.opened_by
      WHERE cash_register_sessions.company_id = ? AND cash_register_sessions.branch_id = ?
        AND cash_register_sessions.closed_at IS NULL
      ORDER BY cash_register_sessions.id DESC LIMIT 1
    `).get(user.company_id, user.branch_id);
    const history = db.prepare(`
      SELECT sessions.*, opened.username AS opened_by_username, closed.username AS closed_by_username
      FROM cash_register_sessions sessions
      JOIN users opened ON opened.id = sessions.opened_by
      LEFT JOIN users closed ON closed.id = sessions.closed_by
      WHERE sessions.company_id = ? AND sessions.branch_id = ? AND sessions.closed_at IS NOT NULL
      ORDER BY sessions.id DESC LIMIT 20
    `).all(user.company_id, user.branch_id).map((entry) => {
      const summary = cashSessionSummary(entry.id);
      return {
        id: entry.id,
        openedBy: entry.opened_by_username,
        closedBy: entry.closed_by_username || "—",
        openedAt: entry.opened_at,
        closedAt: entry.closed_at,
        openingAmount: entry.opening_amount_cents / 100,
        expectedCash: entry.opening_amount_cents / 100 + summary.expectedCash,
        closingAmount: (entry.closing_amount_cents || 0) / 100,
        difference: entry.closing_difference_cents / 100,
        openingNote: entry.opening_note,
        closingNote: entry.closing_note
      };
    });
    if (!session) return sendJson(response, 200, { session: null, byMethod: {}, movements: [], history });
    const summary = cashSessionSummary(session.id);
    return sendJson(response, 200, {
      session: {
        id: session.id,
        openedBy: session.opened_by_username,
        openingAmount: session.opening_amount_cents / 100,
        openingNote: session.opening_note,
        openedAt: session.opened_at,
        cashSales: summary.cashSales,
        expectedCash: session.opening_amount_cents / 100 + summary.expectedCash
      },
      byMethod: summary.byMethod,
      movements: summary.movements,
      history
    });
  }

  if (pathname === "/api/cash-register/open" && request.method === "POST") {
    requireRoles(user, "admin", "manager", "cashier");
    const body = await requestBody(request);
    const openingAmount = decimalUnits(body.openingAmount, 2, "el monto inicial de caja");
    const note = optionalText(body.note, 200);
    const sessionId = beginTransaction(() => {
      if (db.prepare("SELECT id FROM cash_register_sessions WHERE company_id = ? AND branch_id = ? AND closed_at IS NULL")
        .get(user.company_id, user.branch_id)) {
        throw Object.assign(new Error("Ya hay una caja abierta."), { status: 409 });
      }
      return Number(db.prepare(`
        INSERT INTO cash_register_sessions (company_id, branch_id, opened_by, opening_amount_cents, opening_note)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.company_id, user.branch_id, user.id, openingAmount, note).lastInsertRowid);
    });
    writeAudit(user, "open", "cash-register", sessionId, String(openingAmount / 100));
    return sendJson(response, 201, { ok: true, sessionId });
  }

  if (pathname === "/api/cash-register/close" && request.method === "POST") {
    requireRoles(user, "admin", "manager", "cashier");
    const body = await requestBody(request);
    const closingAmount = decimalUnits(body.closingAmount, 2, "el monto contado al cierre");
    const closingNote = optionalText(body.note, 200);
    const session = db.prepare(
      "SELECT id, opening_amount_cents FROM cash_register_sessions WHERE company_id = ? AND branch_id = ? AND closed_at IS NULL"
    ).get(user.company_id, user.branch_id);
    if (!session) throw Object.assign(new Error("No hay una caja abierta para cerrar."), { status: 409 });
    const expectedCashCents = Math.round((session.opening_amount_cents / 100 + cashSessionSummary(session.id).expectedCash) * 100);
    const differenceCents = closingAmount - expectedCashCents;
    const result = db.prepare(`
      UPDATE cash_register_sessions
      SET closed_by = ?, closing_amount_cents = ?, closing_note = ?, closing_difference_cents = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND company_id = ? AND closed_at IS NULL
    `).run(user.id, closingAmount, closingNote, differenceCents, session.id, user.company_id);
    if (Number(result.changes) !== 1) throw Object.assign(new Error("La caja ya fue cerrada."), { status: 409 });
    writeAudit(user, "close", "cash-register", session.id, String(closingAmount / 100));
    return sendJson(response, 200, { ok: true });
  }

  if (pathname === "/api/cash-register/movements" && request.method === "POST") {
    requireRoles(user, "admin", "manager", "cashier");
    const body = await requestBody(request);
    if (!["in", "out"].includes(body.kind) || !new Set(["cash", "debit", "credit", "transfer", "other"]).has(body.method)) {
      throw Object.assign(new Error("El tipo o el medio del movimiento no es válido."), { status: 400 });
    }
    const amount = decimalUnits(body.amount, 2, "el importe", { allowZero: false });
    const description = requiredText(body.description, "la descripción", 120);
    const session = db.prepare("SELECT id FROM cash_register_sessions WHERE company_id = ? AND branch_id = ? AND closed_at IS NULL")
      .get(user.company_id, user.branch_id);
    if (!session) throw Object.assign(new Error("Abrí la caja antes de registrar movimientos."), { status: 409 });
    const movementId = Number(db.prepare(`
      INSERT INTO cash_register_movements (session_id, company_id, user_id, kind, method, amount_cents, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, user.company_id, user.id, body.kind, body.method, amount, description).lastInsertRowid);
    writeAudit(user, body.kind, "cash-movement", movementId, `${description}; ${amount / 100}`);
    return sendJson(response, 201, { ok: true, movementId });
  }

  if (process.env.NODE_ENV !== "test" &&
      (pathname.startsWith("/api/admin/users") || pathname === "/api/admin/audit")) {
    return sendJson(response, 403, { error: "La gestión de usuarios se realiza desde el panel de administración global." });
  }

  if (request.method === "GET" && pathname === "/api/admin/backup") {
    requireAdmin(user);
    writeAudit(user, "export", "backup", "", "Copia de seguridad descargada");
    const backup = databaseBackup();
    response.writeHead(200, {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="gestion-${new Date().toISOString().slice(0, 10)}.sqlite"`,
      "Content-Length": backup.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    return response.end(backup);
  }

  if (request.method === "POST" && pathname === "/api/admin/backup") {
    requireAdmin(user);
    const bytes = await requestBytes(request, 100 * 1024 * 1024);
    const automaticBackupPath = restoreDatabase(bytes, user);
    setSessionCookie(response, "", 0);
    return sendJson(response, 200, { ok: true, automaticBackup: path.basename(automaticBackupPath) });
  }

  if (request.method === "GET" && pathname === "/api/admin/users") {
    requireAdmin(user);
    const users = db.prepare(`
      SELECT id, email, username, access_role AS role, is_admin AS isAdmin, created_at AS createdAt
      FROM users WHERE company_id = ? ORDER BY id
    `).all(user.company_id).map((entry) => ({ ...entry, isAdmin: Boolean(entry.isAdmin) }));
    return sendJson(response, 200, { users });
  }

  if (request.method === "POST" && pathname === "/api/admin/users") {
    requireAdmin(user);
    const body = await requestBody(request);
    const email = requiredText(body.email, "un correo electrónico", 254).toLowerCase();
    const password = body.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error("Ingresá un correo electrónico válido."), { status: 400 });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      throw Object.assign(new Error("La contraseña debe tener entre 8 y 128 caracteres."), { status: 400 });
    }
    if (!["admin", "operator", "manager", "cashier", "seller"].includes(body.role)) {
      throw Object.assign(new Error("Elegí un perfil válido."), { status: 400 });
    }
    const assignedBranchId = body.branchId === undefined ? user.home_branch_id : Number(body.branchId);
    if (!Number.isSafeInteger(assignedBranchId) ||
        !db.prepare("SELECT 1 FROM branches WHERE id = ? AND company_id = ? AND active = 1")
          .get(assignedBranchId, user.company_id)) {
      throw Object.assign(new Error("Elegí una sucursal activa de esta empresa."), { status: 400 });
    }
    const username = requiredUsername(body.username || email.split("@")[0]);
    const accessRole = body.role === "operator" ? "manager" : body.role;
    try {
      const userId = Number(db.prepare(`
        INSERT INTO users (company_id, email, username, password_hash, is_admin, access_role)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(user.company_id, email, username, passwordHash(password), body.role === "admin" ? 1 : 0, accessRole).lastInsertRowid);
      assignUserBranch(userId, assignedBranchId);
      writeAudit(user, "create", "user", userId, `${email} (${body.role})`);
      return sendJson(response, 201, { user: { id: userId, email, isAdmin: body.role === "admin" } });
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 2067) {
        return sendJson(response, 409, { error: "Ya existe una cuenta con ese correo." });
      }
      throw error;
    }
  }

  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (adminUserMatch && request.method === "PUT") {
    requireAdmin(user);
    const body = await requestBody(request);
    if (!["admin", "operator", "manager", "cashier", "seller"].includes(body.role)) {
      throw Object.assign(new Error("Elegí un perfil válido."), { status: 400 });
    }
    const targetId = Number(adminUserMatch[1]);
    const target = db.prepare("SELECT id, email, is_admin FROM users WHERE id = ? AND company_id = ?")
      .get(targetId, user.company_id);
    if (!target) return sendJson(response, 404, { error: "No se encontró esa cuenta." });
    if (targetId === user.id) {
      return sendJson(response, 409, { error: "No podés cambiar el perfil de la cuenta con la que iniciaste sesión." });
    }
    const accessRole = body.role === "operator" ? "manager" : body.role;
    if (target.is_admin && body.role !== "admin" &&
        db.prepare("SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND is_admin = 1").get(user.company_id).count <= 1) {
      return sendJson(response, 409, { error: "La empresa debe conservar al menos un administrador." });
    }
    db.prepare("UPDATE users SET is_admin = ?, access_role = ? WHERE id = ? AND company_id = ?")
      .run(body.role === "admin" ? 1 : 0, accessRole, targetId, user.company_id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
    writeAudit(user, "update", "user", targetId, `${target.email} (${body.role})`);
    return sendJson(response, 200, { ok: true });
  }

  if (adminUserMatch && request.method === "DELETE") {
    requireAdmin(user);
    const targetId = Number(adminUserMatch[1]);
    const target = db.prepare("SELECT id, email, is_admin FROM users WHERE id = ? AND company_id = ?")
      .get(targetId, user.company_id);
    if (!target) return sendJson(response, 404, { error: "No se encontró esa cuenta." });
    if (targetId === user.id) {
      return sendJson(response, 409, { error: "No podés eliminar la cuenta con la que iniciaste sesión." });
    }
    if (target.is_admin &&
        db.prepare("SELECT COUNT(*) AS count FROM users WHERE company_id = ? AND is_admin = 1").get(user.company_id).count <= 1) {
      return sendJson(response, 409, { error: "La empresa debe conservar al menos un administrador." });
    }
    writeAudit(user, "delete", "user", targetId, target.email);
    db.prepare("DELETE FROM users WHERE id = ? AND company_id = ?").run(targetId, user.company_id);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/admin/audit") {
    requireAdmin(user);
    const entries = db.prepare(`
      SELECT id, user_email AS userEmail, action, entity, entity_id AS entityId,
        details, created_at AS createdAt
      FROM audit_log WHERE company_id = ? ORDER BY id DESC LIMIT 200
    `).all(user.company_id);
    return sendJson(response, 200, { entries });
  }

  if (request.method === "GET" && pathname === "/api/stock.csv") {
    requireRoles(user, "admin", "manager");
    const products = db.prepare(`
      SELECT sku, barcode, name, category, cost_cents, price_cents,
        branch_stock.stock_milli - branch_stock.stock_debt_milli AS stock_milli,
        branch_stock.minimum_stock_milli
      FROM products JOIN branch_stock ON branch_stock.product_id = products.id AND branch_stock.branch_id = ?
      WHERE products.company_id = ? AND products.active = 1 ORDER BY products.name
    `).all(user.branch_id, user.company_id);
    const rows = [["sku", "barcode", "name", "category", "cost", "price", "stock", "minimumStock"]];
    for (const product of products) {
      rows.push([
        product.sku, product.barcode, product.name, product.category,
        (product.cost_cents / 100).toFixed(2), (product.price_cents / 100).toFixed(2),
        (product.stock_milli / 1000).toFixed(3), (product.minimum_stock_milli / 1000).toFixed(3)
      ]);
    }
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stock.csv"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    return response.end(`\uFEFF${rows.map((row, index) => row.map((cell, column) =>
      csvCell(cell, index > 0 && column < 4)
    ).join(",")).join("\r\n")}\r\n`);
  }

  if (request.method === "POST" && pathname === "/api/stock/import") {
    requireRoles(user, "admin", "manager");
    const bytes = await requestBytes(request, 5 * 1024 * 1024);
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    const rows = contentType.includes("spreadsheetml.sheet")
      ? await parseXlsx(bytes)
      : parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    if (rows.length < 2 || rows.length > 5001) {
      throw Object.assign(new Error("El archivo debe incluir encabezados y hasta 5000 productos."), { status: 400 });
    }
    const aliases = new Map([
      ["sku", "sku"], ["codigo", "sku"], ["codigoproducto", "sku"], ["cod", "sku"],
      ["id", "id"], ["identificador", "id"],
      ["barcode", "barcode"], ["codigobarras", "barcode"], ["codbarras", "barcode"],
      ["name", "name"], ["producto", "name"], ["nombre", "name"], ["nombreproducto", "name"],
      ["category", "category"], ["categoria", "category"], ["rubro", "category"],
      ["brand", "brand"], ["marca", "brand"],
      ["cost", "cost"], ["costo", "cost"], ["preciocompra", "cost"], ["preccompra", "cost"],
      ["price", "price"], ["precio", "price"], ["precioventa", "price"], ["pvpublico", "price"],
      ["stock", "stock"], ["existencia", "stock"], ["cantidad", "stock"], ["stockactual", "stock"],
      ["minimumstock", "minimumStock"], ["stockminimo", "minimumStock"], ["minimo", "minimumStock"]
    ]);
    const header = rows[0].map((value) => {
      const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]/g, "");
      return aliases.get(normalized) || normalized;
    });
    const columns = new Map(header.map((name, index) => [name, index]));
    if (new Set(header).size !== header.length || !columns.has("stock") ||
        (!columns.has("sku") && !columns.has("id"))) {
      throw Object.assign(new Error("El archivo debe tener encabezados únicos e incluir un código (o ID) y la columna de stock."), { status: 400 });
    }
    const seenRows = new Set();
    let skippedDuplicates = 0;
    const dataRows = rows.slice(1).flatMap((values, index) => {
      if (values.length !== header.length) {
        throw Object.assign(new Error(`La fila ${index + 2} tiene una cantidad de columnas incorrecta.`), { status: 400 });
      }
      const signature = JSON.stringify(values.map((cell) => cell.trim()));
      if (seenRows.has(signature)) {
        skippedDuplicates += 1;
        return [];
      }
      seenRows.add(signature);
      return [{ values, row: index + 2 }];
    });
    const records = dataRows.map(({ values, row }) => {
      const value = (name) => {
        if (!columns.has(name)) return "";
        let cell = values[columns.get(name)].trim();
        if (name === "barcode") cell = cell.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
        if (name === "name") cell = cell.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
        return ["sku", "barcode", "name", "category", "brand"].includes(name)
          ? cell.replace(/^'(?=[=+\-@])/, "")
          : cell;
      };
      const sku = value("sku") || value("id");
      const record = {
        row,
        sku: requiredText(sku, `el código de la fila ${row}`, 40),
        barcode: optionalText(value("barcode"), 80),
        stockMilli: signedDecimalUnits(value("stock"), 3, `El stock de la fila ${row}`),
        name: value("name"),
        category: value("category"),
        cost: value("cost") || "0",
        price: value("price"),
        minimumStock: value("minimumStock") || "0"
      };
      return record;
    });
    const seen = new Set();
    const seenBarcodes = new Set();
    for (const record of records) {
      const identity = record.sku.toLocaleLowerCase("es-AR");
      if (seen.has(identity)) throw Object.assign(new Error(`El SKU ${record.sku} está repetido en el archivo.`), { status: 400 });
      seen.add(identity);
      if (record.barcode && seenBarcodes.has(record.barcode)) {
        throw Object.assign(new Error(`El código de barras ${record.barcode} está repetido en el archivo.`), { status: 400 });
      }
      if (record.barcode) seenBarcodes.add(record.barcode);
    }
    let created = 0;
    try {
      beginTransaction(() => {
        for (const record of records) {
        const matches = db.prepare(`
          SELECT id, sku, active FROM products
          WHERE company_id = ? AND (sku = ? OR (? <> '' AND barcode = ?))
        `).all(user.company_id, record.sku, record.barcode, record.barcode);
        if (matches.length > 1) {
          throw Object.assign(new Error(`La fila ${record.row} identifica más de un producto.`), { status: 409 });
        }
        const existing = matches[0];
        if (existing && !existing.active) {
          throw Object.assign(new Error(`El producto ${record.sku} está archivado y no se puede importar stock.`), { status: 409 });
        }
        if (existing) {
          const stockMilli = Math.max(0, record.stockMilli);
          const stockDebtMilli = Math.max(0, -record.stockMilli);
          db.prepare(`
            UPDATE products SET barcode = CASE WHEN ? <> '' THEN ? ELSE barcode END
            WHERE id = ? AND company_id = ?
          `).run(record.barcode, record.barcode, existing.id, user.company_id);
          initializeBranchStock(user.branch_id, existing.id);
          db.prepare(`
            UPDATE branch_stock SET stock_milli = ?, stock_debt_milli = ?
            WHERE branch_id = ? AND product_id = ?
          `).run(stockMilli, stockDebtMilli, user.branch_id, existing.id);
        } else {
          if (!record.name || !record.price) {
            throw Object.assign(new Error(`El producto nuevo de la fila ${record.row} necesita nombre y precio.`), { status: 400 });
          }
          const name = requiredText(record.name, `el nombre de la fila ${record.row}`);
          const category = optionalText(record.category, 80);
          const costCents = decimalUnits(record.cost, 2, `El costo de la fila ${record.row}`);
          const priceCents = wholePriceCents(record.price, `El precio de la fila ${record.row}`);
          const discountedCostCents = costCents;
          const priceWithVat = priceWithVatCents(costCents, 0);
          const profitBasisPoints = profitBasisPointsForPrice(priceCents, priceWithVat);
          const minimumStockMilli = decimalUnits(record.minimumStock, 3, `El stock mínimo de la fila ${record.row}`);
          const stockMilli = Math.max(0, record.stockMilli);
          const stockDebtMilli = Math.max(0, -record.stockMilli);
          const productId = Number(db.prepare(`
            INSERT INTO products (
              company_id, sku, barcode, name, category, cost_cents, price_cents,
              price2_cents, price3_cents,
              profit_basis_points, discounted_cost_cents, price_with_vat_cents,
              stock_milli, stock_debt_milli, minimum_stock_milli
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            user.company_id, record.sku, record.barcode, name, category, costCents, priceCents,
            priceCents, priceCents,
            profitBasisPoints, discountedCostCents, priceWithVat, stockMilli, stockDebtMilli, minimumStockMilli
          ).lastInsertRowid);
          initializeProductBranchStocks(user.company_id, productId, user.branch_id,
            stockMilli, stockDebtMilli, minimumStockMilli);
          created += 1;
        }
        }
        writeAudit(user, "import", "stock", "", `${records.length} filas; ${created} productos nuevos`);
      });
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 2067) {
        return sendJson(response, 409, { error: "El SKU o código de barras de una fila ya pertenece a otro producto." });
      }
      throw error;
    }
    return sendJson(response, 200, {
      imported: records.length,
      created,
      ...(skippedDuplicates ? { skippedDuplicates } : {})
    });
  }

  if (request.method === "GET" && pathname === "/api/receipt-settings") {
    requireAdmin(user);
    return sendJson(response, 200, { settings: receiptSettings(user.company_id) });
  }

  if (request.method === "PUT" && pathname === "/api/receipt-settings") {
    requireAdmin(user);
    const body = await requestBody(request, 200 * 1024);
    const settings = {
      business_name: requiredText(body.businessName, "la razón social", 120),
      legal_name: optionalText(body.legalName, 120),
      address: optionalText(body.address, 200),
      tax_id: optionalText(body.taxId, 32),
      gross_income: optionalText(body.grossIncome, 80),
      vat_condition: optionalText(body.vatCondition, 80),
      email: optionalText(body.email, 254),
      phone: optionalText(body.phone, 40),
      activity_start: optionalText(body.activityStart, 40),
      point_of_sale: optionalText(body.pointOfSale, 5) || "0001",
      receipt_title: requiredText(body.receiptTitle, "el título del comprobante", 40),
      receipt_format: body.receiptFormat === "ticket" ? "ticket" : "a4",
      logo_data_uri: optionalText(body.logoDataUri, 180 * 1024)
    };
    if (!/^\d{1,5}$/.test(settings.point_of_sale)) {
      throw Object.assign(new Error("El punto de venta debe contener entre 1 y 5 dígitos."), { status: 400 });
    }
    if (settings.logo_data_uri && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(settings.logo_data_uri)) {
      throw Object.assign(new Error("El logo debe ser una imagen PNG, JPG o WebP válida."), { status: 400 });
    }
    db.prepare(`
      INSERT INTO company_receipt_settings (
        company_id, business_name, legal_name, address, tax_id, gross_income, vat_condition, email, phone, activity_start,
        point_of_sale, receipt_title, receipt_format, logo_data_uri
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (company_id) DO UPDATE SET
        business_name = excluded.business_name, legal_name = excluded.legal_name, address = excluded.address, tax_id = excluded.tax_id,
        gross_income = excluded.gross_income,
        vat_condition = excluded.vat_condition, email = excluded.email, phone = excluded.phone,
        activity_start = excluded.activity_start, point_of_sale = excluded.point_of_sale,
        receipt_title = excluded.receipt_title, receipt_format = excluded.receipt_format,
        logo_data_uri = excluded.logo_data_uri
    `).run(
      user.company_id, settings.business_name, settings.legal_name || settings.business_name, settings.address, settings.tax_id, settings.gross_income, settings.vat_condition,
      settings.email, settings.phone, settings.activity_start, settings.point_of_sale,
      settings.receipt_title, settings.receipt_format, settings.logo_data_uri
    );
    writeAudit(user, "update", "receipt-settings", user.company_id, "Datos del comprobante actualizados");
    return sendJson(response, 200, { settings: receiptSettings(user.company_id) });
  }

  if (request.method === "GET" && pathname === "/api/recipes") {
    return sendJson(response, 200, { recipes: listRecipes(user.company_id) });
  }

  const recipeMatch = pathname.match(/^\/api\/recipes\/(\d+)$/);
  if (request.method === "DELETE" && recipeMatch) {
    requireRoles(user, "admin", "manager");
    const deleted = db.prepare("DELETE FROM recipes WHERE id = ? AND company_id = ?")
      .run(Number(recipeMatch[1]), user.company_id);
    if (Number(deleted.changes) !== 1) {
      return sendJson(response, 404, { error: "No se encontró esa receta." });
    }
    writeAudit(user, "delete", "recipe", recipeMatch[1], "Receta eliminada");
    return sendJson(response, 200, { ok: true });
  }

  if ((request.method === "POST" && pathname === "/api/recipes") || (request.method === "PUT" && recipeMatch)) {
    requireRoles(user, "admin", "manager");
    const body = await requestBody(request);
    const productData = request.method === "POST" && body.product && typeof body.product === "object"
      ? {
          sku: requiredText(body.product.sku, "el código del producto", 40),
          name: requiredText(body.product.name, "el nombre del producto"),
          category: optionalText(body.product.category, 80),
          costCents: decimalUnits(body.product.cost, 2, "El costo", { required: false }),
          priceCents: wholePriceCents(body.product.price, "El precio"),
          profitBasisPoints: profitBasisPointsForPrice(
           wholePriceCents(body.product.price, "El precio"),
           priceWithVatCents(decimalUnits(body.product.cost, 2, "El costo", { required: false }), 0)
          ),
          discountedCostCents: decimalUnits(body.product.cost, 2, "El costo", { required: false }),
          priceWithVatCents: priceWithVatCents(
           decimalUnits(body.product.cost, 2, "El costo", { required: false }), 0
          ),
          stockMilli: decimalUnits(body.product.stock ?? "0", 3, "El stock inicial", { required: false })
        }
      : null;
    if (!productData && (!Number.isSafeInteger(body.productId) || body.productId < 1)) {
      throw Object.assign(new Error("Elegí el producto que se preparará con esta receta."), { status: 400 });
    }
    if (productData && body.productId !== undefined) {
      throw Object.assign(new Error("Indicá un producto existente o los datos de un producto nuevo, no ambos."), { status: 400 });
    }
    const components = validateRecipeComponents(body);
    const recipeId = request.method === "PUT" ? Number(recipeMatch[1]) : null;
    const savedId = beginTransaction(() => {
      let targetProductId = body.productId;
      if (productData) {
        const duplicateSku = db.prepare("SELECT id FROM products WHERE company_id = ? AND sku = ?")
          .get(user.company_id, productData.sku);
        if (duplicateSku) throw Object.assign(new Error("Ya existe un producto con ese código."), { status: 409 });
        targetProductId = Number(db.prepare(`
          INSERT INTO products (
            company_id, sku, name, category, cost_cents, price_cents, profit_basis_points,
            price2_cents, price3_cents, discounted_cost_cents, price_with_vat_cents, stock_milli
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.company_id, productData.sku, productData.name, productData.category,
          productData.costCents, productData.priceCents, productData.profitBasisPoints,
          productData.priceCents, productData.priceCents,
          productData.discountedCostCents, productData.priceWithVatCents, productData.stockMilli
        ).lastInsertRowid);
        initializeProductBranchStocks(user.company_id, targetProductId, user.branch_id, productData.stockMilli);
      }
      const product = db.prepare(
        "SELECT id FROM products WHERE id = ? AND company_id = ? AND active = 1"
      ).get(targetProductId, user.company_id);
      if (!product) {
        throw Object.assign(new Error("El producto elaborado no existe o está archivado."), { status: 404 });
      }
      const ingredientIds = components.map((component) => component.productId);
      if (ingredientIds.includes(targetProductId)) {
        throw Object.assign(new Error("Un producto no puede ser ingrediente de su propia receta."), { status: 400 });
      }
      const placeholders = ingredientIds.map(() => "?").join(",");
      const activeIngredients = db.prepare(`
        SELECT id FROM products WHERE company_id = ? AND active = 1 AND id IN (${placeholders})
      `).all(user.company_id, ...ingredientIds);
      if (activeIngredients.length !== ingredientIds.length) {
        throw Object.assign(new Error("Todos los ingredientes deben ser productos activos de tu catálogo."), { status: 400 });
      }
      const nestedRecipe = db.prepare(`
        SELECT product_id FROM recipes WHERE company_id = ? AND product_id IN (${placeholders})
      `).get(user.company_id, ...ingredientIds);
      if (nestedRecipe) {
        throw Object.assign(new Error("Un ingrediente no puede ser otro producto elaborado; elegí productos del catálogo."), { status: 400 });
      }
      const usedAsIngredient = db.prepare(`
        SELECT 1 FROM recipes
        JOIN recipe_components ON recipe_components.recipe_id = recipes.id
        WHERE recipes.company_id = ? AND recipe_components.product_id = ?
          AND recipes.id != COALESCE(?, -1)
      `).get(user.company_id, targetProductId, recipeId);
      if (usedAsIngredient) {
        throw Object.assign(new Error("No se puede convertir en receta un producto que ya se usa como ingrediente."), { status: 400 });
      }
      if (recipeId) {
        const existing = db.prepare("SELECT id FROM recipes WHERE id = ? AND company_id = ?")
          .get(recipeId, user.company_id);
        if (!existing) throw Object.assign(new Error("No se encontró esa receta."), { status: 404 });
        const duplicate = db.prepare(
          "SELECT id FROM recipes WHERE company_id = ? AND product_id = ? AND id != ?"
        ).get(user.company_id, targetProductId, recipeId);
        if (duplicate) throw Object.assign(new Error("Ese producto ya tiene una receta."), { status: 409 });
        db.prepare("UPDATE recipes SET product_id = ? WHERE id = ?").run(targetProductId, recipeId);
        db.prepare("DELETE FROM recipe_components WHERE recipe_id = ?").run(recipeId);
      } else {
        const existing = db.prepare("SELECT id FROM recipes WHERE company_id = ? AND product_id = ?")
          .get(user.company_id, targetProductId);
        if (existing) throw Object.assign(new Error("Ese producto ya tiene una receta."), { status: 409 });
      }
      const id = recipeId || Number(db.prepare(
        "INSERT INTO recipes (company_id, product_id) VALUES (?, ?)"
      ).run(user.company_id, targetProductId).lastInsertRowid);
      const addComponent = db.prepare(
        "INSERT INTO recipe_components (recipe_id, product_id, quantity_milli) VALUES (?, ?, ?)"
      );
      for (const component of components) {
        addComponent.run(id, component.productId, component.quantityMilli);
      }
      return id;
    });
    writeAudit(user, request.method === "POST" ? "create" : "update", "recipe", savedId);
    return sendJson(response, request.method === "POST" ? 201 : 200, {
      recipe: listRecipes(user.company_id).find((recipe) => recipe.id === savedId),
      productCreated: Boolean(productData)
    });
  }

  if (request.method === "GET" && pathname === "/api/sales/daily") {
    const date = url.searchParams.get("date") || "";
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw Object.assign(new Error("La fecha debe tener el formato YYYY-MM-DD."), { status: 400 });
    }
    const transactions = db.prepare(`
      SELECT transactions.*, users.display_name AS created_by FROM transactions
      JOIN users ON users.id = transactions.user_id
      WHERE transactions.company_id = ? AND transactions.branch_id = ? AND transactions.kind = 'sale'
        AND date(transactions.created_at, '-3 hours') = ?
      ORDER BY transactions.created_at DESC, transactions.id DESC
    `).all(user.company_id, user.branch_id, date).map((transaction) => {
      const result = serializeTransaction(transaction);
      result.items = transactionItems(transaction.id);
      result.payments = paymentDetails(transaction.id);
      return result;
    });
    const totalCents = transactions.reduce((sum, sale) => sum + Math.round(sale.total * 100), 0);
    const paymentTotals = db.prepare(`
      SELECT transaction_payments.method, SUM(transaction_payments.amount_cents) AS total_cents
      FROM transaction_payments JOIN transactions ON transactions.id = transaction_payments.transaction_id
      WHERE transactions.company_id = ? AND transactions.branch_id = ? AND transactions.kind = 'sale'
        AND date(transactions.created_at, '-3 hours') = ?
      GROUP BY transaction_payments.method ORDER BY transaction_payments.method
    `).all(user.company_id, user.branch_id, date).map((payment) => ({
      method: payment.method,
      amount: payment.total_cents / 100
    }));
    const salesByUser = db.prepare(`
      SELECT salesperson_user_id AS userId, salesperson_name AS displayName,
        COUNT(*) AS count, COALESCE(SUM(total_cents), 0) / 100.0 AS total
      FROM transactions
      WHERE company_id = ? AND branch_id = ? AND kind = 'sale' AND date(created_at, '-3 hours') = ?
      GROUP BY salesperson_user_id, salesperson_name
      ORDER BY total DESC, displayName COLLATE NOCASE
    `).all(user.company_id, user.branch_id, date);
    return sendJson(response, 200, {
      date,
      count: transactions.length,
      total: totalCents / 100,
      paymentTotals,
      salesByUser,
      transactions
    });
  }

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const productCount = db.prepare("SELECT COUNT(*) AS count FROM products WHERE company_id = ? AND active = 1").get(user.company_id).count;
    const lowStockCount = db.prepare(`
      SELECT COUNT(*) AS count FROM products
      JOIN branch_stock ON branch_stock.product_id = products.id AND branch_stock.branch_id = ?
      WHERE products.company_id = ? AND products.active = 1
        AND branch_stock.stock_milli - branch_stock.stock_debt_milli <= branch_stock.minimum_stock_milli
    `).get(user.branch_id, user.company_id).count;
    const totals = db.prepare(`
      SELECT kind, COALESCE(SUM(total_cents), 0) AS total
      FROM transactions WHERE company_id = ? AND branch_id = ?
        AND created_at >= date('now', 'start of month')
      GROUP BY kind
    `).all(user.company_id, user.branch_id);
    const monthTotals = { sale: 0, purchase: 0 };
    for (const total of totals) monthTotals[total.kind] = total.total / 100;
    const salesByUser = db.prepare(`
      SELECT salesperson_user_id AS userId, salesperson_name AS displayName,
        COUNT(*) AS count, COALESCE(SUM(total_cents), 0) / 100.0 AS total
      FROM transactions
      WHERE company_id = ? AND branch_id = ? AND kind = 'sale'
        AND created_at >= date('now', 'start of month')
      GROUP BY salesperson_user_id, salesperson_name
      ORDER BY total DESC, displayName COLLATE NOCASE
    `).all(user.company_id, user.branch_id);
    const activity = db.prepare(`
      SELECT transactions.*, users.display_name AS created_by FROM transactions
      JOIN users ON users.id = transactions.user_id
      WHERE transactions.company_id = ? AND transactions.branch_id = ?
      ORDER BY transactions.created_at DESC, transactions.id DESC LIMIT 8
    `).all(user.company_id, user.branch_id).map(serializeTransaction);
    const lowStock = db.prepare(`
      SELECT products.*, branch_stock.stock_milli, branch_stock.stock_debt_milli,
        branch_stock.minimum_stock_milli
      FROM products JOIN branch_stock ON branch_stock.product_id = products.id
      WHERE products.company_id = ? AND branch_stock.branch_id = ? AND products.active = 1
        AND branch_stock.stock_milli - branch_stock.stock_debt_milli <= branch_stock.minimum_stock_milli
      ORDER BY branch_stock.stock_milli - branch_stock.stock_debt_milli, products.name LIMIT 6
    `).all(user.company_id, user.branch_id).map(serializeProduct);
    return sendJson(response, 200, {
      company: user.company_name,
      stats: {
        products: productCount, lowStock: lowStockCount,
        sales: monthTotals.sale, purchases: monthTotals.purchase, salesByUser
      },
      activity,
      lowStockProducts: lowStock
    });
  }

  if (request.method === "GET" && pathname === "/api/products") {
    const products = db.prepare(
      "SELECT * FROM products WHERE company_id = ? AND active = 1 ORDER BY name"
    ).all(user.company_id);
    return sendJson(response, 200, {
      products: products.map((product) => serializeProduct(productAtBranch(product, user.branch_id)))
    });
  }

  if (request.method === "POST" && pathname === "/api/products") {
    requireRoles(user, "admin", "manager");
    const body = await requestBody(request);
    const sku = requiredText(body.sku, "el código del producto", 40);
    const barcode = optionalText(body.barcode, 80);
    const name = requiredText(body.name, "el nombre del producto");
    const category = typeof body.category === "string" ? body.category.trim().slice(0, 80) : "";
    const brand = optionalText(body.brand, 80);
    const costCents = decimalUnits(body.cost, 2, "El costo", { required: false });
    const bonusBasisPoints = percentageBasisPoints(body.bonusPercent, "La bonificación");
    const guildDiscountBasisPoints = percentageBasisPoints(body.guildDiscountPercent, "El descuento gremial");
    const discountedCostCents = body.discountedCost === undefined
      ? Math.round(costCents * (10000 - bonusBasisPoints) / 10000)
      : decimalUnits(body.discountedCost, 2, "El precio bonificado");
    const priceWithVat = body.priceWithVat === undefined
      ? Math.round(discountedCostCents * 121 / 100)
      : decimalUnits(body.priceWithVat, 2, "El precio con IVA");
    const profitWasProvided = body.profitPercent !== undefined && body.profitPercent !== null && body.profitPercent !== "";
    const profitPoints = profitBasisPoints(body.profitPercent);
    const priceCents = body.price === undefined || body.price === null || body.price === ""
      ? publicPriceFromBaseCents(priceWithVat, profitPoints)
      : wholePriceCents(body.price, "El precio");
    const price2Cents = body.price2 === undefined || body.price2 === null || body.price2 === ""
      ? priceCents
      : wholePriceCents(body.price2, "El Precio 2");
    const price3Cents = body.price3 === undefined || body.price3 === null || body.price3 === ""
      ? priceCents
      : wholePriceCents(body.price3, "El Precio 3");
    const savedProfitPoints = profitWasProvided
      ? profitPoints
      : profitBasisPointsForPrice(priceCents, priceWithVat);
    const stockMilli = decimalUnits(body.stock, 3, "El stock inicial", { required: false });
    const minimumStockMilli = decimalUnits(body.minimumStock, 3, "El stock mínimo", { required: false });
    let productId;
    try {
      productId = Number(db.prepare(`
        INSERT INTO products (
          company_id, sku, barcode, name, category, brand, cost_cents, bonus_basis_points,
          guild_discount_basis_points, profit_basis_points, discounted_cost_cents,
          price_with_vat_cents, price_cents, price2_cents, price3_cents, stock_milli, minimum_stock_milli
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.company_id, sku, barcode, name, category, brand, costCents, bonusBasisPoints,
        guildDiscountBasisPoints, savedProfitPoints, discountedCostCents, priceWithVat,
        priceCents, price2Cents, price3Cents, stockMilli, minimumStockMilli
      ).lastInsertRowid);
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 2067) {
        return sendJson(response, 409, { error: "Ya existe un producto con ese código." });
      }
      throw error;
    }
    initializeProductBranchStocks(user.company_id, productId, user.branch_id, stockMilli, 0, minimumStockMilli);
    writeAudit(user, "create", "product", productId, `${sku}; ${name}`);
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    return sendJson(response, 201, { product: serializeProduct(productAtBranch(product, user.branch_id)) });
  }

  const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (request.method === "PUT" && productMatch) {
    requireRoles(user, "admin", "manager");
    const body = await requestBody(request);
    const sku = requiredText(body.sku, "el código del producto", 40);
    const barcode = optionalText(body.barcode, 80);
    const name = requiredText(body.name, "el nombre del producto");
    const category = typeof body.category === "string" ? body.category.trim().slice(0, 80) : "";
    const brand = optionalText(body.brand, 80);
    const costCents = decimalUnits(body.cost, 2, "El costo");
    const bonusBasisPoints = percentageBasisPoints(body.bonusPercent, "La bonificación");
    const guildDiscountBasisPoints = percentageBasisPoints(body.guildDiscountPercent, "El descuento gremial");
    const discountedCostCents = body.discountedCost === undefined
      ? Math.round(costCents * (10000 - bonusBasisPoints) / 10000)
      : decimalUnits(body.discountedCost, 2, "El precio bonificado");
    const priceWithVat = body.priceWithVat === undefined
      ? Math.round(discountedCostCents * 121 / 100)
      : decimalUnits(body.priceWithVat, 2, "El precio con IVA");
    const profitWasProvided = body.profitPercent !== undefined && body.profitPercent !== null && body.profitPercent !== "";
    const profitPoints = profitBasisPoints(body.profitPercent);
    const priceCents = body.price === undefined || body.price === null || body.price === ""
      ? publicPriceFromBaseCents(priceWithVat, profitPoints)
      : wholePriceCents(body.price, "El precio");
    const price2Cents = body.price2 === undefined || body.price2 === null || body.price2 === ""
      ? priceCents
      : wholePriceCents(body.price2, "El Precio 2");
    const price3Cents = body.price3 === undefined || body.price3 === null || body.price3 === ""
      ? priceCents
      : wholePriceCents(body.price3, "El Precio 3");
    const savedProfitPoints = profitWasProvided
      ? profitPoints
      : profitBasisPointsForPrice(priceCents, priceWithVat);
    const stock = signedDecimalUnits(body.stock, 3, "El stock");
    const minimumStockMilli = decimalUnits(body.minimumStock, 3, "El stock mínimo");
    const stockMilli = Math.max(0, stock);
    const stockDebtMilli = Math.max(0, -stock);
    try {
      const result = db.prepare(`
        UPDATE products
        SET sku = ?, barcode = ?, name = ?, category = ?, brand = ?, cost_cents = ?,
          bonus_basis_points = ?, guild_discount_basis_points = ?, profit_basis_points = ?,
          discounted_cost_cents = ?,           price_with_vat_cents = ?, price_cents = ?, price2_cents = ?, price3_cents = ?
        WHERE id = ? AND company_id = ? AND active = 1
      `).run(
        sku, barcode, name, category, brand, costCents, bonusBasisPoints, guildDiscountBasisPoints,
        savedProfitPoints, discountedCostCents, priceWithVat, priceCents, price2Cents, price3Cents,
        Number(productMatch[1]), user.company_id
      );
      if (Number(result.changes) !== 1) {
        return sendJson(response, 404, { error: "El producto no existe o ya fue archivado." });
      }
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && error.errcode === 2067) {
        return sendJson(response, 409, { error: "Ya existe un producto con ese código." });
      }
      throw error;
    }
    initializeBranchStock(user.branch_id, Number(productMatch[1]));
    db.prepare(`
      UPDATE branch_stock SET stock_milli = ?, stock_debt_milli = ?, minimum_stock_milli = ?
      WHERE branch_id = ? AND product_id = ?
    `).run(stockMilli, stockDebtMilli, minimumStockMilli, user.branch_id, Number(productMatch[1]));
    const product = db.prepare("SELECT * FROM products WHERE id = ? AND company_id = ?").get(Number(productMatch[1]), user.company_id);
    const branchProduct = productAtBranch(product, user.branch_id);
    writeAudit(user, "update", "product", product.id, `${product.sku}; ${product.name}; stock ${serializeProduct(branchProduct).stock}`);
    return sendJson(response, 200, { product: serializeProduct(branchProduct) });
  }

  const archiveMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (request.method === "DELETE" && archiveMatch) {
    requireRoles(user, "admin", "manager");
    const result = db.prepare(
      "UPDATE products SET active = 0 WHERE id = ? AND company_id = ? AND active = 1"
    ).run(Number(archiveMatch[1]), user.company_id);
    if (Number(result.changes) !== 1) {
      return sendJson(response, 404, { error: "El producto no existe o ya fue archivado." });
    }
    writeAudit(user, "archive", "product", archiveMatch[1], "Producto archivado");
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/transactions") {
    const kind = url.searchParams.get("kind");
    if (kind === "purchase") requireRoles(user, "admin", "manager");
    const query = kind === "sale" || kind === "purchase"
      ? "SELECT transactions.*, users.display_name AS created_by FROM transactions JOIN users ON users.id = transactions.user_id WHERE transactions.company_id = ? AND transactions.branch_id = ? AND transactions.kind = ? ORDER BY transactions.created_at DESC, transactions.id DESC LIMIT 100"
      : "SELECT transactions.*, users.display_name AS created_by FROM transactions JOIN users ON users.id = transactions.user_id WHERE transactions.company_id = ? AND transactions.branch_id = ? ORDER BY transactions.created_at DESC, transactions.id DESC LIMIT 100";
    const parameters = kind === "sale" || kind === "purchase"
      ? [user.company_id, user.branch_id, kind]
      : [user.company_id, user.branch_id];
    const transactions = db.prepare(query).all(...parameters).map((transaction) => {
      const result = serializeTransaction(transaction);
      result.items = transactionItems(transaction.id);
      result.payments = paymentDetails(transaction.id);
      result.document = purchaseDocumentMetadata(transaction.id);
      return result;
    });
    return sendJson(response, 200, { transactions });
  }

  if (request.method === "POST" && pathname === "/api/sales") {
    requireRoles(user, "admin", "manager", "cashier");
    const body = await requestBody(request);
    return sendJson(response, 201, { transaction: createTransaction(user, body, "sale") });
  }

  if (request.method === "POST" && pathname === "/api/purchases") {
    requireRoles(user, "admin", "manager");
    const body = await requestBody(request, 7_500_000);
    return sendJson(response, 201, { transaction: createTransaction(user, body, "purchase") });
  }

  if (request.method === "GET" && pathname === "/api/sales-orders") {
    requireRoles(user, "admin", "manager", "cashier", "seller");
    const orders = db.prepare(`
      SELECT sales_orders.*, users.display_name AS created_by
      FROM sales_orders JOIN users ON users.id = sales_orders.user_id
      WHERE sales_orders.company_id = ? AND sales_orders.branch_id = ?
      ORDER BY sales_orders.created_at DESC, sales_orders.id DESC LIMIT 200
    `).all(user.company_id, user.branch_id).map(serializeSalesOrder);
    return sendJson(response, 200, { orders });
  }

  if (request.method === "POST" && pathname === "/api/sales-orders") {
    requireRoles(user, "admin", "manager", "cashier", "seller");
    const body = await requestBody(request);
    const customerId = body.customerId === undefined || body.customerId === null || body.customerId === ""
      ? null : Number(body.customerId);
    if (customerId !== null && (!Number.isSafeInteger(customerId) || customerId < 1)) {
      throw Object.assign(new Error("El cliente seleccionado no es válido."), { status: 400 });
    }
    const customer = customerId === null ? null : db.prepare(
      "SELECT * FROM customers WHERE id = ? AND company_id = ? AND active = 1"
    ).get(customerId, user.company_id);
    if (customerId !== null && !customer) throw Object.assign(new Error("El cliente no existe o está archivado."), { status: 404 });
    const contact = customer?.name || requiredText(body.contact, "el cliente", 120);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
      throw Object.assign(new Error("Agregá entre 1 y 100 productos al pedido."), { status: 400 });
    }
    const generalDiscount = decimalUnits(body.generalDiscountPercent ?? "0", 2, "El descuento general");
    if (generalDiscount > 10000) throw Object.assign(new Error("El descuento general no puede superar el 100 %."), { status: 400 });
    const items = body.items.map((item) => {
      const productId = item?.productId;
      if (!Number.isSafeInteger(productId) || productId < 1) {
        throw Object.assign(new Error("Uno de los productos seleccionados no es válido."), { status: 400 });
      }
      const product = db.prepare(
        "SELECT id, name, sku, price_cents, price2_cents, price3_cents FROM products WHERE id = ? AND company_id = ? AND active = 1"
      ).get(productId, user.company_id);
      if (!product) throw Object.assign(new Error("Un producto no existe o no está disponible."), { status: 404 });
      const tier = Number(item.priceTier ?? 1);
      if (!Number.isInteger(tier) || tier < 1 || tier > 3) throw Object.assign(new Error("Elegí un nivel de precio válido."), { status: 400 });
      const quantity = decimalUnits(item.quantity, 0, "La cantidad", { allowZero: false }) * 1000;
      const unitPrice = item.unitPrice === undefined
        ? product[["price_cents", "price2_cents", "price3_cents"][tier - 1]]
        : decimalUnits(item.unitPrice, 2, "El precio");
      const enteredDiscount = decimalUnits(item.discountPercent ?? "0", 2, "El descuento");
      if (enteredDiscount > 10000) throw Object.assign(new Error("El descuento por artículo no puede superar el 100 %."), { status: 400 });
      const discount = Math.min(10000, enteredDiscount + (customer?.discount_basis_points || 0));
      const gross = Math.round(quantity * unitPrice / 1000);
      const subtotal = gross - Math.round(gross * discount / 10000);
      return { productId, product, tier, quantity, unitPrice, discount, subtotal };
    });
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const total = subtotal - Math.round(subtotal * generalDiscount / 10000);
    const orderId = beginTransaction(() => {
      const sequence = db.prepare(`
        INSERT INTO sales_order_sequences (company_id, last_number) VALUES (?, 1)
        ON CONFLICT (company_id) DO UPDATE SET last_number = last_number + 1
        RETURNING last_number
      `).get(user.company_id).last_number;
      const number = `O-${String(sequence).padStart(6, "0")}`;
      const id = Number(db.prepare(`
        INSERT INTO sales_orders (
          company_id, branch_id, user_id, customer_id, number, contact, contact_tax_id,
          contact_vat_condition, contact_address, contact_phone, contact_email,
          general_discount_basis_points, total_cents, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.company_id, user.branch_id, user.id, customer?.id || null, number, contact,
        customer?.tax_id || optionalText(body.contactTaxId, 32),
        customer?.vat_condition || optionalText(body.contactVatCondition, 80) || "Consumidor final",
        customer?.address || optionalText(body.contactAddress, 200),
        customer?.phone || optionalText(body.contactPhone, 40),
        customer?.email || optionalText(body.contactEmail, 254),
        generalDiscount, total, user.display_name || user.username
      ).lastInsertRowid);
      const insertItem = db.prepare(`
        INSERT INTO sales_order_items (
          order_id, product_id, product_name, sku, quantity_milli, unit_price_cents,
          discount_basis_points, price_tier, subtotal_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        insertItem.run(id, item.productId, item.product.name, item.product.sku, item.quantity,
          item.unitPrice, item.discount, item.tier, item.subtotal);
      }
      writeAudit(user, "create", "sales-order", id, `${number}; ${contact}; ${total / 100}`);
      return id;
    });
    const order = db.prepare(`
      SELECT sales_orders.*, users.display_name AS created_by FROM sales_orders
      JOIN users ON users.id = sales_orders.user_id
      WHERE sales_orders.id = ? AND sales_orders.branch_id = ?
    `).get(orderId, user.branch_id);
    return sendJson(response, 201, { order: serializeSalesOrder(order) });
  }

  const salesOrderConvertMatch = pathname.match(/^\/api\/sales-orders\/(\d+)\/convert$/);
  if (request.method === "POST" && salesOrderConvertMatch) {
    requireRoles(user, "admin", "manager", "cashier");
    const body = await requestBody(request);
    const converted = beginTransaction(() => {
      const order = db.prepare(`
        SELECT * FROM sales_orders WHERE id = ? AND company_id = ? AND branch_id = ? AND status = 'open'
      `).get(Number(salesOrderConvertMatch[1]), user.company_id, user.branch_id);
      if (!order) throw Object.assign(new Error("No se encontró un pedido pendiente para facturar."), { status: 409 });
      const storedItems = salesOrderItems(order.id);
      let items = storedItems;
      if (body.items !== undefined) {
        if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > storedItems.length) {
          throw Object.assign(new Error("El pedido debe conservar al menos un producto y no puede agregar artículos."), { status: 400 });
        }
        const storedByProduct = new Map();
        for (const item of storedItems) {
          const productItems = storedByProduct.get(item.productId) || [];
          productItems.push(item);
          storedByProduct.set(item.productId, productItems);
        }
        items = body.items.map((submitted) => {
          const productId = Number(submitted?.productId);
          const productItems = storedByProduct.get(productId);
          if (!productItems?.length) {
            throw Object.assign(new Error("Solo podés quitar productos del pedido; no se pueden agregar otros al facturar."), { status: 400 });
          }
          return productItems.shift();
        });
      }
      const transaction = createTransaction(user, {
        saleMode: body.saleMode || "paid",
        customerId: order.customer_id,
        contact: order.contact,
        contactTaxId: order.contact_tax_id,
        contactVatCondition: order.contact_vat_condition,
        contactAddress: order.contact_address,
        contactPhone: order.contact_phone,
        contactEmail: order.contact_email,
        generalDiscountPercent: order.general_discount_basis_points / 100,
        items,
        payments: body.payments
      }, "sale", {
        withinTransaction: true,
        skipCustomerDiscount: true,
        salespersonUserId: order.user_id,
        salespersonName: order.created_by_name || user.display_name || user.username
      });
      db.prepare("DELETE FROM sales_order_items WHERE order_id = ?").run(order.id);
      db.prepare(`
        INSERT INTO sales_order_items (
          order_id, product_id, product_name, sku, quantity_milli, unit_price_cents,
          discount_basis_points, price_tier, subtotal_cents
        )
        SELECT ?, product_id, product_name, sku, quantity_milli, unit_price_cents,
          discount_basis_points, price_tier, subtotal_cents
        FROM transaction_items WHERE transaction_id = ? ORDER BY id
      `).run(order.id, transaction.id);
      db.prepare(`
        UPDATE sales_orders SET status = 'converted', transaction_id = ?, total_cents = ?
        WHERE id = ? AND company_id = ? AND branch_id = ? AND status = 'open'
      `).run(transaction.id, Math.round(transaction.total * 100), order.id, user.company_id, user.branch_id);
      writeAudit(user, "convert", "sales-order", order.id, `${order.number}; venta ${transaction.number}`);
      return { transaction, orderId: order.id };
    });
    return sendJson(response, 201, converted);
  }

  const salesOrderMatch = pathname.match(/^\/api\/sales-orders\/(\d+)$/);
  if (request.method === "DELETE" && salesOrderMatch) {
    requireRoles(user, "admin", "manager", "cashier", "seller");
    const result = db.prepare(`
      UPDATE sales_orders SET status = 'cancelled'
      WHERE id = ? AND company_id = ? AND branch_id = ? AND status = 'open'
    `).run(Number(salesOrderMatch[1]), user.company_id, user.branch_id);
    if (Number(result.changes) !== 1) throw Object.assign(new Error("No se encontró un pedido abierto para cancelar."), { status: 409 });
    writeAudit(user, "cancel", "sales-order", salesOrderMatch[1], "Pedido cancelado");
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/quotes") {
    const quotes = db.prepare(`
      SELECT quotes.*, users.display_name AS created_by FROM quotes
      JOIN users ON users.id = quotes.user_id
      WHERE quotes.company_id = ? AND quotes.branch_id = ?
      ORDER BY quotes.created_at DESC, quotes.id DESC LIMIT 200
    `).all(user.company_id, user.branch_id).map(serializeQuote);
    return sendJson(response, 200, { quotes });
  }

  if (request.method === "POST" && pathname === "/api/quotes") {
    requireRoles(user, "admin", "manager", "cashier", "seller");
    const body = await requestBody(request);
    const contact = requiredText(body.contact, "el cliente", 120);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
      throw Object.assign(new Error("Agregá entre 1 y 100 artículos al presupuesto."), { status: 400 });
    }
    const validUntil = body.validUntil;
    if (typeof validUntil !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil) ||
        Number.isNaN(Date.parse(`${validUntil}T00:00:00Z`)) ||
        new Date(`${validUntil}T00:00:00Z`).toISOString().slice(0, 10) !== validUntil) {
      throw Object.assign(new Error("Indicá una fecha de validez correcta."), { status: 400 });
    }
    const discountBasisPoints = decimalUnits(body.generalDiscountPercent ?? "0", 2, "El descuento general");
    if (discountBasisPoints > 10000) {
      throw Object.assign(new Error("El descuento general no puede superar el 100 %."), { status: 400 });
    }
    const quoteId = beginTransaction(() => {
      const items = body.items.map((item) => {
        const isCustom = item?.custom === true;
        const name = isCustom ? requiredText(item.name, "la descripción del artículo", 120) : "";
        const productId = isCustom ? null : item?.productId;
        const quantityMilli = decimalUnits(item?.quantity, 3, "La cantidad", { allowZero: false });
        const tier = Number(item?.priceTier ?? 1);
        if (!isCustom && (!Number.isSafeInteger(productId) || productId < 1)) {
          throw Object.assign(new Error("Uno de los productos seleccionados no es válido."), { status: 400 });
        }
        if (!Number.isInteger(tier) || tier < 1 || tier > 3) {
          throw Object.assign(new Error("Elegí un nivel de precio válido."), { status: 400 });
        }
        const discount = decimalUnits(item?.discountPercent ?? "0", 2, "El descuento");
        if (discount > 10000) {
          throw Object.assign(new Error("El descuento por artículo no puede superar el 100 %."), { status: 400 });
        }
        const product = isCustom ? null : db.prepare(
          "SELECT id, name, sku, price_cents, price2_cents, price3_cents FROM products WHERE id = ? AND company_id = ? AND active = 1"
        ).get(productId, user.company_id);
        if (!isCustom && !product) {
          throw Object.assign(new Error("Un producto no existe o no está disponible."), { status: 404 });
        }
        const unitPriceCents = isCustom || item.unitPrice !== undefined
          ? decimalUnits(item.unitPrice, 2, "El precio")
          : product[["price_cents", "price2_cents", "price3_cents"][tier - 1]];
        const itemName = isCustom ? name : product.name;
        const sku = isCustom ? "" : product.sku;
        const grossCents = Math.round(quantityMilli * unitPriceCents / 1000);
        const subtotalCents = grossCents - Math.round(grossCents * discount / 10000);
        if (!Number.isSafeInteger(subtotalCents)) {
          throw Object.assign(new Error("El importe del presupuesto excede el límite permitido."), { status: 400 });
        }
        return { productId, itemName, sku, quantityMilli, unitPriceCents, discount, tier, subtotalCents };
      });
      const subtotalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
      const totalCents = subtotalCents - Math.round(subtotalCents * discountBasisPoints / 10000);
      if (!Number.isSafeInteger(totalCents)) {
        throw Object.assign(new Error("El total del presupuesto excede el límite permitido."), { status: 400 });
      }
      const sequence = db.prepare(`
        INSERT INTO quote_sequences (company_id, last_number) VALUES (?, 1)
        ON CONFLICT (company_id) DO UPDATE SET last_number = last_number + 1
        RETURNING last_number
      `).get(user.company_id).last_number;
      const number = `P-${String(sequence).padStart(6, "0")}`;
      const id = Number(db.prepare(`
        INSERT INTO quotes (
          company_id, branch_id, user_id, number, contact, contact_tax_id, contact_vat_condition,
          contact_address, contact_phone, contact_email, general_discount_basis_points,
          total_cents, valid_until, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.company_id, user.branch_id, user.id, number, contact, optionalText(body.contactTaxId, 32),
        optionalText(body.contactVatCondition, 80) || "Consumidor final",
        optionalText(body.contactAddress, 200), optionalText(body.contactPhone, 40),
        optionalText(body.contactEmail, 254), discountBasisPoints, totalCents, validUntil,
        user.display_name || user.username
      ).lastInsertRowid);
      const addItem = db.prepare(`
        INSERT INTO quote_items (
          quote_id, product_id, product_name, sku, quantity_milli, unit_price_cents,
          discount_basis_points, price_tier, subtotal_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        addItem.run(id, item.productId, item.itemName, item.sku, item.quantityMilli,
          item.unitPriceCents, item.discount, item.tier, item.subtotalCents);
      }
      writeAudit(user, "create", "quote", id, `${number}; ${contact}; ${totalCents / 100}`);
      return id;
    });
    return sendJson(response, 201, {
      quote: serializeQuote(db.prepare("SELECT * FROM quotes WHERE id = ? AND company_id = ? AND branch_id = ?")
        .get(quoteId, user.company_id, user.branch_id))
    });
  }

  const quoteConvertMatch = pathname.match(/^\/api\/quotes\/(\d+)\/convert$/);
  if (request.method === "POST" && quoteConvertMatch) {
    requireRoles(user, "admin", "manager", "cashier");
    const body = await requestBody(request);
    const converted = beginTransaction(() => {
      const quote = db.prepare("SELECT * FROM quotes WHERE id = ? AND company_id = ? AND branch_id = ?")
        .get(Number(quoteConvertMatch[1]), user.company_id, user.branch_id);
      if (!quote) throw Object.assign(new Error("No se encontró ese presupuesto."), { status: 404 });
      if (quote.status !== "open") {
        throw Object.assign(new Error("Este presupuesto ya no está disponible para convertir."), { status: 409 });
      }
      const items = db.prepare("SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id").all(quote.id);
      const saleBody = {
        saleMode: body.saleMode || "paid",
        contact: quote.contact,
        contactTaxId: quote.contact_tax_id,
        contactVatCondition: quote.contact_vat_condition,
        contactAddress: quote.contact_address,
        contactPhone: quote.contact_phone,
        contactEmail: quote.contact_email,
        generalDiscountPercent: String(quote.general_discount_basis_points / 100),
        payments: body.payments,
        items: items.map((item) => item.product_id === null
          ? {
              custom: true, name: item.product_name, unitPrice: String(item.unit_price_cents / 100),
              quantity: String(item.quantity_milli / 1000), discountPercent: String(item.discount_basis_points / 100)
            }
          : {
              productId: item.product_id, quantity: String(item.quantity_milli / 1000),
              priceTier: item.price_tier, discountPercent: String(item.discount_basis_points / 100),
              unitPrice: String(item.unit_price_cents / 100),
              storedUnitPriceCents: item.unit_price_cents
            })
      };
      const transaction = createTransaction(user, saleBody, "sale", {
        useStoredPrices: true,
        withinTransaction: true
      });
      db.prepare("UPDATE quotes SET status = 'converted', sale_transaction_id = ? WHERE id = ? AND branch_id = ?")
        .run(transaction.id, quote.id, user.branch_id);
      writeAudit(user, "convert", "quote", quote.id, `${quote.number}; venta ${transaction.number}`);
      return { transaction, quote: serializeQuote(db.prepare("SELECT * FROM quotes WHERE id = ?").get(quote.id)) };
    });
    return sendJson(response, 201, converted);
  }

  const quoteCancelMatch = pathname.match(/^\/api\/quotes\/(\d+)$/);
  if (request.method === "DELETE" && quoteCancelMatch) {
    const result = db.prepare(`
      UPDATE quotes SET status = 'cancelled'
      WHERE id = ? AND company_id = ? AND branch_id = ? AND status = 'open'
    `).run(Number(quoteCancelMatch[1]), user.company_id, user.branch_id);
    if (Number(result.changes) !== 1) {
      return sendJson(response, 409, { error: "No se encontró un presupuesto abierto para cancelar." });
    }
    writeAudit(user, "cancel", "quote", quoteCancelMatch[1], "Presupuesto cancelado");
    return sendJson(response, 200, { ok: true });
  }

  const transactionMatch = pathname.match(/^\/api\/transactions\/(\d+)$/);
  if (request.method === "DELETE" && transactionMatch) {
    requireRoles(user, "admin", "manager");
    const transactionId = Number(transactionMatch[1]);
    const result = beginTransaction(() => {
      const sale = db.prepare(
        "SELECT id, number, branch_id FROM transactions WHERE id = ? AND company_id = ? AND branch_id = ? AND kind = 'sale'"
      ).get(transactionId, user.company_id, user.branch_id);
      if (!sale) {
        throw Object.assign(new Error("No se encontró esa venta."), { status: 404 });
      }
      writeAudit(user, "delete", "sale", sale.id, sale.number);
      let stockEffects = db.prepare(
        "SELECT product_id AS productId, quantity_milli AS quantityMilli FROM transaction_stock_effects WHERE transaction_id = ?"
      ).all(transactionId);
      if (!stockEffects.length) {
        stockEffects = db.prepare(
          "SELECT product_id AS productId, quantity_milli AS quantityMilli FROM transaction_items WHERE transaction_id = ? AND product_id IS NOT NULL"
        ).all(transactionId);
      }
      for (const item of stockEffects) {
        applyStockMovement(user.company_id, sale.branch_id, item.productId, item.quantityMilli, "purchase");
      }
      db.prepare(`
        UPDATE quotes SET status = 'open', sale_transaction_id = NULL
        WHERE company_id = ? AND branch_id = ? AND sale_transaction_id = ?
      `).run(user.company_id, sale.branch_id, transactionId);
      db.prepare(`
        UPDATE sales_orders SET status = 'open', transaction_id = NULL
        WHERE company_id = ? AND branch_id = ? AND transaction_id = ?
      `).run(user.company_id, sale.branch_id, transactionId);
      const numberMatch = sale.number.match(/^V-(\d+)$/);
      if (numberMatch) {
        db.prepare(`
          INSERT OR IGNORE INTO transaction_reusable_numbers (company_id, kind, receipt_number)
          VALUES (?, 'sale', ?)
        `).run(user.company_id, Number(numberMatch[1]));
      }
      db.prepare("DELETE FROM transaction_items WHERE transaction_id = ?").run(transactionId);
      db.prepare("DELETE FROM transactions WHERE id = ? AND company_id = ? AND branch_id = ?")
        .run(transactionId, user.company_id, sale.branch_id);
      return { ok: true };
    });
    return sendJson(response, 200, result);
  }

  return sendJson(response, 404, { error: "No se encontró esa operación." });
}

function handleReceipt(request, response, url) {
  if (request.method !== "GET") {
    return sendJson(response, 405, { error: "Método no permitido." });
  }
  const requestedBranchId = url.searchParams.get("branchId");
  if (requestedBranchId !== null) request.headers["x-branch-id"] = requestedBranchId;
  const quoteMatch = url.pathname.match(/^\/quotes\/(\d+)$/);
  const match = url.pathname.match(/^\/receipts\/(\d+)$/);
  if (!match && !quoteMatch) return sendJson(response, 404, { error: "No se encontró ese documento." });
  const user = sessionUser(request);
  if (!user) return sendJson(response, 401, { error: "Iniciá sesión para continuar." });
  if (user.subscription_expired) {
    return sendJson(response, 402, {
      error: "La suscripción venció. Aboná el servicio y contactá al administrador para recuperar el acceso.",
      subscriptionExpired: true,
      subscriptionUntil: user.subscription_until
    });
  }
  if (quoteMatch) {
    const quote = db.prepare("SELECT * FROM quotes WHERE id = ? AND company_id = ? AND branch_id = ?")
      .get(Number(quoteMatch[1]), user.company_id, user.branch_id);
    if (!quote) return sendJson(response, 404, { error: "No se encontró ese presupuesto." });
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(quotePrintHtml(quote, receiptSettings(user.company_id)));
    return;
  }
  const transaction = db.prepare(`
    SELECT * FROM transactions
    WHERE id = ? AND company_id = ? AND branch_id = ? AND kind = 'sale'
  `).get(Number(match[1]), user.company_id, user.branch_id);
  if (!transaction) return sendJson(response, 404, { error: "No se encontró ese comprobante." });
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(receiptHtml(transaction, receiptSettings(user.company_id)));
}

const handleRequest = async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(self)");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://firestore.googleapis.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const tenantUser = sessionUser(request);
      const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
      const operationId = String(request.headers["x-offline-operation-id"] || "");
      if (tenantUser && isMutation && url.pathname !== "/api/online-verification" &&
          /^[a-f0-9]{32}$/.test(operationId)) {
        const previous = db.prepare(`
          SELECT status_code, response_json FROM api_idempotency
          WHERE user_id = ? AND operation_id = ?
        `).get(tenantUser.id, operationId);
        if (previous) {
          return sendJson(response, previous.status_code, JSON.parse(previous.response_json));
        }
        response.tenantIdempotency = { userId: tenantUser.id, operationId };
      }
      if (tenantUser && isMutation && url.pathname !== "/api/online-verification") {
        response.tenantCompanyId = tenantUser.company_id;
      }
      await handleApi(request, response, url);
      if (tenantUser && isMutation && url.pathname !== "/api/online-verification" &&
          response.statusCode >= 200 && response.statusCode < 300 &&
          !response.tenantSyncQueued) {
        enqueueFirebaseSync(tenantUser.company_id);
      }
      delete response.tenantIdempotency;
      delete response.tenantCompanyId;
      return;
    }
    if (url.pathname === "/tls-cert.cer" && request.method === "GET") {
      if (!existsSync(httpsCertificatePath)) {
        return sendJson(response, 404, { error: "No hay un certificado HTTPS configurado." });
      }
      response.writeHead(200, {
        "Content-Type": "application/pkix-cert",
        "Content-Disposition": 'attachment; filename="tonotos-lan.cer"',
        "Cache-Control": "no-store"
      });
      response.end(readFileSync(httpsCertificatePath));
      return;
    }
    if (url.pathname.startsWith("/receipts/") || url.pathname.startsWith("/quotes/")) {
      return handleReceipt(request, response, url);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Método no permitido." });
    }
    const relativePath = url.pathname === "/"
      ? "index.html"
      : url.pathname === "/platform"
        ? "platform.html"
        : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = path.resolve(publicDirectory, relativePath);
    if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
      return sendJson(response, 400, { error: "Ruta no válida." });
    }
    try {
      if (!statSync(filePath).isFile()) throw new Error("No es un archivo.");
      const contentTypes = {
        ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png"
      };
      response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(request.method === "HEAD" ? undefined : readFileSync(filePath));
    } catch (error) {
      if (error.code !== "ENOENT" && error.message !== "No es un archivo.") throw error;
      sendJson(response, 404, { error: "No se encontró esa página." });
    }
  } catch (error) {
    if (error.status) return sendJson(response, error.status, { error: error.message });
    console.error("Error al procesar la solicitud:", error);
    if (!response.headersSent) sendJson(response, 500, { error: "Ocurrió un error inesperado. Revisá el registro del servidor." });
  }
};

const host = process.env.HOST || "0.0.0.0";
const server = createServer(handleRequest);
let secureServer = null;
if (existsSync(httpsPfxPath) && process.env.HTTPS_PFX_PASSPHRASE) {
  secureServer = createHttpsServer({
    pfx: readFileSync(httpsPfxPath),
    passphrase: process.env.HTTPS_PFX_PASSPHRASE
  }, handleRequest);
}

server.listen(port, host, () => {
  console.log(`Tonotos Gestión disponible localmente en http://127.0.0.1:${port}`);
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  if (addresses.length > 0) {
    console.log(`Acceso para App Móvil en red local (Wi-Fi):`);
    addresses.forEach((ip) => console.log(`  http://${ip}:${port}`));
  }
  if (secureServer) {
    secureServer.listen(httpsPort, host, () => {
      let fingerprint = "";
      if (existsSync(httpsCertificatePath)) {
        fingerprint = new X509Certificate(readFileSync(httpsCertificatePath))
          .fingerprint256.replace(/:/g, "");
      }
      const httpsHost = String(process.env.HTTPS_HOST || addresses[0] || "127.0.0.1").trim();
      console.log(`Acceso HTTPS seguro para modo offline: https://${httpsHost}:${httpsPort}`);
      if (fingerprint) console.log(`Huella SHA-256 del certificado HTTPS: ${fingerprint}`);
    });
  } else {
    console.warn("HTTPS LAN is not configured. Run Configurar HTTPS LAN.bat to enable trusted offline access from other PCs.");
  }
  if (firestore) {
    for (const company of db.prepare("SELECT id FROM companies").all()) {
      enqueueFirebaseSync(company.id);
    }
  }
});

function close() {
  const closeDatabase = () => {
    db.close();
    process.exit(0);
  };
  if (secureServer?.listening) {
    secureServer.close(() => {
      if (server.listening) server.close(closeDatabase);
      else closeDatabase();
    });
  } else if (server.listening) {
    server.close(closeDatabase);
  } else {
    closeDatabase();
  }
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
