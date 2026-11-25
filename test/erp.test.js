const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { scryptSync } = require("node:crypto");
const { mkdtemp, readdir, rm } = require("node:fs/promises");
const { DatabaseSync } = require("node:sqlite");
const ExcelJS = require("exceljs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { industryTemplates } = require("../scripts/industry-product-catalog");
const normalizeProductSearch = require("../public/product-search");

test("la búsqueda de productos ignora tildes y puntuación", () => {
  assert.equal(normalizeProductSearch("cafe"), normalizeProductSearch("Café"));
  assert.equal(normalizeProductSearch("cable usb-c"), normalizeProductSearch("Cable USB C"));
  assert.equal(normalizeProductSearch("impresión, digital"), normalizeProductSearch("impresion digital"));
});

test("online verification records client connectivity without a server-side Firestore write", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gestion-online-verification-"));
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PLATFORM_ADMIN_EMAIL: "",
      PORT: String(port),
      DB_PATH: path.join(directory, "online-verification.db"),
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:1",
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  async function request(url, { method = "GET", body, cookie, headers = {} } = {}) {
    return fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`El servidor se cerró durante el inicio: ${childOutput}`);
      try {
        response = await request("/api/setup", {
          method: "POST",
          body: { company: "Empresa verificación", email: "verification@example.com", password: "Clave segura 123" }
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(response.status, 201, childOutput);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const headers = { "X-Tonotos-Device-Id": "b".repeat(32) };
    response = await request("/api/online-verification", { cookie, headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).configured, true);

    response = await request("/api/online-verification", { method: "POST", cookie, headers });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    response = await request("/api/online-verification", { cookie, headers });
    const verification = await response.json();
    assert.equal(response.status, 200);
    assert.equal(verification.due, false);
    assert.ok(verification.verifiedAt);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("separates stock and sales by branch and restricts user access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gestion-branches-"));
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PLATFORM_ADMIN_EMAIL: "",
      PORT: String(port),
      DB_PATH: path.join(directory, "branches.db"),
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  async function request(url, { method = "GET", body, cookie, headers = {} } = {}) {
    return fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  let cookie;
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`El servidor se cerró durante el inicio: ${childOutput}`);
      try {
        response = await request("/api/setup", {
          method: "POST",
          body: { company: "Empresa con sucursales", email: "branch-admin@example.com", password: "Clave segura 123" }
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(response.status, 201, childOutput);
    cookie = response.headers.get("set-cookie").split(";")[0];
    const mainBranch = (await (await request("/api/session", { cookie })).json()).user.branchId;
    const productResponse = await request("/api/products", {
      method: "POST",
      cookie,
      body: { sku: "BR-001", name: "Producto por sucursal", price: "100", stock: "8" }
    });
    assert.equal(productResponse.status, 201);
    const product = (await productResponse.json()).product;

    response = await request("/api/branches", {
      method: "POST", cookie, body: { name: "Sucursal Norte" }
    });
    assert.equal(response.status, 201);
    const branchId = (await response.json()).branch.id;
    response = await request("/api/branches/transfers", {
      method: "POST",
      cookie,
      body: {
        fromBranchId: mainBranch,
        toBranchId: branchId,
        items: [{ productId: product.id, quantity: "3" }]
      }
    });
    assert.equal(response.status, 201, JSON.stringify(await response.json()));

    const branchHeaders = { "X-Branch-Id": String(branchId) };
    response = await request("/api/branches/transfers", {
      method: "POST",
      cookie,
      body: {
        fromBranchId: mainBranch,
        toBranchId: branchId,
        items: [{ productId: product.id, quantity: "6" }]
      }
    });
    assert.equal(response.status, 409);
    const branchProducts = (await (await request("/api/products", { cookie, headers: branchHeaders })).json()).products;
    assert.equal(branchProducts.find((item) => item.id === product.id).stock, 3);
    response = await request("/api/sales", {
      method: "POST",
      cookie,
      headers: branchHeaders,
      body: {
        items: [{ productId: product.id, quantity: "1" }],
        payments: [{ method: "cash", amount: "100" }]
      }
    });
    assert.equal(response.status, 201, JSON.stringify(await response.json()));
    const branchSales = (await (await request("/api/transactions?kind=sale", {
      cookie, headers: branchHeaders
    })).json()).transactions;
    const mainSales = (await (await request("/api/transactions?kind=sale", {
      cookie, headers: { "X-Branch-Id": String(mainBranch) }
    })).json()).transactions;
    assert.equal(branchSales.length, 1);
    assert.equal(mainSales.length, 0);
    const mainProducts = (await (await request("/api/products", {
      cookie, headers: { "X-Branch-Id": String(mainBranch) }
    })).json()).products;
    assert.equal(mainProducts.find((item) => item.id === product.id).stock, 5);
    assert.equal((await (await request("/api/products", { cookie, headers: branchHeaders })).json())
      .products.find((item) => item.id === product.id).stock, 2);

    response = await request("/api/admin/users", {
      method: "POST",
      cookie,
      body: {
        email: "branch-cashier@example.com",
        username: "branch-cashier",
        password: "Clave segura 456",
        role: "cashier",
        branchId
      }
    });
    assert.equal(response.status, 201, JSON.stringify(await response.json()));
    response = await request("/api/login", {
      method: "POST",
      body: { username: "branch-cashier", password: "Clave segura 456" }
    });
    assert.equal(response.status, 200);
    const cashierCookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal((await request("/api/products", {
      cookie: cashierCookie,
      headers: { "X-Branch-Id": String(mainBranch) }
    })).status, 403);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("cada catálogo de rubro precarga al menos 200 productos únicos", () => {
  for (const [industry, template] of Object.entries(industryTemplates)) {
    assert.ok(template.products.length >= 200, `${industry} tiene menos de 200 productos`);
    assert.equal(new Set(template.products).size, template.products.length, `${industry} tiene nombres duplicados`);
  }
});

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("el ciclo de configuración, autenticación, stock y movimientos funciona", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gestion-cloud-"));
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(directory, "test.db"), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  async function request(url, { method = "GET", body, rawBody, contentType, cookie, headers = {} } = {}) {
    return fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(rawBody ? { "Content-Type": contentType || "text/plain" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      ...(body ? { body: JSON.stringify(body) } : rawBody ? { body: rawBody } : {})
    });
  }

  async function json(response) {
    return response.json();
  }

  let cookie;
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`El servidor se cerró durante el inicio: ${childOutput}`);
      try {
        response = await request("/api/session");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(response, `El servidor no inició a tiempo: ${childOutput}`);
    assert.equal((await json(response)).needsSetup, true);
    response = await request("/");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(response.headers.get("content-security-policy"), /connect-src 'self' https:\/\/firestore\.googleapis\.com/);
    assert.equal(response.headers.get("permissions-policy"), "camera=(self)");
    assert.match(await response.text(), /Ingresá/);
    response = await request("/logo-tonotos.png");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    response = await request("/zxing-browser.min.js");
    assert.equal(response.status, 200);

    response = await request("/api/setup", {
      method: "POST",
      body: { company: "Tienda de prueba", email: "admin@example.com", password: "Clave segura 123" }
    });
    assert.equal(response.status, 201);
    cookie = response.headers.get("set-cookie").split(";")[0];
    assert.deepEqual(await json(response), {
      user: { email: "admin@example.com", company: "Tienda de prueba", companyId: 1, isAdmin: true }
    });
    response = await request("/api/online-verification", {
      cookie,
      headers: { "X-Tonotos-Device-Id": "a".repeat(32) }
    });
    assert.equal(response.status, 200);
    const verificationStatus = await json(response);
    assert.equal(verificationStatus.configured, false);
    assert.equal(verificationStatus.due, true);
    assert.equal(verificationStatus.verifiedAt, null);
    response = await request("/api/online-verification", {
      method: "POST",
      cookie,
      headers: { "X-Tonotos-Device-Id": "a".repeat(32) }
    });
    assert.equal(response.status, 503);
    assert.equal((await json(await request("/api/cash-register", { cookie }))).session.openingAmount, 0);

    response = await request("/api/setup", {
      method: "POST",
      body: { company: "Segunda empresa", email: "otro@example.com", password: "Clave segura 123" }
    });
    assert.equal(response.status, 409);

    response = await request("/api/products", {
      method: "POST", cookie,
      body: { sku: "TOO-LARGE", name: "x".repeat(70_000), price: "1" }
    });
    assert.equal(response.status, 413);

    response = await request("/api/products", {
      method: "POST", cookie,
      body: { sku: "DEC-PRICE", name: "Precio decimal", price: "1.25" }
    });
    assert.equal(response.status, 400);

    response = await request("/api/products", {
      method: "POST", cookie,
      body: {
        sku: "CAF-01", name: "Café", category: "Almacén", brand: "Tostadero",
        cost: "500.25", bonusPercent: "5", guildDiscountPercent: "10",
        price: "901", stock: "5", minimumStock: "1"
      }
    });
    assert.equal(response.status, 201);
    const coffee = (await json(response)).product;
    assert.equal(coffee.stock, 5);
    assert.equal(coffee.price, 901);
    assert.equal(coffee.brand, "Tostadero");
    assert.equal(coffee.bonusPercent, 5);
    assert.equal(coffee.discountedCost, 475.24);
    assert.equal(coffee.priceWithVat, 575.04);
    assert.equal(coffee.profitPercent, 56.68);
    assert.equal(coffee.guildDiscountPercent, 10);

    response = await request(`/api/products/${coffee.id}`, {
      method: "PUT", cookie,
      body: {
        sku: coffee.sku, name: coffee.name, category: coffee.category, brand: "Café de origen",
        cost: "500.25", bonusPercent: "10", guildDiscountPercent: "12.5",
        price: "901", stock: "5", minimumStock: "1"
      }
    });
    assert.equal(response.status, 200);
    const repricedCoffee = (await json(response)).product;
    assert.equal(repricedCoffee.brand, "Café de origen");
    assert.equal(repricedCoffee.discountedCost, 450.23);
    assert.equal(repricedCoffee.priceWithVat, 544.78);
    assert.equal(repricedCoffee.guildDiscountPercent, 12.5);

    response = await request("/api/products", {
      method: "POST", cookie,
      body: { sku: "CAF-01", name: "Código repetido", price: "1" }
    });
    assert.equal(response.status, 409);

    response = await request("/api/products", {
      method: "POST", cookie,
      body: { sku: "YER-01", name: "Yerba", cost: "300", price: "650", stock: "2", minimumStock: "1" }
    });
    assert.equal(response.status, 201);
    const yerba = (await json(response)).product;

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: { contact: "Cliente", items: [{ productId: coffee.id, quantity: "1", discountPercent: "101" }] }
    });
    assert.equal(response.status, 400);
    let products = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(products.find((product) => product.id === coffee.id).stock, 5);

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: { items: [{ productId: coffee.id, quantity: "1" }, { productId: yerba.id, quantity: "9" }] }
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /medios de pago/);

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: {
        items: [{ productId: coffee.id, quantity: "1" }, { productId: yerba.id, quantity: "9" }],
        payments: [{ method: "cash", amount: "1000" }, { method: "transfer", amount: "5751.49" }]
      }
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /coincidir con el total/);

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: {
        items: [{ productId: coffee.id, quantity: "1" }, { productId: yerba.id, quantity: "9" }],
        payments: [{ method: "cash", amount: "1000" }, { method: "transfer", amount: "5751" }]
      }
    });
    assert.equal(response.status, 201);
    const sale = (await json(response)).transaction;
    assert.equal(sale.number, "V-000001");
    assert.equal(sale.contact, "Consumidor final");
    assert.equal(sale.total, 6751);
    assert.deepEqual(sale.payments, [
      { method: "cash", amount: 1000 },
      { method: "transfer", amount: 5751 }
    ]);
    response = await request(`/receipts/${sale.id}`, { cookie });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const receipt = await response.text();
    assert.match(receipt, /RECIBO/);
    assert.match(receipt, /NO VÁLIDO COMO FACTURA NI COMPROBANTE FISCAL/);
    assert.match(receipt, /Artículo|Café/);
    assert.match(receipt, /Transferencia/);
    assert.doesNotMatch(receipt, /logo-tonotos\.png/);
    assert.match(receipt, /print-receipt/);
    response = await request(`/receipts/${sale.id}`);
    assert.equal(response.status, 401);
    products = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(products.find((product) => product.id === coffee.id).stock, 4);
    assert.equal(products.find((product) => product.id === yerba.id).stock, -7);

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: {
        contact: "Cliente",
        items: [{ productId: coffee.id, quantity: "1.250", discountPercent: "10" }],
        payments: [{ method: "credit", amount: "1013.62" }]
      }
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cantidad/);

    response = await request("/api/sales", {
      method: "POST", cookie,
      headers: { "X-Offline-Operation-Id": "0123456789abcdef0123456789abcdef" },
      body: {
        contact: "Cliente",
        items: [{ productId: coffee.id, quantity: "1", discountPercent: "10" }],
        payments: [{ method: "credit", amount: "810.90" }]
      }
    });
    assert.equal(response.status, 201);
    const discountedSale = (await json(response)).transaction;
    assert.equal(discountedSale.number, "V-000002");
    assert.equal(discountedSale.total, 810.9);
    response = await request("/api/sales", {
      method: "POST", cookie,
      headers: { "X-Offline-Operation-Id": "0123456789abcdef0123456789abcdef" },
      body: {
        contact: "Cliente",
        items: [{ productId: coffee.id, quantity: "1", discountPercent: "10" }],
        payments: [{ method: "credit", amount: "810.90" }]
      }
    });
    assert.equal(response.status, 201);
    assert.equal((await json(response)).transaction.id, discountedSale.id);

    response = await request("/api/purchases", {
      method: "POST", cookie,
      body: {
        contact: "Proveedor",
        place: "Mercado local",
        document: {
          fileName: "factura-compra.pdf",
          mediaType: "application/pdf",
          dataBase64: Buffer.from("%PDF-1.4\nComprobante de prueba").toString("base64")
        },
        items: [
          { custom: true, name: "Café molido", sku: "CAF-01", quantity: "2", unitPrice: "500.25" },
          { custom: true, name: "Yerba mate", sku: "YER-01", quantity: "5", unitPrice: "300" },
          { custom: true, name: "Flete", quantity: "1", unitPrice: "45.50" }
        ]
      }
    });
    assert.equal(response.status, 201);
    const purchase = (await json(response)).transaction;
    assert.equal(purchase.total, 2546);
    assert.equal(purchase.place, "Mercado local");
    products = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(products.find((product) => product.id === coffee.id).stock, 5);
    assert.equal(products.find((product) => product.id === yerba.id).stock, -2);
    assert.equal(products.find((product) => product.id === coffee.id).cost, 500.25);
    response = await request("/api/purchases", {
      method: "POST", cookie,
      body: {
        contact: "Proveedor",
        items: [{ custom: true, name: "Producto sin SKU", sku: "NO-EXISTE", quantity: "1", unitPrice: "10" }]
      }
    });
    assert.equal(response.status, 404);
    response = await request(`/api/transactions/${purchase.id}/document`, { cookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(await response.text(), "%PDF-1.4\nComprobante de prueba");

    response = await request(`/api/products/${coffee.id}`, {
      method: "PUT", cookie,
      body: { sku: "CAF-01", name: "Café actualizado", category: "Bebidas", cost: "550", price: "950", stock: "3", minimumStock: "2" }
    });
    assert.equal(response.status, 200);
    const updatedCoffee = (await json(response)).product;
    assert.equal(updatedCoffee.name, "Café actualizado");
    assert.equal(updatedCoffee.price, 950);
    assert.equal(updatedCoffee.stock, 3);

    const salesBeforeDelete = await json(await request("/api/transactions?kind=sale", { cookie }));
    assert.equal(salesBeforeDelete.transactions.length, 2);
    assert.deepEqual(salesBeforeDelete.transactions[0].payments, [{ method: "credit", amount: 810.9 }]);
    assert.deepEqual(salesBeforeDelete.transactions[1].payments, [
      { method: "cash", amount: 1000 },
      { method: "transfer", amount: 5751 }
    ]);
    assert.equal(salesBeforeDelete.transactions[0].items[0].discountPercent, 10);
    assert.equal(salesBeforeDelete.transactions[0].items[0].discount, 90.1);
    assert.equal(salesBeforeDelete.transactions[0].items[0].subtotal, 810.9);

    response = await request(`/api/transactions/${salesBeforeDelete.transactions[1].id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 200);
    products = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(products.find((product) => product.id === coffee.id).stock, 4);
    assert.equal(products.find((product) => product.id === yerba.id).stock, 7);
    const salesAfterDelete = await json(await request("/api/transactions?kind=sale", { cookie }));
    assert.deepEqual(salesAfterDelete.transactions.map((transaction) => transaction.number), ["V-000002"]);
    response = await request(`/api/transactions/${salesBeforeDelete.transactions[1].id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 404);

    response = await request(`/api/transactions/${salesBeforeDelete.transactions[0].id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 200);
    products = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(products.find((product) => product.id === coffee.id).stock, 5);
    assert.equal(products.find((product) => product.id === yerba.id).stock, 7);

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: {
        items: [{ productId: yerba.id, quantity: "1" }],
        payments: [{ method: "debit", amount: "650" }]
      }
    });
    assert.equal(response.status, 201);
    const saleAfterDeletes = (await response.json()).transaction;
    assert.equal(saleAfterDeletes.number, "V-000001");
    assert.deepEqual(saleAfterDeletes.payments, [{ method: "debit", amount: 650 }]);
    response = await request(`/api/transactions/${saleAfterDeletes.id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 200);
    products = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(products.find((product) => product.id === yerba.id).stock, 7);

    const sequenceDb = new DatabaseSync(path.join(directory, "test.db"));
    sequenceDb.prepare("DELETE FROM transaction_reusable_numbers WHERE company_id = 1 AND kind = 'sale'").run();
    sequenceDb.prepare("UPDATE transaction_sequences SET last_number = 1 WHERE company_id = 1 AND kind = 'sale'").run();
    sequenceDb.prepare("INSERT INTO transaction_reusable_numbers (company_id, kind, receipt_number) VALUES (1, 'sale', 3)").run();
    sequenceDb.close();

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: {
        items: [{ productId: yerba.id, quantity: "1", unitPrice: "777.77" }],
        payments: [{ method: "cash", amount: "777.77" }]
      }
    });
    assert.equal(response.status, 201);
    const saleWithCustomPrice = (await response.json()).transaction;
    assert.equal(saleWithCustomPrice.number, "V-000002");
    assert.equal(saleWithCustomPrice.items[0].unitPrice, 777.77);
    assert.equal((await json(await request("/api/products", { cookie }))).products
      .find((product) => product.id === yerba.id).price, 650);
    response = await request(`/api/transactions/${saleWithCustomPrice.id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 200);

    const dashboard = await json(await request("/api/dashboard", { cookie }));
    assert.equal(dashboard.stats.products, 2);
    assert.equal(dashboard.stats.lowStock, 0);
    assert.equal(dashboard.stats.sales, 0);
    assert.equal(dashboard.stats.purchases, 2546);
    assert.equal(dashboard.activity.length, 1);

    const transactions = await json(await request("/api/transactions", { cookie }));
    assert.equal(transactions.transactions.length, 1);
    assert.equal(transactions.transactions[0].kind, "purchase");
    assert.equal(transactions.transactions[0].items[0].name, "Café molido");
    assert.equal(transactions.transactions[0].place, "Mercado local");
    assert.equal(transactions.transactions[0].document.fileName, "factura-compra.pdf");
    assert.equal(transactions.transactions[0].items[2].name, "Flete");
    response = await request(`/api/transactions/${transactions.transactions[0].id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 404);

    response = await request(`/api/products/${coffee.id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 200);
    products = (await json(await request("/api/products", { cookie }))).products;
    assert.deepEqual(products.map((product) => product.name), ["Yerba"]);
    const archivedHistory = await json(await request("/api/transactions", { cookie }));
    assert.equal(archivedHistory.transactions.length, 1);
    assert.equal(archivedHistory.transactions[0].items[0].name, "Café molido");

    response = await request("/api/products", {
      method: "POST", cookie,
      body: {
        sku: "GAIN-01", name: "Producto con margen", cost: "500", bonusPercent: "0",
        profitPercent: "50", stock: "10", price2: "800", price3: "700"
      }
    });
    assert.equal(response.status, 201);
    const marginProduct = (await json(response)).product;
    assert.equal(marginProduct.priceWithVat, 605);
    assert.equal(marginProduct.profitPercent, 50);
    assert.equal(marginProduct.price, 908);
    assert.equal(marginProduct.price2, 800);
    assert.equal(marginProduct.price3, 700);
    response = await request(`/api/products/${marginProduct.id}`, {
      method: "PUT", cookie,
      body: {
        sku: marginProduct.sku, name: marginProduct.name, cost: "500",
        bonusPercent: "0", discountedCost: "480", priceWithVat: "700",
        profitPercent: "40", price: "1100", price2: "800", price3: "700", stock: "10", minimumStock: "0"
      }
    });
    assert.equal(response.status, 200);
    const updatedMarginProduct = (await json(response)).product;
    assert.equal(updatedMarginProduct.profitPercent, 40);
    assert.equal(updatedMarginProduct.discountedCost, 480);
    assert.equal(updatedMarginProduct.priceWithVat, 700);
    assert.equal(updatedMarginProduct.price, 1100);
    assert.equal(updatedMarginProduct.price2, 800);
    assert.equal(updatedMarginProduct.price3, 700);
    response = await request("/api/sales", {
      method: "POST", cookie,
      body: {
        items: [
          { productId: marginProduct.id, quantity: "1", priceTier: 2 },
          { custom: true, name: "Servicio especial", unitPrice: "25", quantity: "2" }
        ],
        payments: [{ method: "cash", amount: "850" }]
      }
    });
    assert.equal(response.status, 201);
    const mixedSale = (await response.json()).transaction;
    assert.equal(mixedSale.total, 850);
    assert.equal(mixedSale.items[0].unitPrice, 800);
    assert.equal(mixedSale.items[1].name, "Servicio especial");
    assert.equal(mixedSale.items[1].sku, "");
    const receiptResponse = await request(`/receipts/${mixedSale.id}`, { cookie });
    assert.match(await receiptResponse.text(), /Servicio especial/);
    const storedMixedSale = (await json(await request("/api/transactions?kind=sale", { cookie })))
      .transactions.find((transaction) => transaction.id === mixedSale.id);
    assert.equal(storedMixedSale.items[1].name, "Servicio especial");
    response = await request(`/api/transactions/${mixedSale.id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 200);
    const afterCustomSaleDelete = (await json(await request("/api/products", { cookie }))).products
      .find((product) => product.id === marginProduct.id);
    assert.equal(afterCustomSaleDelete.stock, 10);

    await request("/api/logout", { method: "POST", cookie });
    response = await request("/api/products", { cookie });
    assert.equal(response.status, 401);

    response = await request("/api/login", {
      method: "POST",
      body: { email: "admin@example.com", password: "incorrecta" }
    });
    assert.equal(response.status, 401);

    response = await request("/api/login", {
      method: "POST",
      body: { email: "admin@example.com", password: "Clave segura 123" }
    });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("set-cookie").includes("HttpOnly"));
    cookie = response.headers.get("set-cookie").split(";")[0];

    response = await request("/api/admin/users", {
      method: "POST", cookie,
      body: { email: "operator@example.com", password: "Oper8pwd", role: "operator" }
    });
    assert.equal(response.status, 201);
    response = await request("/api/login", {
      method: "POST",
      body: { email: "operator@example.com", password: "Oper8pwd" }
    });
    assert.equal(response.status, 200);
    const operatorCookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal((await request("/api/admin/users", { cookie: operatorCookie })).status, 403);
    assert.equal((await request("/api/receipt-settings", { cookie: operatorCookie })).status, 403);
    assert.equal((await request("/api/admin/backup", { cookie: operatorCookie })).status, 403);
    response = await request("/api/account/password", {
      method: "POST", cookie: operatorCookie,
      body: { currentPassword: "Oper8pwd", newPassword: "1234567" }
    });
    assert.equal(response.status, 403);
    response = await request("/api/account/password", {
      method: "POST", cookie: operatorCookie,
      body: { currentPassword: "incorrecta", newPassword: "clave1234" }
    });
    assert.equal(response.status, 403);
    response = await request("/api/account/password", {
      method: "POST", cookie: operatorCookie,
      body: { currentPassword: "Oper8pwd", newPassword: "clave123" }
    });
    assert.equal(response.status, 403);
    response = await request("/api/login", {
      method: "POST",
      body: { email: "operator@example.com", password: "Oper8pwd" }
    });
    assert.equal(response.status, 200);
    response = await request("/api/admin/users", { cookie });
    assert.equal(response.status, 200);
    assert.equal((await json(response)).users.find((user) => user.email === "operator@example.com").isAdmin, false);

    response = await request("/api/stock/import", {
      method: "POST", cookie, contentType: "text/csv; charset=utf-8",
      rawBody: "sku,barcode,name,category,cost,price,stock,minimumStock\r\nYER-01,,Yerba,,,650,4.500,1\r\nNEW-01,77900001,\"Producto, nuevo\",Casa,20,45,3.250,0\r\n"
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { imported: 2, created: 1 });
    let stockData = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(stockData.find((product) => product.sku === "YER-01").stock, 4.5);
    assert.equal(stockData.find((product) => product.sku === "NEW-01").barcode, "77900001");
    assert.equal(stockData.find((product) => product.sku === "NEW-01").name, "Producto, nuevo");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Stock");
    worksheet.addRow(["sku", "barcode", "name", "category", "cost", "price", "stock", "minimumStock"]);
    worksheet.addRow(["NEW-01", "", "Producto, nuevo", "", 20, 45, 8.125, 0]);
    worksheet.addRow(["XLS-01", "077900002", "Artículo XLSX", "Oficina", 12.5, 30, 2, 0.5]);
    const xlsxBytes = Buffer.from(await workbook.xlsx.writeBuffer());
    response = await request("/api/stock/import", {
      method: "POST", cookie,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      rawBody: xlsxBytes
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { imported: 2, created: 1 });
    stockData = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(stockData.find((product) => product.sku === "NEW-01").stock, 8.125);
    assert.equal(stockData.find((product) => product.sku === "XLS-01").barcode, "077900002");
    assert.equal(stockData.find((product) => product.sku === "XLS-01").price, 30);

    const legacyWorkbook = new ExcelJS.Workbook();
    const legacyWorksheet = legacyWorkbook.addWorksheet("Lista");
    legacyWorksheet.addRow(["ID", "CODIGO", "PRODUCTO", "PREC.COMPRA", "PRECIO", "PRECIO YA", "COD.BARRAS", "PROVEEDOR", "STOCK"]);
    const duplicateLegacyRow = [380, "XLS-01", "Artículo XLSX", 12.5, 30, 25, '"077900002"', "sin proveedor", 4.5];
    legacyWorksheet.addRow(duplicateLegacyRow);
    legacyWorksheet.addRow(duplicateLegacyRow);
    legacyWorksheet.addRow([50, null, "&nbsp;PULSERAS TYVEK X10", 0, 1500, 1200, '""', "sin proveedor", -319]);
    const legacyXlsxBytes = Buffer.from(await legacyWorkbook.xlsx.writeBuffer());
    response = await request("/api/stock/import", {
      method: "POST", cookie,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      rawBody: legacyXlsxBytes
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { imported: 2, created: 1, skippedDuplicates: 1 });
    stockData = (await json(await request("/api/products", { cookie }))).products;
    const wristband = stockData.find((product) => product.sku === "50");
    assert.equal(wristband.name, "PULSERAS TYVEK X10");
    assert.equal(wristband.stock, -319);
    assert.equal(wristband.barcode, "");
    assert.equal(stockData.find((product) => product.sku === "XLS-01").stock, 4.5);
    response = await request(`/api/products/${wristband.id}`, { method: "DELETE", cookie });
    assert.equal(response.status, 200);

    response = await request("/api/stock/import", {
      method: "POST", cookie, contentType: "text/csv",
      rawBody: "sku,stock,name,price\r\nYER-01,99,,\r\nNEW-02,2,Nuevo,\r\n"
    });
    assert.equal(response.status, 400);
    stockData = (await json(await request("/api/products", { cookie }))).products;
    assert.equal(stockData.find((product) => product.sku === "YER-01").stock, 4.5);

    response = await request("/api/stock.csv", { cookie });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /sku,barcode,name,category,cost,price,stock,minimumStock/);

    response = await request("/api/admin/backup", { cookie });
    assert.equal(response.status, 200);
    const backup = Buffer.from(await response.arrayBuffer());
    assert.ok(backup.length > 1000);
    response = await request("/api/admin/backup", {
      method: "POST", cookie, rawBody: "esto no es una base SQLite", contentType: "application/vnd.sqlite3"
    });
    assert.equal(response.status, 400);
    response = await request("/api/stock/import", {
      method: "POST", cookie, contentType: "text/csv",
      rawBody: "sku,stock\r\nYER-01,20\r\n"
    });
    assert.equal(response.status, 200);
    response = await request("/api/admin/backup", {
      method: "POST", cookie, rawBody: backup, contentType: "application/vnd.sqlite3"
    });
    assert.equal(response.status, 200, `${await response.text()}\n${childOutput}`);
    assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
    assert.equal((await request("/api/products", { cookie })).status, 401);
    const restoredLogin = await request("/api/login", {
      method: "POST", body: { email: "admin@example.com", password: "Clave segura 123" }
    });
    assert.equal(restoredLogin.status, 200);
    const restoredCookie = restoredLogin.headers.get("set-cookie").split(";")[0];
    stockData = (await json(await request("/api/products", { cookie: restoredCookie }))).products;
    assert.equal(stockData.find((product) => product.sku === "YER-01").stock, 4.5);
    const restoredPurchases = (await json(await request("/api/transactions?kind=purchase", { cookie: restoredCookie }))).transactions;
    assert.equal(restoredPurchases[0].document.fileName, "factura-compra.pdf");
    response = await request(`/api/transactions/${purchase.id}/document`, { cookie: restoredCookie });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "%PDF-1.4\nComprobante de prueba");
    const audit = await json(await request("/api/admin/audit", { cookie: restoredCookie }));
    assert.ok(audit.entries.some((entry) => entry.action === "restore" && entry.entity === "backup"));
    assert.ok((await readdir(directory)).some((file) => file.includes(".pre-restore-")));

    response = await request("/api/network-info", { cookie: restoredCookie });
    assert.equal(response.status, 200);
    assert.match((await response.json()).address, /^https?:\/\//);
    const customerResponse = await request("/api/customers", {
      method: "POST", cookie: restoredCookie,
      body: { name: "Cliente cuenta corriente" }
    });
    assert.equal(customerResponse.status, 201);
    const accountCustomer = (await customerResponse.json()).customer;
    const accountProductResponse = await request("/api/products", {
      method: "POST", cookie: restoredCookie,
      body: { sku: "ACCOUNT-01", name: "Artículo con saldo", price: "901", stock: "5" }
    });
    assert.equal(accountProductResponse.status, 201);
    const accountProduct = (await accountProductResponse.json()).product;
    response = await request("/api/sales", {
      method: "POST", cookie: restoredCookie,
      body: {
        saleMode: "deposit", customerId: accountCustomer.id,
        items: [{ productId: accountProduct.id, quantity: "1" }],
        payments: [{ method: "cash", amount: "100" }]
      }
    });
    assert.equal(response.status, 201, await response.clone().text());
    const depositSale = (await response.json()).transaction;
    assert.equal(depositSale.saleMode, "deposit");
    assert.equal(depositSale.total - depositSale.payments[0].amount, 801);
    response = await request("/api/accounts", { cookie: restoredCookie });
    assert.equal((await response.json()).accounts[0].balance, 801);
    response = await request(`/api/accounts/${depositSale.id}/payments`, {
      method: "POST", cookie: restoredCookie,
      body: { method: "transfer", amount: "200" }
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).balance, 601);
    response = await request("/api/sales", {
      method: "POST", cookie: restoredCookie,
      body: {
        saleMode: "account", customerId: accountCustomer.id,
        items: [{ productId: accountProduct.id, quantity: "1" }],
        payments: [{ method: "cash", amount: "0" }]
      }
    });
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await response.json()).transaction.saleMode, "account");
    const extraOrderProductResponse = await request("/api/products", {
      method: "POST", cookie: restoredCookie,
      body: { sku: "ORDER-02", name: "Artículo para quitar", price: "100", stock: "5" }
    });
    const extraOrderProduct = (await extraOrderProductResponse.json()).product;
    const orderResponse = await request("/api/sales-orders", {
      method: "POST", cookie: restoredCookie,
      body: {
        customerId: accountCustomer.id,
        items: [{ productId: accountProduct.id, quantity: "1" }, { productId: extraOrderProduct.id, quantity: "1" }]
      }
    });
    assert.equal(orderResponse.status, 201);
    const pendingOrder = (await orderResponse.json()).order;
    response = await request(`/api/sales-orders/${pendingOrder.id}/convert`, {
      method: "POST", cookie: restoredCookie,
      body: {
        items: [{ productId: accountProduct.id, unitPrice: "901", priceTier: 1, quantity: "1", discountPercent: "0" }],
        payments: [{ method: "cash", amount: "901" }]
      }
    });
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await response.json()).transaction.items.length, 1);
    const updatedOrder = (await (await request("/api/sales-orders", { cookie: restoredCookie })).json()).orders
      .find((entry) => entry.id === pendingOrder.id);
    assert.equal(updatedOrder.total, 901);
    assert.equal(updatedOrder.items.length, 1);
    response = await request(`/receipts/${depositSale.id}`, { cookie: restoredCookie });
    assert.match(await response.text(), /SALDO PENDIENTE/);

    response = await request("/api/cash-register/movements", {
      method: "POST", cookie: restoredCookie,
      body: { kind: "out", method: "cash", amount: "25", description: "Compra menor" }
    });
    assert.equal(response.status, 201);
    const cashSummary = await json(await request("/api/cash-register", { cookie: restoredCookie }));
    assert.equal(cashSummary.movements[0].description, "Compra menor");
    response = await request("/api/cash-register/close", {
      method: "POST", cookie: restoredCookie,
      body: { closingAmount: cashSummary.session.expectedCash.toFixed(2), note: "Arqueo verificado" }
    });
    assert.equal(response.status, 200);
    const closedCash = await json(await request("/api/cash-register", { cookie: restoredCookie }));
    assert.equal(closedCash.history[0].difference, 0);
    assert.equal(closedCash.history[0].closingNote, "Arqueo verificado");

    response = await request("/api/receipt-settings", {
      method: "PUT", cookie: restoredCookie,
      body: {
        businessName: "Empresa de prueba", pointOfSale: "0001", receiptTitle: "RECIBO",
        receiptFormat: "ticket"
      }
    });
    assert.equal(response.status, 200);
    response = await request(`/receipts/${depositSale.id}`, { cookie: restoredCookie });
    assert.match(await response.text(), /class="receipt receipt-ticket"/);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("migra bases existentes sin perder productos ni ventas", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gestion-cloud-migration-"));
  const databasePath = path.join(directory, "legacy.db");
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), sku TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '', cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
      price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0), stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (stock_milli >= 0),
      minimum_stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock_milli >= 0), active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (company_id, sku)
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('sale', 'purchase')), number TEXT NOT NULL, contact TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE transaction_sequences (
      company_id INTEGER NOT NULL REFERENCES companies(id), kind TEXT NOT NULL,
      last_number INTEGER NOT NULL CHECK (last_number >= 0), PRIMARY KEY (company_id, kind)
    );
    CREATE TABLE transaction_items (
      id INTEGER PRIMARY KEY, transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL, sku TEXT NOT NULL,
      quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0), unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0)
    );
  `);
  const password = "Clave heredada 123";
  const salt = Buffer.from("1234567890123456");
  const passwordHash = `${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`;
  const companyId = Number(legacyDb.prepare("INSERT INTO companies (name) VALUES (?)").run("Empresa existente").lastInsertRowid);
  const userId = Number(legacyDb.prepare(
    "INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)"
  ).run(companyId, "legacy@example.com", passwordHash).lastInsertRowid);
  const productId = Number(legacyDb.prepare(`
    INSERT INTO products (company_id, sku, name, cost_cents, price_cents, stock_milli, minimum_stock_milli)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(companyId, "LEG-01", "Producto existente", 300, 600, 3000, 0).lastInsertRowid);
  const transactionId = Number(legacyDb.prepare(`
    INSERT INTO transactions (company_id, user_id, kind, number, contact, total_cents)
    VALUES (?, ?, 'sale', 'V-000001', 'Cliente anterior', 600)
  `).run(companyId, userId).lastInsertRowid);
  legacyDb.prepare(`
    INSERT INTO transaction_items (transaction_id, product_id, product_name, sku, quantity_milli, unit_price_cents, subtotal_cents)
    VALUES (?, ?, 'Producto existente', 'LEG-01', 1000, 600, 600)
  `).run(transactionId, productId);
  legacyDb.prepare("INSERT INTO transaction_sequences (company_id, kind, last_number) VALUES (?, 'sale', 0)")
    .run(companyId);
  legacyDb.close();

  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DB_PATH: databasePath, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  async function request(url, { method = "GET", body, cookie } = {}) {
    return fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  }

  let cookie;
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`El servidor no migró la base existente: ${childOutput}`);
      try {
        response = await request("/api/login", {
          method: "POST",
          body: { email: "legacy@example.com", password }
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(response, `El servidor no inició con la base existente: ${childOutput}`);
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
    response = await request("/api/cash-register", { cookie });
    assert.equal((await response.json()).session.openingAmount, 0);
    let products = await (await request("/api/products", { cookie })).json();
    assert.equal(products.products[0].stock, 3);
    assert.equal(products.products[0].price2, products.products[0].price);
    assert.equal(products.products[0].price3, products.products[0].price);

    response = await request("/api/sales", {
      method: "POST", cookie,
      body: {
        items: [{ productId, quantity: "5", discountPercent: "5" }],
        payments: [{ method: "cash", amount: "28.50" }]
      }
    });

    assert.equal(response.status, 201);
    const newSale = (await response.json()).transaction;
    assert.equal(newSale.total, 28.5);
    assert.equal(newSale.number, "V-000002");
    products = await (await request("/api/products", { cookie })).json();
    assert.equal(products.products[0].stock, -2);

    const history = await (await request("/api/transactions?kind=sale", { cookie })).json();
    assert.equal(history.transactions.length, 2);
    assert.equal(history.transactions[0].number, "V-000002");
    assert.equal(history.transactions[1].items[0].discountPercent, 0);
    assert.equal(history.transactions[0].contact, "Consumidor final");
    assert.deepEqual(history.transactions[0].payments, [{ method: "cash", amount: 28.5 }]);
    assert.deepEqual(history.transactions[1].payments, []);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("personaliza comprobantes, aplica descuentos, registra ventas diarias y descuenta recetas", async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "gestion-cloud-recipes-"));
      const port = await unusedPort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PORT: String(port), DB_PATH: path.join(directory, "test.db"), NODE_ENV: "test" },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let childOutput = "";
      child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
      child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

      async function request(url, { method = "GET", body, cookie } = {}) {
        return fetch(`${baseUrl}${url}`, {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(cookie ? { Cookie: cookie } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
      }

      let cookie;
      try {
        let response;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (child.exitCode !== null) throw new Error(`El servidor se cerró durante el inicio: ${childOutput}`);
          try {
            response = await request("/api/session");
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        assert.ok(response, `El servidor no inició a tiempo: ${childOutput}`);
        response = await request("/api/setup", {
          method: "POST",
          body: { company: "Tienda Recetas", email: "recetas@example.com", password: "Clave segura 123" }
        });
        assert.equal(response.status, 201);
        cookie = response.headers.get("set-cookie").split(";")[0];

        response = await request("/api/receipt-settings", {
          method: "PUT", cookie,
          body: {
            businessName: "Marca de prueba", legalName: "Marca de prueba S.R.L.",
            address: "Calle 123", taxId: "30-12345678-9", grossIncome: "901-ABC",
            vatCondition: "Responsable Inscripto", email: "ventas@example.com", phone: "3415550000",
            activityStart: "01/01/2020", pointOfSale: "9800", receiptTitle: "RECIBO",
            logoDataUri: "data:image/png;base64,iVBORw0KGgo="
          }
        });

        test("el panel global crea empresas y usuarios, aísla sus datos y suspende suscripciones", async () => {
          const directory = await mkdtemp(path.join(os.tmpdir(), "gestion-platform-"));
          const port = await unusedPort();
          const baseUrl = `http://127.0.0.1:${port}`;
          const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "..", "server.js")], {
            cwd: path.join(__dirname, ".."),
            env: {
              ...process.env,
              PORT: String(port),
              DB_PATH: path.join(directory, "test.db"),
              NODE_ENV: "test",
              PLATFORM_ADMIN_EMAIL: "global@example.com",
              PLATFORM_ADMIN_PASSWORD: "Global8!",
              FIREBASE_SERVICE_ACCOUNT_JSON: "",
              GOOGLE_APPLICATION_CREDENTIALS: path.join(directory, "missing-service-account.json")
            },
            stdio: ["ignore", "pipe", "pipe"]
          });
          let childOutput = "";
          child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
          child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

          async function request(url, { method = "GET", body, cookie } = {}) {
            return fetch(`${baseUrl}${url}`, {
              method,
              headers: {
                ...(body ? { "Content-Type": "application/json" } : {}),
                ...(cookie ? { Cookie: cookie } : {})
              },
              ...(body ? { body: JSON.stringify(body) } : {})
            });
          }

          try {
            let response;
            for (let attempt = 0; attempt < 50; attempt += 1) {
              if (child.exitCode !== null) throw new Error(`El servidor se cerró durante el inicio: ${childOutput}`);
              try {
                response = await request("/api/session");
                break;
              } catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
            }
            assert.ok(response, `El servidor no inició a tiempo: ${childOutput}`);
            assert.equal((await response.json()).needsSetup, false);
            response = await request("/api/setup", {
              method: "POST",
              body: { company: "No autorizada", email: "setup@example.com", password: "Clave segura 123" }
            });
            assert.equal(response.status, 403);
            response = await request("/api/platform/companies");
            assert.equal(response.status, 401);
            response = await request("/api/update-info");
            assert.equal(response.status, 401);
            response = await request("/platform");
            assert.equal(response.status, 200);
            assert.match(await response.text(), /Administración global/);

            response = await request("/api/platform/login", {
              method: "POST",
              body: { email: "global@example.com", password: "Global8!" }
            });
            assert.equal(response.status, 200);
            const adminCookie = response.headers.get("set-cookie").split(";")[0];

            response = await request("/api/platform/companies", {
              method: "POST",
              cookie: adminCookie,
              body: { company: "Sin rubro", username: "sin_rubro", password: "Clave segura 123" }
            });
            assert.equal(response.status, 400);
            response = await request("/api/platform/companies", {
              method: "POST",
              cookie: adminCookie,
              body: {
                company: "Rubro inválido", username: "rubro_invalido",
                password: "Clave segura 123", industries: ["toString"]
              }
            });
            assert.equal(response.status, 400);

            async function createCompany(company, username, industries = ["almacen"]) {
              const created = await request("/api/platform/companies", {
                method: "POST",
                cookie: adminCookie,
                body: {
                  company, username, password: "Clave segura 123", plan: "pro",
                  subscriptionUntil: "2027-01-01", industries
                }
              });
              assert.equal(created.status, 201);
              return (await created.json()).company;
            }

            const first = await createCompany("Empresa Uno", "empresa_uno", ["ferreteria", "imprenta"]);
            const second = await createCompany("Empresa Dos", "empresa_dos");
            response = await request("/api/platform/companies", { cookie: adminCookie });
            const listed = await response.json();
            assert.equal(listed.companies.length, 2);
            assert.equal(listed.firebase.projectId, "tonotogestion");
            assert.equal(listed.firebase.configured, false);
            assert.deepEqual(listed.firebase.syncFailures, []);
            response = await request("/api/platform/audit", { cookie: adminCookie });
            const audit = await response.json();
            assert.ok(audit.entries.some((entry) => entry.action === "create-company" && entry.companyId === first.id));

            response = await request(`/api/platform/companies/${first.id}/users`, {
              method: "POST",
              cookie: adminCookie,
              body: { username: "operador", password: "Clave segura 123", role: "cashier" }
            });
            assert.equal(response.status, 201);
            const operatorId = (await response.json()).user.id;
            response = await request(`/api/platform/companies/${first.id}/users/${operatorId}`, {
              method: "PUT",
              cookie: adminCookie,
              body: { role: "admin" }
            });
            assert.equal(response.status, 200);
            response = await request(`/api/platform/companies/${first.id}/users/${operatorId}/password`, {
              method: "POST",
              cookie: adminCookie,
              body: { password: "Clave nueva 456" }
            });
            assert.equal(response.status, 200);
            response = await request(`/api/platform/companies/${first.id}/users`, { cookie: adminCookie });
            const managedUser = (await response.json()).users.find((user) => user.id === operatorId);
            assert.equal(managedUser.role, "admin");
            assert.equal(managedUser.username, "operador");

            async function login(username) {
              const loggedIn = await request("/api/login", {
                method: "POST",
                body: { username, password: "Clave segura 123" }
              });
              assert.equal(loggedIn.status, 200);
              return loggedIn.headers.get("set-cookie").split(";")[0];
            }

            const firstCookie = await login("empresa_uno");
            const secondCookie = await login("empresa_dos");
            response = await request("/api/update-info", { cookie: firstCookie });
            assert.equal(response.status, 200);
            assert.equal((await response.json()).update, null);
            response = await request("/api/products", { cookie: firstCookie });
            const firstCompanyProducts = (await response.json()).products;
            assert.equal(firstCompanyProducts.length, 400);
            assert.ok(firstCompanyProducts.some((product) => product.name === "Impresión de texto · A4 color" && product.stock === 0));
            assert.ok(firstCompanyProducts.every((product) => product.price === 0 && product.stock === 0));
            response = await request("/api/products", { cookie: secondCookie });
            const secondCompanyProducts = (await response.json()).products;
            assert.equal(secondCompanyProducts.length, 200);
            assert.ok(secondCompanyProducts.every((product) => product.category === "Almacén"));
            assert.ok(secondCompanyProducts.every((product) => product.price === 0 && product.stock === 0));
            response = await request("/api/cash-register", { cookie: firstCookie });
            assert.equal((await response.json()).session.openingAmount, 0);
            response = await request("/api/cash-register", { cookie: secondCookie });
            assert.equal((await response.json()).session.openingAmount, 0);
            response = await request("/api/login", {
              method: "POST",
              body: { username: "operador", password: "Clave segura 123" }
            });
            assert.equal(response.status, 401);
            response = await request("/api/login", {
              method: "POST",
              body: { username: "operador", password: "Clave nueva 456" }
            });
            assert.equal(response.status, 200);
            response = await request("/api/products", {
              method: "POST",
              cookie: firstCookie,
              body: { sku: "EMP-UNO", name: "Producto privado", price: "10", stock: "3" }
            });
            assert.equal(response.status, 201);
            response = await request("/api/products", { cookie: secondCookie });
            assert.equal((await response.json()).products.length, 200);

            response = await request(`/api/platform/companies/${first.id}/users`, {
              method: "POST",
              cookie: adminCookie,
              body: { username: "vendedor_uno", password: "Clave segura 123", role: "seller" }
            });
            assert.equal(response.status, 201);
            response = await request(`/api/platform/companies/${first.id}/users`, {
              method: "POST",
              cookie: adminCookie,
              body: { username: "cajero_uno", password: "Clave segura 123", role: "cashier" }
            });
            assert.equal(response.status, 201);

            async function loginAs(username) {
              const loggedIn = await request("/api/login", {
                method: "POST",
                body: { username, password: "Clave segura 123" }
              });
              assert.equal(loggedIn.status, 200);
              return loggedIn.headers.get("set-cookie").split(";")[0];
            }

            const sellerCookie = await loginAs("vendedor_uno");
            const cashierCookie = await loginAs("cajero_uno");
            response = await request(`/api/platform/companies/${first.id}/users/${(await (await request(
              `/api/platform/companies/${first.id}/users`, { cookie: adminCookie }
            )).json()).users.find((user) => user.username === "vendedor_uno").id}`, {
              method: "PUT",
              cookie: adminCookie,
              body: { displayName: "María Vendedora" }
            });
            assert.equal(response.status, 200);
            response = await request("/api/account/profile", {
              method: "PUT",
              cookie: sellerCookie,
              body: { displayName: "Nombre cambiado por cuenta" }
            });
            assert.equal(response.status, 403);
            response = await request("/api/session", { cookie: sellerCookie });
            assert.equal((await response.json()).user.displayName, "María Vendedora");
            response = await request("/api/customers", {
              method: "POST",
              cookie: firstCookie,
              body: { name: "Cliente con descuento", discountPercent: "10" }
            });
            assert.equal(response.status, 201);
            const customerId = (await response.json()).customer.id;
            response = await request("/api/customers", { cookie: sellerCookie });
            assert.equal(response.status, 200);
            assert.equal((await response.json()).customers[0].discountPercent, 10);

            const firstProduct = (await (await request("/api/products", { cookie: firstCookie })).json())
              .products.find((product) => product.sku === "EMP-UNO");
            response = await request("/api/quotes", {
              method: "POST",
              cookie: sellerCookie,
              body: {
                contact: "Cliente del presupuesto",
                validUntil: "2027-01-01",
                items: [{ productId: firstProduct.id, quantity: "1" }]
              }
            });
            assert.equal(response.status, 201);
            const sellerQuote = (await response.json()).quote;
            assert.equal(sellerQuote.createdBy, "María Vendedora");
            response = await request("/api/sales-orders", {
              method: "POST",
              cookie: sellerCookie,
              body: { customerId, items: [{ productId: firstProduct.id, quantity: "1" }] }
            });
            assert.equal(response.status, 201);
            const order = (await response.json()).order;
            assert.equal(order.createdBy, "María Vendedora");
            assert.equal(order.total, 9);

            response = await request("/api/sales", {
              method: "POST",
              cookie: sellerCookie,
              body: {
                items: [{ productId: firstProduct.id, quantity: "1" }],
                payments: [{ method: "cash", amount: "10" }]
              }
            });
            assert.equal(response.status, 403);
            response = await request(`/api/sales-orders/${order.id}/convert`, {
              method: "POST",
              cookie: sellerCookie,
              body: { payments: [{ method: "cash", amount: "9" }] }
            });
            assert.equal(response.status, 403);

            response = await request(`/api/sales-orders/${order.id}/convert`, {
              method: "POST",
              cookie: cashierCookie,
              body: { payments: [{ method: "cash", amount: "9" }] }
            });
            assert.equal(response.status, 201);
            const converted = (await response.json()).transaction;
            assert.equal(converted.total, 9);
            assert.equal(converted.salespersonName, "María Vendedora");
            response = await request(`/receipts/${converted.id}`, { cookie: cashierCookie });
            assert.equal(response.status, 200);
            assert.match(await response.text(), /ATENDIÓ: María Vendedora/);
            const businessDate = new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Argentina/Buenos_Aires",
              year: "numeric", month: "2-digit", day: "2-digit"
            }).format(new Date());
            response = await request(`/api/sales/daily?date=${businessDate}`, { cookie: cashierCookie });
            assert.equal(response.status, 200);
            const dailySales = await response.json();
            assert.deepEqual(dailySales.salesByUser.map((entry) => ({
              displayName: entry.displayName, count: entry.count, total: entry.total
            })), [{ displayName: "María Vendedora", count: 1, total: 9 }]);
            response = await request("/api/dashboard", { cookie: cashierCookie });
            const dashboard = await response.json();
            assert.ok(dashboard.stats.salesByUser.some((entry) =>
              entry.displayName === "María Vendedora" && entry.count === 1 && entry.total === 9
            ));
            response = await request(`/api/transactions/${converted.id}`, {
              method: "DELETE",
              cookie: cashierCookie
            });
            assert.equal(response.status, 403);

            response = await request("/api/cash-register", { cookie: cashierCookie });
            assert.equal((await response.json()).session.expectedCash, 9);
            response = await request("/api/cash-register/close", {
              method: "POST",
              cookie: cashierCookie,
              body: { closingAmount: "9" }
            });
            assert.equal(response.status, 200);
            response = await request("/api/sales", {
              method: "POST",
              cookie: cashierCookie,
              body: {
                items: [{ productId: firstProduct.id, quantity: "1" }],
                payments: [{ method: "cash", amount: "10" }]
              }
            });
            assert.equal(response.status, 201);
            const saleWithoutCashSession = (await response.json()).transaction;
            assert.equal(saleWithoutCashSession.total, 10);
            response = await request("/api/cash-register", { cookie: cashierCookie });
            assert.equal((await response.json()).session, null);
            response = await request(`/api/transactions/${saleWithoutCashSession.id}`, {
              method: "DELETE",
              cookie: firstCookie
            });
            assert.equal(response.status, 200);
            response = await request(`/api/transactions/${converted.id}`, {
              method: "DELETE",
              cookie: firstCookie
            });
            assert.equal(response.status, 200, JSON.stringify(await response.json()));
            response = await request("/api/sales-orders", { cookie: firstCookie });
            assert.equal((await response.json()).orders.find((entry) => entry.id === order.id).status, "open");
            response = await request("/api/products", { cookie: firstCookie });
            assert.equal((await response.json()).products.find((entry) => entry.id === firstProduct.id).stock, 3);

            response = await request("/api/sales-orders", {
              method: "POST",
              cookie: cashierCookie,
              body: { contact: "Consumidor final", items: [{ productId: firstProduct.id, quantity: "1" }] }
            });
            assert.equal(response.status, 201);
            const sellerId = (await (await request(`/api/platform/companies/${first.id}/users`, {
              cookie: adminCookie
            })).json()).users.find((user) => user.username === "vendedor_uno").id;
            response = await request(`/api/platform/companies/${first.id}/users/${sellerId}`, {
              method: "DELETE",
              cookie: adminCookie
            });
            assert.equal(response.status, 200);
            response = await request("/api/quotes", { cookie: firstCookie });
            assert.equal((await response.json()).quotes.find((quote) => quote.id === sellerQuote.id).createdBy, "María Vendedora");
            response = await request("/api/sales-orders", { cookie: firstCookie });
            assert.equal((await response.json()).orders.find((entry) => entry.id === order.id).createdBy, "María Vendedora");
            response = await request("/api/session", { cookie: sellerCookie });
            assert.equal((await response.json()).user, null);

            response = await request(`/api/platform/companies/${first.id}`, {
              method: "PUT",
              cookie: adminCookie,
              body: { status: "suspended" }
            });
            assert.equal(response.status, 200);
            response = await request("/api/products", { cookie: firstCookie });
            assert.equal(response.status, 401);
            response = await request("/api/login", {
              method: "POST",
              body: { username: "empresa_uno", password: "Clave segura 123" }
            });
            assert.equal(response.status, 403);

            response = await request(`/api/platform/companies/${first.id}`, {
              method: "PUT",
              cookie: adminCookie,
              body: { status: "active" }
            });
            assert.equal(response.status, 200);
            await login("empresa_uno");
            response = await request("/api/platform/companies", { cookie: adminCookie });
            const reactivated = (await response.json()).companies.find((company) => company.id === first.id);
            assert.equal(reactivated.plan, "pro");
            assert.equal(reactivated.subscriptionUntil, "2027-01-01");
            const reactivatedCookie = await login("empresa_uno");
            response = await request(`/api/platform/companies/${first.id}`, {
              method: "PUT",
              cookie: adminCookie,
              body: { status: "active", subscriptionUntil: "2000-01-01" }
            });
            assert.equal(response.status, 200);
            response = await request("/api/session", { cookie: reactivatedCookie });
            assert.equal((await response.json()).user.subscriptionExpired, true);
            response = await request("/api/products", { cookie: reactivatedCookie });
            assert.equal(response.status, 402);
            response = await request("/api/login", {
              method: "POST",
              body: { username: "empresa_uno", password: "Clave segura 123" }
            });
            assert.equal(response.status, 403);
            assert.equal((await response.json()).subscriptionExpired, true);
            response = await request("/api/platform/companies", { cookie: adminCookie });
            assert.equal((await response.json()).companies.find((company) => company.id === first.id).expired, 1);
            response = await request(`/api/platform/companies/${first.id}`, {
              method: "PUT",
              cookie: adminCookie,
              body: { status: "cancelled" }
            });
            assert.equal(response.status, 200);
            response = await request("/api/login", {
              method: "POST",
              body: { username: "empresa_uno", password: "Clave segura 123" }
            });
            assert.equal(response.status, 403);
            const cancelledLogin = await response.json();
            assert.equal(cancelledLogin.subscriptionCancelled, true);
            assert.match(cancelledLogin.error, /recibirte con las puertas abiertas/);

            response = await request(`/api/platform/companies/${first.id}`, {
              method: "DELETE",
              cookie: adminCookie
            });
            assert.equal(response.status, 200, JSON.stringify(await response.json()));
            response = await request("/api/platform/companies", { cookie: adminCookie });
            assert.deepEqual((await response.json()).companies.map((company) => company.id), [second.id]);
            response = await request("/api/cash-register", { cookie: secondCookie });
            assert.equal(response.status, 200);
            response = await request("/api/login", {
              method: "POST",
              body: { username: "empresa_uno", password: "Clave segura 123" }
            });
            assert.equal(response.status, 401);
            response = await request("/api/platform/audit", { cookie: adminCookie });
            assert.ok((await response.json()).entries.some((entry) =>
              entry.action === "delete-company" && entry.companyId === first.id
            ));
          } finally {
            if (child.exitCode === null) {
              const exited = once(child, "exit");
              child.kill();
              await exited;
            }
            await rm(directory, { recursive: true, force: true });
          }
        });
        assert.equal(response.status, 200);
        const savedSettings = (await response.json()).settings;
        assert.equal(savedSettings.legal_name, "Marca de prueba S.R.L.");
        assert.equal(savedSettings.point_of_sale, "9800");

        const products = {};
        for (const product of [
          { sku: "PAN-01", name: "Pan", cost: "10", price: "100", stock: "100" },
          { sku: "RELL-01", name: "Relleno", cost: "20", price: "200", stock: "50" }
        ]) {
          response = await request("/api/products", { method: "POST", cookie, body: product });
          assert.equal(response.status, 201);
          products[product.sku] = (await response.json()).product;
        }
        response = await request("/api/recipes", {
          method: "POST", cookie,
          body: {
            product: { sku: "SAND-01", name: "Sándwich", cost: "50", price: "1000", stock: "99" },
            components: [
              { productId: products["PAN-01"].id, quantity: "2" },
              { productId: products["RELL-01"].id, quantity: "0.250" }
            ]
          }
        });
        assert.equal(response.status, 201);
        const recipe = (await response.json()).recipe;
        assert.equal(recipe.components.length, 2);
        products["SAND-01"] = (await (await request("/api/products", { cookie })).json())
          .products.find((product) => product.sku === "SAND-01");

        const saleBody = {
          contact: "Cliente Personalizado",
          contactTaxId: "20-98765432-1",
          contactVatCondition: "Monotributista",
          contactAddress: "Av. Ejemplo 456",
          contactPhone: "3415551111",
          contactEmail: "cliente@example.com",
          generalDiscountPercent: "10",
          items: [{ productId: products["SAND-01"].id, quantity: "2" }],
          payments: [{ method: "cash", amount: "1800" }]
        };
        const sales = [];
        for (let index = 0; index < 3; index += 1) {
          response = await request("/api/sales", { method: "POST", cookie, body: saleBody });
          assert.equal(response.status, 201);
          sales.push((await response.json()).transaction);
        }
        assert.deepEqual(sales.map((sale) => sale.number), ["V-000001", "V-000002", "V-000003"]);
        assert.equal(sales[0].total, 1800);
        assert.equal(sales[0].generalDiscountPercent, 10);
        assert.equal(sales[0].contactEmail, "cliente@example.com");

        let inventory = (await (await request("/api/products", { cookie })).json()).products;
        assert.equal(inventory.find((product) => product.id === products["PAN-01"].id).stock, 88);
        assert.equal(inventory.find((product) => product.id === products["RELL-01"].id).stock, 48.5);
        assert.equal(inventory.find((product) => product.id === products["SAND-01"].id).stock, 99);

        response = await request(`/receipts/${sales[0].id}`, { cookie });
        assert.equal(response.status, 200);
        const receipt = await response.text();
        for (const value of [
          "Marca de prueba", "Marca de prueba S.R.L.", "Calle 123", "30-12345678-9",
          "901-ABC", "PUNTO DE VENTA: 9800", "Cliente Personalizado", "20-98765432-1",
          "Monotributista", "Av. Ejemplo 456", "3415551111", "cliente@example.com",
          "DESCUENTO GENERAL (10 %)", "COMPROBANTE INTERNO", "data:image/png;base64"
        ]) assert.ok(receipt.includes(value), `El comprobante personalizado debería incluir ${value}.`);

        const businessDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit"
        }).format(new Date());
        response = await request(`/api/sales/daily?date=${businessDate}`, { cookie });
        assert.equal(response.status, 200);
        let daily = await response.json();
        assert.equal(daily.count, 3);
        assert.equal(daily.total, 5400);
        assert.deepEqual(daily.paymentTotals, [{ method: "cash", amount: 5400 }]);

        response = await request(`/api/recipes/${recipe.id}`, {
          method: "PUT", cookie,
          body: {
            productId: products["SAND-01"].id,
            components: [
              { productId: products["PAN-01"].id, quantity: "3" },
              { productId: products["RELL-01"].id, quantity: "0.500" }
            ]
          }
        });
        assert.equal(response.status, 200);

        response = await request(`/api/transactions/${sales[2].id}`, { method: "DELETE", cookie });
        assert.equal(response.status, 200);
        inventory = (await (await request("/api/products", { cookie })).json()).products;
        assert.equal(inventory.find((product) => product.id === products["PAN-01"].id).stock, 92);
        assert.equal(inventory.find((product) => product.id === products["RELL-01"].id).stock, 49);

        response = await request(`/api/recipes/${recipe.id}`, { method: "DELETE", cookie });
        assert.equal(response.status, 200);
        response = await request("/api/sales", {
          method: "POST", cookie,
          body: { items: [{ productId: products["PAN-01"].id, quantity: "1" }], payments: [{ method: "cash", amount: "100" }] }
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).transaction.number, "V-000003");

        response = await request("/api/sales/daily?date=not-a-date", { cookie });
        assert.equal(response.status, 400);

        const inventoryBeforeQuote = (await (await request("/api/products", { cookie })).json()).products;
        const breadBeforeQuote = inventoryBeforeQuote.find((product) => product.id === products["PAN-01"].id);
        response = await request("/api/quotes", {
          method: "POST", cookie,
          body: {
            contact: "Cliente de presupuesto",
            validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
            generalDiscountPercent: "10",
            items: [
              { productId: breadBeforeQuote.id, priceTier: 2, unitPrice: "120", quantity: "2", discountPercent: "10" },
              { custom: true, name: "Envío especial", unitPrice: "50", quantity: "1", discountPercent: "0" }
            ]
          }
        });
        assert.equal(response.status, 201);
        const quote = (await response.json()).quote;
        assert.equal(quote.number, "P-000001");
        assert.equal(quote.total, 239.4);
        assert.equal(quote.items[0].unitPrice, 120);
        assert.equal(quote.items[1].productId, null);

        response = await request(`/quotes/${quote.id}`, { cookie });
        assert.equal(response.status, 200);
        const quoteDocument = await response.text();
        assert.match(quoteDocument, /PRESUPUESTO/);
        assert.match(quoteDocument, /no reserva stock/);
        assert.match(quoteDocument, /print.js/);
        assert.equal((await (await request("/api/products", { cookie })).json()).products
          .find((product) => product.id === breadBeforeQuote.id).stock, breadBeforeQuote.stock);

        response = await request(`/api/products/${breadBeforeQuote.id}`, {
          method: "PUT", cookie,
          body: {
            sku: breadBeforeQuote.sku, name: breadBeforeQuote.name, category: breadBeforeQuote.category,
            brand: breadBeforeQuote.brand, cost: String(breadBeforeQuote.cost),
            bonusPercent: String(breadBeforeQuote.bonusPercent), guildDiscountPercent: String(breadBeforeQuote.guildDiscountPercent),
            profitPercent: String(breadBeforeQuote.profitPercent), discountedCost: String(breadBeforeQuote.discountedCost),
            priceWithVat: String(breadBeforeQuote.priceWithVat), price: "500", price2: "600", price3: "700",
            stock: String(breadBeforeQuote.stock), minimumStock: String(breadBeforeQuote.minimumStock)
          }
        });
        assert.equal(response.status, 200);
        response = await request(`/api/quotes/${quote.id}/convert`, {
          method: "POST", cookie,
          body: { payments: [{ method: "cash", amount: "239.39" }] }
        });
        assert.equal(response.status, 400);
        assert.equal((await (await request("/api/products", { cookie })).json()).products
          .find((product) => product.id === breadBeforeQuote.id).stock, breadBeforeQuote.stock);
        response = await request(`/api/quotes/${quote.id}/convert`, {
          method: "POST", cookie,
          body: { payments: [{ method: "cash", amount: "239.40" }] }
        });
        assert.equal(response.status, 201);
        const converted = await response.json();
        assert.equal(converted.transaction.total, 239.4);
        assert.equal(converted.transaction.items[0].unitPrice, 120);
        assert.equal(converted.transaction.items[1].name, "Envío especial");
        assert.equal(converted.quote.status, "converted");
        assert.equal(converted.quote.saleTransactionId, converted.transaction.id);
        response = await request(`/api/quotes/${quote.id}/convert`, {
          method: "POST", cookie,
          body: { payments: [{ method: "cash", amount: "239.40" }] }
        });
        assert.equal(response.status, 409);
        const inventoryAfterQuote = (await (await request("/api/products", { cookie })).json()).products;
        assert.equal(inventoryAfterQuote.find((product) => product.id === breadBeforeQuote.id).stock, breadBeforeQuote.stock - 2);
        response = await request(`/api/transactions/${converted.transaction.id}`, { method: "DELETE", cookie });
        assert.equal(response.status, 200, JSON.stringify(await response.json()));
        response = await request("/api/quotes", { cookie });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).quotes.find((entry) => entry.id === quote.id).status, "open");
        const inventoryAfterDeletingConvertedQuote = (await (await request("/api/products", { cookie })).json()).products;
        assert.equal(
          inventoryAfterDeletingConvertedQuote.find((product) => product.id === breadBeforeQuote.id).stock,
          breadBeforeQuote.stock
        );
      } finally {
        if (child.exitCode === null) {
          const exited = once(child, "exit");
          child.kill();
          await exited;
        }
        await rm(directory, { recursive: true, force: true });
      }
});
