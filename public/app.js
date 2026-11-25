const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  user: null,
  page: "dashboard",
  selectedBranchId: null,
  branches: [],
  lanAddress: "",
  products: [],
  recipes: [],
  customers: [],
  salesCart: [],
  orderCart: [],
  orderGeneralDiscountPercent: "0",
  salesOrders: [],
  quoteCart: [],
  salePayments: [{ method: "cash", amount: "0" }],
  cashReceived: "0",
  saleMode: "paid",
  accounts: [],
  labelSelection: [],
  labelsTouched: false,
  generalDiscountPercent: "0",
  receiptLogoDataUri: "",
  salesHistory: [],
  quotes: [],
  selectedSaleProductId: null,
  salePriceTier: 1,
  selectedCustomerId: null,
  activeOrderId: null,
  selectedOrderProductId: null,
  selectedQuoteProductId: null,
  nextCustomSaleItemId: 1,
  toastTimer: null,
  offlineMode: !navigator.onLine,
  pendingSyncCount: 0,
  syncingOfflineQueue: false,
  offlineStorageErrorNotified: false,
  subscriptionExpiryTimer: null,
  onlineVerificationLocked: false,
  onlineVerificationTimer: null,
  cameraScannerActive: false,
  lastCameraScanCode: ""
};

const ONLINE_VERIFICATION_INTERVAL_MS = 72 * 60 * 60 * 1000;
const ONLINE_DEVICE_ID_KEY = "tonoto-online-device-id";

function getOnlineDeviceId() {
  let deviceId = localStorage.getItem(ONLINE_DEVICE_ID_KEY);
  if (!/^[a-f0-9]{32}$/.test(deviceId || "")) {
    deviceId = createOperationId();
    localStorage.setItem(ONLINE_DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

function onlineLeaseKey(deviceId) {
  const username = state.user?.username || state.user?.email || "";
  return `tonoto-online-lease:${state.user?.companyId || ""}:${username}:${deviceId}`;
}

function saveOnlineLease(deviceId, expiresInMs) {
  localStorage.setItem(onlineLeaseKey(deviceId), JSON.stringify({
    expiresAt: Date.now() + expiresInMs
  }));
}

function readOnlineLease(deviceId) {
  const key = onlineLeaseKey(deviceId);
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  let lease;
  try {
    lease = JSON.parse(stored);
  } catch (error) {
    console.error("No se pudo leer la vigencia local de verificación:", error);
    localStorage.removeItem(key);
    return null;
  }
  return lease && Number.isFinite(lease.expiresAt) && lease.expiresAt > Date.now()
    ? lease
    : null;
}

const offlineDatabase = new Promise((resolve, reject) => {
  if (!("indexedDB" in window)) {
    reject(new Error("Este navegador no admite almacenamiento offline."));
    return;
  }
  const request = indexedDB.open("tonotos-offline", 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore("responses", { keyPath: "key" });
    database.createObjectStore("mutations", { keyPath: "id", autoIncrement: true });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento offline."));
});

function offlineRequest(storeName, mode, action) {
  return offlineDatabase.then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falló el almacenamiento local."));
    transaction.onabort = () => reject(transaction.error || new Error("Falló una operación de almacenamiento local."));
  }));
}

function tenantCacheKey(path) {
  const companyId = state.user?.companyId || localStorage.getItem("tonoto-last-company-id") || "session";
  const branchId = state.selectedBranchId || state.user?.branchId || "default";
  return `${companyId}:${branchId}:${path}`;
}

async function cacheApiResponse(path, data) {
  try {
  if (path === "/api/session") {
    if (data.user) localStorage.setItem("tonoto-last-company-id", String(data.user.companyId));
    return offlineRequest("responses", "readwrite", (store) => store.put({
      key: "session:current", data, savedAt: Date.now()
    }));
  }
  if (!state.user?.companyId) return Promise.resolve();
  await offlineRequest("responses", "readwrite", (store) => store.put({
    key: tenantCacheKey(path), data
  }));
  } catch (error) {
    if (!state.offlineStorageErrorNotified) {
      state.offlineStorageErrorNotified = true;
      notify(`No se pudo guardar la caché offline: ${error.message}`, true);
    }
  }
}

function getCachedApiResponse(path) {
  const key = path === "/api/session" ? "session:current" : tenantCacheKey(path);
  return offlineRequest("responses", "readonly", (store) => store.get(key)).then(async (entry) => {
    if (!entry) return null;
    if (path === "/api/session" && Date.now() - entry.savedAt > 8 * 60 * 60 * 1000) {
      await offlineRequest("responses", "readwrite", (store) => store.delete(key));
      return null;
    }
    return entry.data || null;
  });
}

function isOfflineQueueable(path, method, body) {
  return (Boolean(body) || method === "DELETE") &&
    ((method === "POST" && /^\/api\/(sales|purchases|quotes|products)$/.test(path)) ||
      (method === "POST" && /^\/api\/quotes\/\d+\/convert$/.test(path)) ||
      (method === "POST" && /^\/api\/sales-orders(?:\/\d+\/convert)?$/.test(path)) ||
      (method === "PUT" && /^\/api\/products\/\d+$/.test(path)) ||
      (method === "DELETE" && /^\/api\/(quotes|sales-orders|transactions|products)\/\d+$/.test(path)));
}

async function updatePendingSyncCount() {
  try {
    const mutations = await offlineRequest("mutations", "readonly", (store) => store.getAll());
    state.pendingSyncCount = mutations.filter((entry) => entry.companyId === state.user?.companyId).length;
  } catch (error) {
    state.pendingSyncCount = 0;
    if (!state.offlineStorageErrorNotified) {
      state.offlineStorageErrorNotified = true;
      notify(`No se pudo consultar la cola offline: ${error.message}`, true);
    }
  }
  updateConnectionStatus();
}

function updateConnectionStatus() {
  const badge = $("#connection-status");
  if (!badge) return;
  badge.textContent = state.offlineMode
    ? `Sin conexión · ${state.pendingSyncCount} pendiente${state.pendingSyncCount === 1 ? "" : "s"}`
    : state.pendingSyncCount
      ? `Sincronizando · ${state.pendingSyncCount} pendiente${state.pendingSyncCount === 1 ? "" : "s"}`
      : "En línea";
  badge.classList.toggle("is-offline", state.offlineMode || state.pendingSyncCount > 0);
}

async function loadLanAddress() {
  try {
    const data = await api("/api/network-info");
    const address = $("#lan-address");
    if (!address || !data.address) return;
    state.lanAddress = data.address;
    address.textContent = `IP móvil: ${data.address}`;
    address.title = `Dirección para sincronizar la aplicación móvil: ${data.address}`;
  } catch {
    state.lanAddress = "";
  }
}

async function queueOfflineMutation(path, method, body, operationId) {
  await offlineRequest("mutations", "readwrite", (store) => store.add({
    companyId: state.user.companyId,
    userEmail: state.user.email,
    branchId: state.selectedBranchId || state.user.branchId,
    operationId,
    path,
    method,
    body,
    createdAt: Date.now()
  }));
  await updatePendingSyncCount();
}

async function flushOfflineQueue() {
  if (!navigator.onLine || !state.user?.companyId || state.syncingOfflineQueue) return;
  state.syncingOfflineQueue = true;
  let syncedCount = 0;
  try {
    const mutations = await offlineRequest("mutations", "readonly", (store) => store.getAll());
    for (const mutation of mutations) {
      if (mutation.companyId !== state.user.companyId || mutation.userEmail !== state.user.email) continue;
      let response;
      try {
        response = await fetch(mutation.path, {
          method: mutation.method,
          headers: {
            "Content-Type": "application/json",
            "X-Offline-Operation-Id": mutation.operationId,
            "X-Branch-Id": String(mutation.branchId || state.user.branchId)
          },
          body: mutation.body,
          credentials: "same-origin"
        });
      } catch {
        state.offlineMode = true;
        break;
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        mutation.lastError = errorData.error || `HTTP ${response.status}`;
        await offlineRequest("mutations", "readwrite", (store) => store.put(mutation));
        notify(`No se pudo sincronizar una operación pendiente: ${mutation.lastError}`, true);
        break;
      }
      await offlineRequest("mutations", "readwrite", (store) => store.delete(mutation.id));
      syncedCount += 1;
    }
  } finally {
    state.syncingOfflineQueue = false;
    state.offlineMode = !navigator.onLine;
    await updatePendingSyncCount();
    if (syncedCount > 0 && state.user) await renderPage();
  }
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const button = $("#theme-toggle");
  if (button) {
    button.textContent = isDark ? "☼" : "☾";
    button.setAttribute("aria-label", isDark ? "Usar tema claro" : "Usar tema oscuro");
    button.title = isDark ? "Usar tema claro" : "Usar tema oscuro";
  }
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("tonoto-theme", nextTheme);
  applyTheme(nextTheme);
}

applyTheme(localStorage.getItem("tonoto-theme") || "light");

const paymentMethods = {
  cash: "Efectivo",
  debit: "Tarjeta de débito",
  credit: "Tarjeta de crédito",
  transfer: "Transferencia",
  other: "Otro medio"
};

const pageTitles = {
  dashboard: "Resumen",
  dailySales: "Registro diario",
  sales: "Facturación",
  cashRegister: "Caja",
  salesOrders: "Ventas",
  quotes: "Presupuestos",
  purchases: "Compras",
  products: "Productos y stock",
  recipes: "Recetas",
  labels: "Etiquetas",
  customers: "Clientes",
  accounts: "Cuenta corriente",
  mobileConnect: "Conexión Móvil",
  branches: "Sucursales",
  receiptSettings: "Comprobantes"
};

const rolePages = {
  admin: Object.keys(pageTitles),
  manager: ["dashboard", "dailySales", "sales", "cashRegister", "salesOrders", "quotes", "purchases", "products", "recipes", "labels", "customers", "accounts", "mobileConnect", "branches"],
  cashier: ["dashboard", "dailySales", "sales", "cashRegister", "salesOrders", "quotes", "accounts", "labels", "mobileConnect"],
  seller: ["salesOrders", "quotes", "accounts", "labels", "mobileConnect"]
};

const currency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});

const quantityFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function generateProductSku() {
  let sku;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    sku = `SKU-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  } while (state.products.some((product) => product.sku.toUpperCase() === sku));
  return sku;
}

function formatMoney(value) {
  return currency.format(Number(value) || 0);
}

function formatQuantity(value) {
  return quantityFormat.format(Number(value) || 0);
}

function amountToCents(value) {
  const match = String(value).match(/^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const [whole, fraction = ""] = String(value).split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function formatDate(value, options = { day: "2-digit", month: "short", year: "numeric" }) {
  const date = new Date(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z"));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-AR", options).format(date);
}

function initials(value) {
  const parts = String(value || "").split(/[@\s.]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] || "GC").slice(0, 2)).toUpperCase();
}

function notify(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function notifyReceiptLink(transaction, message) {
  const toast = $("#toast");
  toast.innerHTML = `${escapeHtml(message)} <a class="toast-link" href="${branchDocumentUrl(`/receipts/${transaction.id}`)}" target="_blank" rel="noopener">Abrir comprobante ↗</a>`;
  toast.classList.remove("is-error");
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 10000);
}

function openReceiptWindow(transaction) {
  return Boolean(window.open(branchDocumentUrl(`/receipts/${transaction.id}`), "_blank"));
}

function branchDocumentUrl(path) {
  const branchId = state.selectedBranchId || state.user?.branchId;
  return branchId ? `${path}?branchId=${encodeURIComponent(branchId)}` : path;
}

function createOperationId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const operationId = method === "GET" ? null : createOperationId();
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(operationId ? { "X-Offline-Operation-Id": operationId } : {}),
        ...((state.selectedBranchId || state.user?.branchId)
          ? { "X-Branch-Id": String(state.selectedBranchId || state.user.branchId) }
          : {}),
        ...options.headers
      },
      credentials: "same-origin"
    });
  } catch (error) {
    if (path === "/api/online-verification") throw error;
    if (method === "GET") {
      const cached = await getCachedApiResponse(path);
      if (cached) {
        state.offlineMode = true;
        updateConnectionStatus();
        return cached;
      }
    }
    if (isOfflineQueueable(path, method, options.body) && state.user?.companyId) {
      await queueOfflineMutation(path, method, options.body, operationId);
      state.offlineMode = true;
      updateConnectionStatus();
      return { offlineQueued: true };
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 402 && data.subscriptionExpired && state.user) {
      state.user.subscriptionExpired = true;
      renderSubscriptionExpired();
    }
    if (response.status === 401) showAuth({ needsSetup: false });
    const error = new Error(data.error || "No se pudo completar la operación.");
    error.status = response.status;
    error.subscriptionCancelled = Boolean(data.subscriptionCancelled);
    throw error;
  }
  state.offlineMode = false;
  if (method === "GET" && path.startsWith("/api/") && path !== "/api/online-verification") {
    await cacheApiResponse(path, data);
  } else if (path === "/api/login" || path === "/api/setup") {
    await cacheApiResponse("/api/session", { needsSetup: false, user: data.user });
  } else if (path === "/api/logout") {
    localStorage.removeItem("tonoto-last-company-id");
    await offlineRequest("responses", "readwrite", (store) => store.delete("session:current"));
  }
  updateConnectionStatus();
  if (method !== "GET" && state.user?.companyId) await flushOfflineQueue();
  return data;
}

function showAuth({ needsSetup, error = "" }) {
  clearTimeout(state.subscriptionExpiryTimer);
  state.subscriptionExpiryTimer = null;
  clearTimeout(state.onlineVerificationTimer);
  state.onlineVerificationTimer = null;
  stopCameraScanner();
  setOnlineVerificationLock(false);
  state.user = null;
  state.selectedBranchId = null;
  state.branches = [];
  state.salesCart = [];
  state.salePayments = [{ method: "cash", amount: "0" }];
  state.saleMode = "paid";
  state.cashReceived = "0";
  state.selectedSaleProductId = null;
  $("#app-screen").hidden = true;
  $("#auth-screen").hidden = false;
  $("#login-form").hidden = false;
  $("#auth-eyebrow").textContent = "TU EMPRESA, MÁS ORGANIZADA";
  $("#auth-title").textContent = "Qué bueno verte.";
  $("#auth-description").textContent = "Ingresá con el usuario y la contraseña que te asignaron.";
  $("#login-error").textContent = error;
  $("#login-error").classList.remove("subscription-cancelled-message");
}

function setOnlineVerificationLock(locked, message = "") {
  if (locked) {
    stopCameraScanner();
    for (const selector of ["#modal", "#update-dialog"]) {
      const dialog = $(selector);
      if (dialog?.open) dialog.close();
    }
  }
  state.onlineVerificationLocked = locked;
  const shell = $("#app-screen");
  if (shell) shell.inert = locked;
  const overlay = $("#online-verification-lock");
  if (!overlay) return;
  overlay.hidden = !locked;
  if (message) $("#online-verification-message").textContent = message;
  if (locked) $("#online-verification-retry").focus();
  else if ($("#online-verification-retry") === document.activeElement) $("#page-content").focus();
}

function scheduleOnlineVerification(delay) {
  clearTimeout(state.onlineVerificationTimer);
  state.onlineVerificationTimer = setTimeout(() => {
    state.onlineVerificationTimer = null;
    void verifyOnlineAccess();
  }, Math.max(0, delay));
}

async function verifyOnlineAccess() {
  if (!state.user) return false;
  setOnlineVerificationLock(true, "Comprobando la conexión de esta PC con Firebase…");
  const requestWithTimeout = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      return await api(path, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    const deviceId = getOnlineDeviceId();
    let status;
    try {
      status = await requestWithTimeout("/api/online-verification", {
        headers: { "X-Tonotos-Device-Id": deviceId }
      });
    } catch (error) {
      if (error instanceof TypeError) {
        // Keep the existing offline window if the local server is temporarily unreachable.
        const lease = readOnlineLease(deviceId);
        if (lease) {
          state.offlineMode = true;
          updateConnectionStatus();
          setOnlineVerificationLock(false);
          scheduleOnlineVerification(lease.expiresAt - Date.now());
          return true;
        }
      }
      throw error;
    }
    if (!status.configured) {
      throw new Error("Firebase no está configurado en la PC servidor. Contactá al administrador del sistema.");
    }

    const lastVerifiedAt = Date.parse(status.verifiedAt || "");
    const verificationDue = typeof status.due === "boolean"
      ? status.due
      : !Number.isFinite(lastVerifiedAt) ||
        Date.now() - lastVerifiedAt >= ONLINE_VERIFICATION_INTERVAL_MS;
    if (!verificationDue) {
      saveOnlineLease(deviceId, status.expiresInMs ??
        Math.max(0, lastVerifiedAt + ONLINE_VERIFICATION_INTERVAL_MS - Date.now()));
      setOnlineVerificationLock(false);
      scheduleOnlineVerification(status.expiresInMs ??
        Math.max(0, lastVerifiedAt + ONLINE_VERIFICATION_INTERVAL_MS - Date.now()));
      return true;
    }

    if (!navigator.onLine) {
      throw new Error("Esta PC no tiene conexión a internet.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      // Check host reachability here; the server verifies Firestore access with its credentials below.
      await fetch("https://firestore.googleapis.com/", {
        mode: "no-cors", cache: "no-store", credentials: "omit", signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const verification = await requestWithTimeout("/api/online-verification", {
      method: "POST",
      headers: { "X-Tonotos-Device-Id": deviceId }
    });
    saveOnlineLease(deviceId, verification.expiresInMs ?? ONLINE_VERIFICATION_INTERVAL_MS);
    setOnlineVerificationLock(false);
    scheduleOnlineVerification(verification.expiresInMs ?? ONLINE_VERIFICATION_INTERVAL_MS);
    return true;
  } catch (error) {
    if (!state.user) return false;
    clearTimeout(state.onlineVerificationTimer);
    state.onlineVerificationTimer = null;
    const reason = error.status === 404
      ? "El servidor local no tiene instalada la ruta de verificación. Detené y reiniciá Tonotos Gestión en la PC servidor, luego recargá esta página."
      : error.status === 401
        ? "La sesión venció. Volvé a iniciar sesión para verificar la conexión."
        : error.name === "AbortError"
          ? "No se pudo acceder a firestore.googleapis.com en 10 segundos. Revisá si el firewall, antivirus o proxy de esta PC bloquea ese dominio."
          : error.message;
    setOnlineVerificationLock(true, `${reason} Conectá esta PC a internet y volvé a intentar para desbloquear el sistema.`);
    return false;
  }
}

async function showApp(user) {
  state.user = user;
  state.user.role = user.role || (user.isAdmin ? "admin" : "manager");
  state.selectedBranchId = user.branchId || null;
  state.offlineMode = !navigator.onLine;
  state.page = state.user.role === "seller" ? "salesOrders" : "dashboard";
  $("#auth-screen").hidden = true;
  $("#app-screen").hidden = false;
  const username = user.username || user.email || "Administrador";
  const visibleName = user.displayName || username;
  const avatar = initials(visibleName);
  $("#sidebar-email").textContent = visibleName;
  $("#sidebar-company").textContent = user.company || "Mi empresa";
  $("#sidebar-avatar").textContent = avatar;
  $("#topbar-avatar").textContent = avatar;
  setOnlineVerificationLock(true, "Comprobando la conexión de esta PC con Firebase…");
  if (!await verifyOnlineAccess()) return;
  const branchesResponse = await api("/api/branches");
  state.branches = branchesResponse.branches || [];
  if (!state.branches.some((branch) => branch.id === state.selectedBranchId)) {
    state.selectedBranchId = state.branches[0]?.id || user.branchId || null;
  }
  const savedBranchId = Number(localStorage.getItem(`tonoto-selected-branch:${user.companyId}`));
  if (["admin", "manager"].includes(state.user.role) &&
      state.branches.some((branch) => branch.id === savedBranchId)) {
    state.selectedBranchId = savedBranchId;
  }
  state.user.branchId = state.selectedBranchId;
  state.user.branchName = state.branches.find((branch) => branch.id === state.selectedBranchId)?.name
    || user.branchName
    || "Casa Central";
  localStorage.setItem(`tonoto-selected-branch:${user.companyId}`, String(state.selectedBranchId || ""));
  const branchSelector = $("#branch-selector");
  branchSelector.innerHTML = state.branches.map((branch) =>
    `<option value="${branch.id}" ${branch.id === state.selectedBranchId ? "selected" : ""}>${escapeHtml(branch.name)}</option>`
  ).join("");
  branchSelector.hidden = state.branches.length < 2 || !["admin", "manager"].includes(state.user.role);
  $("#sidebar-branch").textContent = state.user.branchName;
  monitorSubscriptionExpiry();
  $$(".nav-link[data-page]").forEach((button) => {
    button.hidden = !rolePages[state.user.role]?.includes(button.dataset.page);
    button.removeAttribute("title");
    button.dataset.tooltip = pageTitles[button.dataset.page] || "";
  });
  $("#sidebar").classList.toggle("is-collapsed", localStorage.getItem("tonoto-sidebar-collapsed") === "true");
  $("#current-date").textContent = new Intl.DateTimeFormat("es-AR", {
    weekday: "short", day: "2-digit", month: "short"
  }).format(new Date());
  updatePendingSyncCount();
  loadLanAddress();
  flushOfflineQueue();
  renderPage();
  void showUpdateAnnouncement();
}

async function showUpdateAnnouncement() {
  try {
    const data = await api("/api/update-info");
    const update = data.update;
    if (!update?.tag) return;
    const seenKey = `tonoto-seen-release:${state.user.companyId}`;
    if (localStorage.getItem(seenKey) === update.tag) return;

    $("#update-version").textContent = `${update.name || "Versión"} · ${update.tag}`;
    $("#update-release-notes").textContent = update.releaseNotes ||
      "Esta versión incluye mejoras en el sistema. Consultá los commits para ver los cambios realizados.";
    const commitSection = $("#update-commits-section");
    const commitList = $("#update-commits");
    commitList.replaceChildren();
    for (const commit of update.commits || []) {
      const item = document.createElement("li");
      item.append(document.createTextNode(`${commit.message || "Cambio sin descripción"} `));
      if (/^[a-f0-9]{7,12}$/i.test(commit.sha || "")) {
        const link = document.createElement("a");
        link.href = `https://github.com/tonotosprint/TonotoGestion/commit/${encodeURIComponent(commit.sha)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = commit.sha;
        item.append(link);
      }
      commitList.append(item);
    }
    commitSection.hidden = commitList.childElementCount === 0;
    const commitNote = $("#update-commit-note");
    commitNote.textContent = update.commitLookupMessage || "";
    commitNote.hidden = !update.commitLookupMessage;
    const releaseLink = $("#update-release-link");
    releaseLink.href = `https://github.com/tonotosprint/TonotoGestion/releases/tag/${encodeURIComponent(update.tag)}`;
    const dialog = $("#update-dialog");
    dialog.dataset.releaseTag = update.tag;
    dialog.showModal();
  } catch (error) {
    notify(`No se pudo consultar el resumen de actualización: ${error.message}`, true);
  }
}

$("#update-dialog").addEventListener("close", (event) => {
  const releaseTag = event.currentTarget.dataset.releaseTag;
  if (!releaseTag || !state.user?.companyId) return;
  try {
    localStorage.setItem(`tonoto-seen-release:${state.user.companyId}`, releaseTag);
  } catch (error) {
    notify(`No se pudo guardar el aviso de actualización: ${error.message}`, true);
  }
});

function monitorSubscriptionExpiry() {
  clearTimeout(state.subscriptionExpiryTimer);
  state.subscriptionExpiryTimer = null;
  if (!state.user?.subscriptionUntil || state.user.subscriptionExpired) return;
  const expiry = Date.parse(`${state.user.subscriptionUntil}T00:00:00-03:00`) + 24 * 60 * 60 * 1000;
  if (!Number.isFinite(expiry)) return;
  const delay = Math.max(0, expiry - Date.now());
  state.subscriptionExpiryTimer = setTimeout(() => {
    if (delay > 2_147_000_000) {
      monitorSubscriptionExpiry();
      return;
    }
    state.user.subscriptionExpired = true;
    renderSubscriptionExpired();
  }, Math.min(delay, 2_147_000_000));
}

async function start() {
  if (window.location.protocol === "file:") return;
  try {
    const session = await api("/api/session");
    $("#launch-screen").hidden = true;
    if (session.user) await showApp(session.user);
    else showAuth({ needsSetup: session.needsSetup });
  } catch (error) {
    $("#launch-title").textContent = "No se pudo conectar con la aplicación.";
    $("#launch-message").textContent = `El servidor no respondió: ${error.message}`;
    $("#launch-retry").hidden = false;
  }
}

function setPage(page) {
  if (!pageTitles[page] || !rolePages[state.user?.role]?.includes(page)) return;
  state.page = page;
  $("#sidebar").classList.remove("is-open");
  $("#sidebar-scrim").classList.remove("is-visible");
  $$(".nav-link").forEach((button) => button.classList.toggle("is-active", button.dataset.page === page));
  $("#breadcrumb-current").textContent = pageTitles[page];
  renderPage();
}

function renderSubscriptionExpired() {
  stopCameraScanner();
  const date = state.user?.subscriptionUntil
    ? formatDate(`${state.user.subscriptionUntil} 12:00:00`)
    : "";
  $("#page-content").innerHTML = `
    <section class="subscription-expired-card" role="alert">
      <span class="subscription-expired-icon" aria-hidden="true">!</span>
      <span class="eyebrow">SUSCRIPCIÓN VENCIDA</span>
      <h1>Renová el servicio para continuar</h1>
      <p>La fecha límite${date ? ` (${escapeHtml(date)})` : ""} ya se cumplió. Para volver a operar, aboná el servicio y contactá al administrador de Tonotos Gestión.</p>
      <button class="button button-secondary" type="button" data-action="logout">Cerrar sesión</button>
    </section>`;
}


let scannerPollTimer = null;
let lastScannerEventId = 0;
let globalScanBuffer = "";
let lastScanKeyTime = 0;

function playScanSound(success = true) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    if (success) {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.09);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.09);
    } else {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    }
  } catch {}
}

function addProductByBarcode(code, page) {
  const cleanCode = String(code || "").trim().toLowerCase();
  if (!cleanCode) return false;

  const product = state.products.find((p) => p.active && p.barcode && p.barcode.trim().toLowerCase() === cleanCode)
    || state.products.find((p) => p.active && p.sku && p.sku.trim().toLowerCase() === cleanCode)
    || state.products.find((p) => p.active && String(p.id) === cleanCode)
    || state.products.find((p) => p.active && p.name && p.name.trim().toLowerCase() === cleanCode);

  if (!product) {
    playScanSound(false);
    notify(`No se encontró ningún producto activo con código o SKU: "${code}"`, true);
    return false;
  }

  playScanSound(true);

  if (page === "sales") {
    const tier = Number(state.salePriceTier || 1);
    const existing = state.salesCart.find((item) => item.productId === product.id && item.priceTier === tier);
    if (existing) {
      existing.quantity = String(Number(existing.quantity) + 1);
    } else {
      state.salesCart.push({
        productId: product.id,
        priceTier: tier,
        unitPrice: String(product[`price${tier === 1 ? "" : tier}`] ?? product.price),
        quantity: "1",
        discountPercent: "0"
      });
    }
    const searchInput = $("#sale-product-search");
    if (searchInput) {
      searchInput.value = "";
      searchInput.setAttribute("aria-expanded", "false");
    }
    const results = $("#sale-search-results");
    if (results) results.hidden = true;
    renderSalesCart();
    notify(`Escaneado en Facturación: ${product.name}`);
    if (searchInput) searchInput.focus();
    return true;
  } else if (page === "salesOrders") {
    const existing = state.orderCart.find((item) => item.productId === product.id);
    if (existing) {
      existing.quantity = String(Number(existing.quantity) + 1);
    } else {
      state.orderCart.push({
        productId: product.id,
        unitPrice: String(product.price),
        quantity: "1",
        discountPercent: "0"
      });
    }
    const searchInput = $("#order-product-search");
    if (searchInput) {
      searchInput.value = "";
      searchInput.setAttribute("aria-expanded", "false");
    }
    const results = $("#order-search-results");
    if (results) results.hidden = true;
    const content = $("#page-content");
    renderSalesOrders(content);
    notify(`Escaneado en Ventas: ${product.name}`);
    const updatedInput = $("#order-product-search");
    if (updatedInput) updatedInput.focus();
    return true;
  } else if (page === "quotes") {
    const tier = Number($("#quote-product-tier")?.value || 1);
    const existing = state.quoteCart.find((item) => item.productId === product.id && item.priceTier === tier);
    if (existing) {
      existing.quantity = String(Number(existing.quantity) + 1);
    } else {
      state.quoteCart.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        priceTier: tier,
        unitPrice: String(product[`price${tier === 1 ? "" : tier}`] ?? product.price),
        quantity: "1",
        discountPercent: "0"
      });
    }
    renderQuoteCart();
    notify(`Escaneado en Presupuestos: ${product.name}`);
    return true;
  }
  return false;
}

let cameraScannerControls = null;
let cameraScannerResetTimer = null;

function updateCameraScannerButtons() {
  $$('[data-action="toggle-camera-scanner"]').forEach((button) => {
    button.textContent = "▣";
    button.title = state.cameraScannerActive
      ? "Mostrar lector con cámara (activo)"
      : "Activar lector con cámara";
    button.setAttribute("aria-label", button.title);
    button.classList.toggle("is-active", state.cameraScannerActive);
  });
}

function showCameraScanner() {
  const dialog = $("#camera-scanner-dialog");
  if (!dialog.open) dialog.showModal();
}

function hideCameraScanner() {
  const dialog = $("#camera-scanner-dialog");
  if (dialog.open) dialog.close();
}

async function startCameraScanner() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("La cámara requiere una conexión HTTPS o localhost. Abrí el sistema con el enlace HTTPS de la PC servidor.");
  }
  if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
    throw new Error("No se pudo cargar el lector de códigos. Recargá la aplicación e intentá nuevamente.");
  }
  const searchInput = {
    sales: $("#sale-product-search"),
    salesOrders: $("#order-product-search"),
    quotes: $("#quote-product-search")
  }[state.page];
  if (!searchInput) {
    throw new Error("Abrí Facturación, Ventas o Presupuestos para escanear productos.");
  }

  const video = $("#camera-scanner-video");
  $("#camera-scanner-status").textContent = "Apuntá la cámara al código de barras.";
  showCameraScanner();
  try {
    const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
    state.cameraScannerActive = true;
    updateCameraScannerButtons();
    const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
      if (!result) return;
      const code = result.getText().trim();
      if (!code) return;
      clearTimeout(cameraScannerResetTimer);
      cameraScannerResetTimer = setTimeout(() => {
        state.lastCameraScanCode = "";
        cameraScannerResetTimer = null;
      }, 1200);
      if (code === state.lastCameraScanCode) return;
      state.lastCameraScanCode = code;
      if (!["sales", "salesOrders", "quotes"].includes(state.page)) return;
      if (!addProductByBarcode(code, state.page)) {
        $("#camera-scanner-status").textContent = `No encontramos "${code}". Probá con otro código o registralo en el producto.`;
      } else {
        $("#camera-scanner-status").textContent = "Producto agregado. La cámara sigue activa.";
      }
    });
    if (!state.cameraScannerActive) {
      controls.stop();
      return;
    }
    cameraScannerControls = controls;
  } catch (error) {
    stopCameraScanner();
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      throw new Error("Permití el acceso a la cámara en el navegador y volvé a activar el lector.");
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      throw new Error("No se encontró una cámara disponible en esta PC.");
    }
    throw new Error(`No se pudo iniciar la cámara: ${error.message}`);
  }
}

function stopCameraScanner() {
  clearTimeout(cameraScannerResetTimer);
  cameraScannerResetTimer = null;
  state.lastCameraScanCode = "";
  if (cameraScannerControls) {
    cameraScannerControls.stop();
    cameraScannerControls = null;
  }
  const video = $("#camera-scanner-video");
  if (video?.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
  const dialog = $("#camera-scanner-dialog");
  if (dialog?.open) dialog.close();
  state.cameraScannerActive = false;
  updateCameraScannerButtons();
}

function startScannerPolling() {
  if (scannerPollTimer) return;
  lastScannerEventId = 0;
  scannerPollTimer = setInterval(async () => {
    if (state.page !== "sales" && state.page !== "salesOrders") {
      stopScannerPolling();
      return;
    }
    try {
      const data = await api(`/api/scanner/events?since=${lastScannerEventId}`);
      if (data && data.events && data.events.length) {
        for (const ev of data.events) {
          lastScannerEventId = Math.max(lastScannerEventId, ev.id);
          addProductByBarcode(ev.barcode, state.page);
        }
      }
    } catch {}
  }, 1000);
}

function stopScannerPolling() {
  if (scannerPollTimer) {
    clearInterval(scannerPollTimer);
    scannerPollTimer = null;
  }
}

async function renderMobileConnect(content) {
  let lanInfo = { address: state.lanAddress || "" };
  try {
    lanInfo = await api("/api/network-info");
    if (lanInfo.address) state.lanAddress = lanInfo.address;
  } catch {}

  const connectUrl = lanInfo.address || location.origin;

  let qrSvg = "";
  try {
    if (typeof qrcode !== "undefined") {
      const qr = qrcode(0, "M");
      qr.addData(connectUrl);
      qr.make();
      qrSvg = qr.createSvgTag({ cellSize: 7, margin: 4 });
    }
  } catch (err) {
    console.error("Error al generar QR:", err);
  }

  content.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="eyebrow">VINCULACIÓN INALÁMBRICA</span>
        <h1>Conexión Móvil</h1>
        <p>Vinculá la aplicación Tonotos Gestión en tu celular y utilizala como lector de código de barras inalámbrico.</p>
      </div>
      <div class="heading-actions">
        <button class="button button-secondary" type="button" data-action="refresh-mobile-connect">Actualizar</button>
      </div>
    </div>

    <div class="mobile-connect-grid">
      <section class="mobile-qr-card">
        <div class="mobile-qr-wrapper" id="mobile-qr-container">
          ${qrSvg || '<div class="empty-state">No se pudo generar el código QR.</div>'}
        </div>
        <div class="mobile-url-box">
          <span class="mobile-url-text" id="mobile-ip-display">${escapeHtml(connectUrl)}</span>
          <button class="button button-secondary button-small" type="button" data-action="copy-mobile-url">Copiar</button>
        </div>
        <div class="mobile-scanner-badge is-live">
          <span class="status-dot"></span> Servidor activo para la app móvil
        </div>
        <div class="mobile-live-status">
          <span style="font-size: 20px;">⚡</span>
          <div style="text-align: left;">
            <strong style="font-size: 12px; color: #166534;">Lector de Barras Sincronizado</strong>
            <p style="margin: 0; font-size: 11px; color: #15803d;">Cualquier producto escaneado desde la app ingresa a Facturación o Ventas.</p>
          </div>
        </div>
      </section>

      <section class="data-card">
        <div class="panel-header">
          <div class="panel-heading">
            <h2>Cómo conectar tu teléfono</h2>
            <p>Seguí estos sencillos pasos para vincular el celular al sistema:</p>
          </div>
        </div>
        <div class="mobile-guide-steps">
          <div class="mobile-step-item">
            <span class="mobile-step-num">1</span>
            <div class="mobile-step-content">
              <strong>Misma red Wi-Fi</strong>
              <p>Conectá tu teléfono a la misma red Wi-Fi a la que está conectada esta computadora.</p>
            </div>
          </div>
          <div class="mobile-step-item">
            <span class="mobile-step-num">2</span>
            <div class="mobile-step-content">
              <strong>Abrir Tonotos Gestión Móvil</strong>
              <p>Iniciá la app en tu teléfono Android. En la pantalla inicial de conexión, seleccioná el botón <strong>"Escanear Código QR de la PC"</strong>.</p>
            </div>
          </div>
          <div class="mobile-step-item">
            <span class="mobile-step-num">3</span>
            <div class="mobile-step-content">
              <strong>Escanear este código</strong>
              <p>Apuntá la cámara de tu celular al código QR que ves a la izquierda. La app configurará la dirección IP automáticamente.</p>
            </div>
          </div>
          <div class="mobile-step-item">
            <span class="mobile-step-num">4</span>
            <div class="mobile-step-content">
              <strong>Función Lector de Barras</strong>
              <p>Desde el menú de la app móvil, ingresá a <strong>"Lector de Barras"</strong>. Al escanear productos con la cámara de tu celular, se agregarán automáticamente a la pantalla de <strong>Facturación</strong> o <strong>Ventas</strong> en esta PC.</p>
            </div>
          </div>
        </div>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line);">
          <h3 style="font-size: 13px; margin: 0 0 8px;">Prueba de lector de barras en vivo</h3>
          <p style="font-size: 11px; color: var(--muted); margin: 0 0 12px;">Podés probar el lector enviando un código de barras simulado para comprobar la recepción.</p>
          <div style="display: flex; gap: 8px;">
            <input id="test-scanner-input" class="field-control" type="text" placeholder="Ej: código de barras o SKU del producto..." style="max-width: 320px;">
            <button class="button button-secondary" type="button" data-action="test-scanner-scan">Probar Escaneo</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

async function renderPage() {
  $("#breadcrumb-current").textContent = pageTitles[state.page];
  const content = $("#page-content");
  if (state.user?.subscriptionExpired) {
    stopScannerPolling();
    renderSubscriptionExpired();
    return;
  }
  content.innerHTML = '<div class="empty-state"><strong>Cargando información…</strong></div>';
  try {
    if (state.page === "dashboard") await renderDashboard(content);
    if (state.page === "products") await renderProducts(content);
    if (state.page === "recipes") await renderRecipes(content);
    if (state.page === "salesOrders") await renderSalesOrders(content);
    if (state.page === "sales") await renderSalesDesk(content);
    if (state.page === "quotes") await renderQuotes(content);
    if (state.page === "dailySales") await renderDailySales(content);
    if (state.page === "purchases") await renderTransactions(content, "purchase");
    if (state.page === "customers") await renderCustomers(content);
    if (state.page === "receiptSettings") await renderReceiptSettings(content);
    if (state.page === "cashRegister") await renderCashRegister(content);
    if (state.page === "accounts") await renderAccounts(content);
    if (state.page === "labels") await renderLabels(content);
    if (state.page === "mobileConnect") await renderMobileConnect(content);
    if (state.page === "branches") await renderBranches(content);

    if (state.page === "sales" || state.page === "salesOrders") {
      startScannerPolling();
    } else {
      stopScannerPolling();
    }
  } catch (error) {
    stopScannerPolling();
    if (state.user?.subscriptionExpired) renderSubscriptionExpired();
    else content.innerHTML = `<div class="data-card empty-state"><strong>No pudimos cargar esta información.</strong><span>${escapeHtml(error.message)}</span><button class="button button-secondary" data-action="retry" type="button">Volver a intentar</button></div>`;
  }
  updateCameraScannerButtons();
}

function pageHeading(title, description, buttonLabel, action, extra = "") {
  return `
    <div class="page-heading">
      <div><span class="eyebrow">GESTIÓN DE TU EMPRESA</span><h1>${title}</h1><p>${description}</p></div>
      <div class="heading-actions">${extra}<button class="button button-primary" type="button" data-action="${action}">${buttonLabel}</button></div>
    </div>`;
}

function scopeNotice() {
  return `
    <section class="scope-note" id="alcance">
      <span class="scope-note-icon" aria-hidden="true">i</span>
      <div><strong>Una base clara para seguir creciendo</strong>
        <p>Registrá ventas con descuentos y pagos combinados, consultá el movimiento diario, armá recetas que descuentan ingredientes del stock y personalizá comprobantes internos imprimibles. No reemplazan una factura fiscal de ARCA/AFIP.</p>
      </div>
    </section>`;
}

async function renderDashboard(content) {
  const data = await api("/api/dashboard");
  state.products = (await api("/api/products")).products;
  const activity = data.activity.length
    ? `<div class="activity-list">${data.activity.map((item) => `
        <div class="activity-row">
          <span class="activity-symbol ${item.kind === "sale" ? "sale" : "purchase"}" aria-hidden="true">${item.kind === "sale" ? "↗" : "↙"}</span>
          <span class="activity-main"><strong>${escapeHtml(item.number)} · ${escapeHtml(item.contact)}</strong><small>${item.kind === "sale" ? `Venta · ${escapeHtml(item.salespersonName || "Sin usuario")}` : "Compra"} · ${formatDate(item.createdAt)}</small></span>
          <span class="activity-amount">${formatMoney(item.total)}</span>
        </div>`).join("")}</div>`
    : '<div class="empty-state"><strong>Todavía no hay movimientos.</strong><span>Cuando registres una venta o compra, aparecerá acá.</span></div>';
  const salesByUser = data.stats.salesByUser?.length
    ? `<div class="sales-user-list">${data.stats.salesByUser.map((entry) => `
        <div class="sales-user-row"><span><strong>${escapeHtml(entry.displayName || "Sin nombre")}</strong><small>${entry.count} venta${entry.count === 1 ? "" : "s"}</small></span><strong>${formatMoney(entry.total)}</strong></div>
      `).join("")}</div>`
    : '<div class="empty-state">Todavía no hay ventas en el mes.</div>';
  const lowStock = data.lowStockProducts.length
    ? `<div class="stock-list">${data.lowStockProducts.map((product) => `
        <div class="stock-row">
          <span class="stock-product"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · Mínimo ${formatQuantity(product.minimumStock)}</small></span>
          <span class="stock-pill">${formatQuantity(product.stock)} disp.</span>
        </div>`).join("")}</div>`
    : '<div class="empty-state"><strong>Stock bajo control.</strong><span>Los productos que necesiten reposición aparecerán acá.</span></div>';

  content.innerHTML = `
    <div class="dashboard-welcome">
      <div class="welcome-copy"><span class="welcome-label">TU NEGOCIO, EN TIEMPO REAL</span>
        <h2>Hola, ${escapeHtml(data.company)} 👋</h2>
        <p>Acá tenés una mirada rápida de cómo marcha tu operación.</p>
      </div>
    </div>
    <section class="stats-grid" aria-label="Indicadores principales">
      <article class="stat-card"><div class="stat-top"><span>Productos activos</span><span class="stat-icon" aria-hidden="true">▦</span></div><div class="stat-value">${data.stats.products}</div><div class="stat-caption">En tu catálogo</div></article>
      <article class="stat-card"><div class="stat-top"><span>Stock para reponer</span><span class="stat-icon" aria-hidden="true">⌁</span></div><div class="stat-value">${data.stats.lowStock}</div><div class="stat-caption ${data.stats.lowStock ? "attention" : ""}">${data.stats.lowStock ? "Revisá estos productos" : "Todo en orden"}</div></article>
      <article class="stat-card"><div class="stat-top"><span>Ventas del mes</span><span class="stat-icon" aria-hidden="true">↗</span></div><div class="stat-value">${formatMoney(data.stats.sales)}</div><div class="stat-caption">Movimientos registrados</div></article>
      <article class="stat-card"><div class="stat-top"><span>Compras del mes</span><span class="stat-icon" aria-hidden="true">↙</span></div><div class="stat-value">${formatMoney(data.stats.purchases)}</div><div class="stat-caption">Movimientos registrados</div></article>
    </section>
    <section class="dashboard-grid">
      <article class="panel">
        <header class="panel-header"><div class="panel-heading"><h2>Actividad reciente</h2><p>Últimas operaciones registradas</p></div><button class="text-link" data-action="view-sales" type="button">Ver ventas →</button></header>
        ${activity}
      </article>
      <article class="panel">
        <header class="panel-header"><div class="panel-heading"><h2>Atención al stock</h2><p>Productos en su mínimo o por debajo</p></div><button class="text-link" data-page="products" type="button">Ver todos →</button></header>
        ${lowStock}
      </article>
      <article class="panel">
        <header class="panel-header"><div class="panel-heading"><h2>Ventas por usuario</h2><p>Detalle del total vendido este mes</p></div></header>
        ${salesByUser}
      </article>
    </section>
    ${scopeNotice()}`;
}

async function renderProducts(content) {
  const [productData, recipeData] = await Promise.all([api("/api/products"), api("/api/recipes")]);
  state.products = productData.products;
  state.recipes = recipeData.recipes;
  content.innerHTML = `
    ${pageHeading("Productos y stock", "El catálogo y las existencias actuales de tu negocio.", "Nuevo producto", "new-product",
      '<button class="button button-secondary" type="button" data-page="recipes">Ver recetas</button><div class="product-search-controls"><select class="filter-control product-search-mode" id="product-search-mode" aria-label="Buscar por"><option value="product">Producto</option><option value="category">Categoría</option><option value="recipe">Receta</option></select><input class="search-control" id="product-search" type="search" placeholder="Buscar producto" aria-label="Buscar producto"></div>')}
    <section class="data-card stock-import-tools">
      <div class="panel-header"><div class="panel-heading"><h2>Importar y exportar stock</h2><p>CSV UTF-8 o Excel (.xlsx); también reconoce encabezados CODIGO, PRODUCTO, PREC.COMPRA, PRECIO, COD.BARRAS y STOCK.</p></div>
        <div class="heading-actions"><a class="button button-secondary" href="/api/stock.csv">Exportar CSV</a><button class="button button-primary" type="button" data-action="choose-stock-file">Importar archivo</button><input id="stock-import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div>
      </div>
      <p class="field-help">Actualiza stock de productos existentes; las filas nuevas requieren código (o ID), producto y precio. Usa ID si falta CODIGO, limpia códigos de barras entre comillas y omite filas exactamente duplicadas. Reemplaza las cantidades indicadas (admite stock negativo).</p>
    </section>
    <section class="data-card">
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>COSTO</th><th>PRECIO DE VENTA</th><th>DISPONIBLE</th><th>STOCK MÍNIMO</th><th></th></tr></thead>
        <tbody id="product-rows">${productRows(state.products)}</tbody>
      </table></div>
    </section>
    <div class="scope-note"><span class="scope-note-icon" aria-hidden="true">i</span><div><strong>El stock se actualiza con tus operaciones</strong><p>Las ventas descuentan unidades disponibles y las compras las suman automáticamente. Si vendés más de lo disponible, el stock queda negativo y se regulariza con futuras compras.</p></div></div>`;
}

function recipeIngredientOptions(selectedId = "", productId = "") {
  const recipeProducts = new Set(state.recipes.map((recipe) => recipe.productId));
  const choices = state.products.filter((product) =>
    product.active && product.id !== Number(productId) && !recipeProducts.has(product.id)
  );
  return `<option value="">Elegí un ingrediente</option>${choices.map((product) =>
    `<option value="${product.id}" ${String(product.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(product.name)} · ${escapeHtml(product.sku)}</option>`
  ).join("")}`;
}

function recipeComponentLine(index, component = {}, productId = "") {
  return `<div class="item-line recipe-component-line">
    <div class="field"><label for="recipe-ingredient-${index}">Ingrediente ${index + 1}</label>
      <select class="field-control recipe-ingredient" id="recipe-ingredient-${index}" required>${recipeIngredientOptions(component.productId || "", productId)}</select></div>
    <div class="field"><label for="recipe-quantity-${index}">Cantidad por unidad</label>
      <input class="field-control recipe-quantity" id="recipe-quantity-${index}" type="number" min="0.001" step="0.001" value="${escapeHtml(component.quantity ?? "1")}" required></div>
    <button class="remove-line" type="button" data-action="remove-recipe-component" aria-label="Quitar ingrediente">×</button>
  </div>`;
}

async function renderRecipes(content) {
  const [productData, recipeData] = await Promise.all([api("/api/products"), api("/api/recipes")]);
  state.products = productData.products;
  state.recipes = recipeData.recipes;
  const rows = state.recipes.length
    ? state.recipes.map((recipe) => `<tr>
        <td><span class="table-primary"><strong>${escapeHtml(recipe.productName)}</strong><small>${escapeHtml(recipe.productSku)}</small></span></td>
        <td>${recipe.components.map((component) => `${formatQuantity(component.quantity)} × ${escapeHtml(component.name)}`).join("<br>")}</td>
        <td><span class="table-actions"><button class="table-action table-action-edit" type="button" data-action="edit-recipe" data-id="${recipe.id}">Editar</button><button class="table-action" type="button" data-action="delete-recipe" data-id="${recipe.id}">Borrar</button></span></td>
      </tr>`).join("")
    : '<tr><td colspan="3"><div class="empty-state"><strong>Todavía no hay recetas.</strong><span>Definí los ingredientes que se descuentan al vender un producto elaborado.</span></div></td></tr>';
  content.innerHTML = `
    ${pageHeading("Recetas", "Combiná artículos del catálogo y descontá sus ingredientes al vender el producto elaborado.", "Nueva receta", "new-recipe",
      '<button class="button button-secondary" type="button" data-page="products">Volver a stock</button>')}
    <section class="data-card"><div class="table-scroll"><table class="data-table">
      <thead><tr><th>PRODUCTO ELABORADO</th><th>INGREDIENTES POR UNIDAD VENDIDA</th><th>ACCIONES</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></section>
    <div class="scope-note"><span class="scope-note-icon" aria-hidden="true">i</span><div><strong>El producto elaborado no usa stock propio</strong><p>Al venderlo, se descuenta cada ingrediente según la cantidad definida, incluso si un ingrediente queda con stock negativo. Las recetas guardan los movimientos de inventario para poder revertir correctamente una venta borrada.</p></div></div>`;
}

function localBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function renderQuotes(content) {
  const [productData, data] = await Promise.all([api("/api/products"), api("/api/quotes")]);
  state.products = productData.products;
  state.quotes = data.quotes;
  const rows = state.quotes.length
    ? state.quotes.map((quote) => `<tr>
        <td><span class="table-primary"><strong>${escapeHtml(quote.number)}</strong><small>Válido hasta ${escapeHtml(quote.validUntil)}</small></span></td>
        <td>${escapeHtml(quote.contact)}</td><td>${escapeHtml(quote.createdBy || "—")}</td><td>${quote.items.length}</td><td>${formatDate(quote.createdAt)}</td>
        <td>${formatMoney(quote.total)}</td><td><span class="status-pill status-${quote.status}">${quote.status === "open" ? "Abierto" : quote.status === "converted" ? "Convertido" : "Cancelado"}</span></td>
        <td><span class="table-actions"><button class="table-action table-action-edit" type="button" data-action="print-quote" data-id="${quote.id}">Imprimir</button>
          ${quote.status === "open" && state.user?.role !== "seller" ? `<button class="table-action table-action-edit" type="button" data-action="convert-quote" data-id="${quote.id}">Convertir en venta</button>` : ""}
          ${quote.status === "open" ? `<button class="table-action" type="button" data-action="cancel-quote" data-id="${quote.id}">Cancelar</button>` : ""}
        </span></td></tr>`).join("")
    : '<tr><td colspan="8"><div class="empty-state"><strong>Todavía no hay presupuestos.</strong><span>Creá uno para enviarlo al cliente; no modificará el stock.</span></div></td></tr>';
  content.innerHTML = `
    <div class="page-heading">
      <div><span class="eyebrow">GESTIÓN DE TU EMPRESA</span><h1>Presupuestos</h1><p>Prepará propuestas, ajustá precios y compartilas con tus clientes sin modificar el stock.</p></div>
      <span class="sales-counter"><span class="today-dot"></span> Presupuesto · sin movimiento de stock</span>
    </div>
    <section class="sales-workspace quote-workspace">
      <div class="sales-left-column">
        <article class="panel sales-composer">
          <header class="panel-header"><div class="panel-heading"><h2>Datos de la propuesta</h2><p>Completá los datos del cliente y agregá productos al presupuesto.</p></div></header>
          <div class="sale-customer-field field"><label for="quote-contact">Razón social / cliente *</label><input class="field-control" id="quote-contact" maxlength="120" value="Consumidor final" required></div>
          <div class="sale-customer-field field"><label for="quote-valid-until">Válido hasta *</label><input class="field-control" id="quote-valid-until" type="date" value="${quoteValidityDate()}" required></div>
          <details class="customer-extra sale-customer-field">
            <summary>Datos adicionales del cliente</summary>
            <div class="field-grid">
              <div class="field"><label for="quote-tax-id">CUIT / identificación</label><input class="field-control" id="quote-tax-id" maxlength="32"></div>
              <div class="field"><label for="quote-vat">Condición frente al IVA</label><input class="field-control" id="quote-vat" maxlength="80" value="Consumidor final"></div>
              <div class="field"><label for="quote-phone">Teléfono</label><input class="field-control" id="quote-phone" type="tel" maxlength="40"></div>
              <div class="field"><label for="quote-email">Correo</label><input class="field-control" id="quote-email" type="email" maxlength="254"></div>
              <div class="field field-full"><label for="quote-address">Domicilio</label><input class="field-control" id="quote-address" maxlength="200"></div>
            </div>
          </details>
          <div class="sale-product-picker">
            <label class="sale-search-label" for="quote-product-search">Producto del catálogo</label>
            <div class="sale-search-wrap">
              <span class="sale-search-icon" aria-hidden="true">⌕</span>
              <input class="field-control sale-search-input" id="quote-product-search" type="search" placeholder="Escribí el nombre o código..." autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="quote-search-results" aria-expanded="false">
              <button class="camera-scan-button" type="button" data-action="toggle-camera-scanner" aria-label="Activar lector con cámara" title="Activar lector con cámara">▣</button>
              <div class="sale-search-results" id="quote-search-results" role="listbox" hidden></div>
            </div>
            <div class="sale-selected-product" id="quote-selected-product"><span>Buscá y elegí un producto para agregarlo al presupuesto.</span></div>
            <div class="sale-item-controls">
              <div class="field"><label for="quote-product-tier">Nivel de precio</label><select class="field-control" id="quote-product-tier"><option value="1">Precio 1</option><option value="2">Precio 2</option><option value="3">Precio 3</option></select></div>
              <div class="field"><label for="quote-product-quantity">Cantidad</label><input class="field-control" id="quote-product-quantity" type="number" min="1" step="1" value="1"></div>
              <div class="field"><label for="quote-product-discount">Descuento (%)</label><input class="field-control" id="quote-product-discount" type="number" min="0" max="100" step="0.01" value="0"></div>
              <button class="button button-primary sale-add-button" id="quote-add-product" type="button" data-action="add-quote-product" disabled>Agregar al presupuesto <span aria-hidden="true">＋</span></button>
            </div>
          </div>
          <details class="custom-sale-item">
            <summary>Agregar un artículo que no está en stock</summary>
            <div class="sale-item-controls">
              <div class="field"><label for="quote-custom-name">Descripción</label><input class="field-control" id="quote-custom-name" maxlength="120"></div>
              <div class="field"><label for="quote-custom-price">Precio unitario</label><input class="field-control" id="quote-custom-price" type="number" min="0" step="0.01" value="0.00"></div>
              <div class="field"><label for="quote-custom-quantity">Cantidad</label><input class="field-control" id="quote-custom-quantity" type="number" min="1" step="1" value="1"></div>
              <div class="field"><label for="quote-custom-discount">Descuento (%)</label><input class="field-control" id="quote-custom-discount" type="number" min="0" max="100" step="0.01" value="0"></div>
              <button class="button button-secondary sale-add-button" type="button" data-action="add-custom-quote-item">Agregar artículo libre</button>
            </div>
            <p class="field-help">Se incluye en el presupuesto, pero no modifica el catálogo ni el inventario.</p>
          </details>
        </article>
        <article class="panel cart-panel">
          <header class="panel-header"><div class="panel-heading"><h2>Artículos del presupuesto</h2><p><span id="quote-item-count">0</span> productos · Los precios se pueden ajustar por renglón.</p></div></header>
          <div class="table-scroll"><table class="data-table sales-cart-table"><thead><tr><th>PRODUCTO</th><th>PRECIO UNIT.</th><th>CANTIDAD</th><th>DESC. %</th><th>SUBTOTAL</th><th></th></tr></thead><tbody id="quote-cart"></tbody></table></div>
        </article>
      </div>
      <aside class="panel sale-summary">
        <div class="sale-summary-header"><span class="summary-icon" aria-hidden="true">▧</span><span><strong>Resumen del presupuesto</strong><small>Los presupuestos no reservan stock</small></span></div>
        <div class="summary-row"><span>Subtotal</span><strong id="quote-subtotal">${formatMoney(0)}</strong></div>
        <div class="summary-row"><span>Desc. por artículo</span><strong class="summary-discount" id="quote-item-discount">− ${formatMoney(0)}</strong></div>
        <label class="summary-discount-control" for="quote-general-discount"><span>Descuento general (%)</span><input class="field-control" id="quote-general-discount" type="number" min="0" max="100" step="0.01" value="0"></label>
        <div class="summary-grand-total"><span>Total del presupuesto</span><strong id="quote-total">${formatMoney(0)}</strong></div>
        <button class="button button-primary complete-sale-button" type="button" data-action="save-quote">Guardar presupuesto <span aria-hidden="true">→</span></button>
        <p class="summary-customer">Cliente: <strong id="quote-summary-customer">Consumidor final</strong></p>
      </aside>
    </section>
    <section class="data-card quote-history"><div class="panel-header"><div class="panel-heading"><h2>Presupuestos recientes</h2><p>Últimos ${Math.min(state.quotes.length, 200)} registros · no reservan stock</p></div></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>CREÓ</th><th>ARTÍCULOS</th><th>FECHA</th><th>TOTAL</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    <div class="scope-note"><span class="scope-note-icon" aria-hidden="true">i</span><div><strong>El presupuesto no es un comprobante fiscal</strong><p>Los precios se guardan como una instantánea. El stock solo cambia cuando lo convertís en venta; cada presupuesto se puede convertir una sola vez.</p></div></div>`;
  state.quoteCart = [];
  state.selectedQuoteProductId = null;
  renderQuoteCart();
}

function quoteProductOptions(selected = "") {
  return `<option value="">Elegí un producto</option>${state.products.filter((product) => product.active).map((product) =>
    `<option value="${product.id}" ${String(product.id) === String(selected) ? "selected" : ""}>${escapeHtml(product.name)} · ${escapeHtml(product.sku)}</option>`
  ).join("")}<option value="custom" ${selected === "custom" ? "selected" : ""}>Artículo manual</option>`;
}

function quoteEditorLine(index, item = {}) {
  const selected = item.custom ? "custom" : item.productId || "";
  return `<div class="quote-editor-line" data-line="${index}">
    <div class="field"><label for="quote-product-${index}">Artículo</label><select class="field-control quote-product" id="quote-product-${index}" required>${quoteProductOptions(selected)}</select></div>
    <div class="field quote-custom-field" ${item.custom ? "" : "hidden"}><label for="quote-name-${index}">Descripción</label><input class="field-control quote-name" id="quote-name-${index}" maxlength="120" value="${escapeHtml(item.name || "")}" ${item.custom ? "required" : "disabled"}></div>
    <div class="field quote-tier-field" ${item.custom ? "hidden" : ""}><label for="quote-tier-${index}">Precio</label><select class="field-control quote-tier" id="quote-tier-${index}" ${item.custom ? "disabled" : ""}>${[1, 2, 3].map((tier) => `<option value="${tier}" ${Number(item.priceTier || 1) === tier ? "selected" : ""}>Precio ${tier}</option>`).join("")}</select></div>
    <div class="field"><label for="quote-price-${index}">Precio unitario</label><input class="field-control quote-price" id="quote-price-${index}" type="number" min="0" step="0.01" value="${escapeHtml(item.unitPrice || "0.00")}" required></div>
    <div class="field"><label for="quote-quantity-${index}">Cantidad</label><input class="field-control quote-quantity" id="quote-quantity-${index}" type="number" min="1" step="1" value="${escapeHtml(item.quantity || "1")}" required></div>
    <div class="field"><label for="quote-discount-${index}">Desc. %</label><input class="field-control quote-discount" id="quote-discount-${index}" type="number" min="0" max="100" step="0.01" value="${escapeHtml(item.discountPercent || "0")}" required></div>
    <button class="remove-line remove-quote-line" type="button" data-action="remove-quote-line" aria-label="Quitar artículo">×</button>
  </div>`;
}

function quoteValidityDate() {
  const [year, month, day] = localBusinessDate().split("-").map(Number);
  const date = new Date(year, month - 1, day + 15);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function updateQuotePreview() {
  const subtotalCents = state.quoteCart.reduce((sum, item) => {
    const gross = Math.round(Math.round(Number(item.quantity) * 1000) * (amountToCents(item.unitPrice) || 0) / 1000);
    return sum + gross;
  }, 0);
  const itemDiscountCents = state.quoteCart.reduce((sum, item) => {
    const gross = Math.round(Math.round(Number(item.quantity) * 1000) * (amountToCents(item.unitPrice) || 0) / 1000);
    return sum + Math.round(gross * (Number(item.discountPercent) || 0) / 100);
  }, 0);
  const preGeneralCents = subtotalCents - itemDiscountCents;
  const totalCents = preGeneralCents - Math.round(preGeneralCents * (Number($("#quote-general-discount")?.value) || 0) / 100);
  const subtotal = $("#quote-subtotal");
  if (!subtotal) return;
  subtotal.textContent = formatMoney(subtotalCents / 100);
  $("#quote-item-discount").textContent = `− ${formatMoney(itemDiscountCents / 100)}`;
  $("#quote-total").textContent = formatMoney(totalCents / 100);
  $("#quote-item-count").textContent = String(state.quoteCart.length);
  $("#quote-summary-customer").textContent = $("#quote-contact")?.value.trim() || "Consumidor final";
  state.quoteCart.forEach((item, index) => {
    const rowTotal = $("#quote-cart")?.querySelectorAll(".cart-line-total")[index];
    if (!rowTotal) return;
    const gross = Math.round(Math.round(Number(item.quantity) * 1000) * (amountToCents(item.unitPrice) || 0) / 1000);
    rowTotal.textContent = formatMoney((gross - Math.round(gross * (Number(item.discountPercent) || 0) / 100)) / 100);
  });
}

function renderQuoteCart() {
  const cart = $("#quote-cart");
  if (!cart) return;
  cart.innerHTML = state.quoteCart.length
    ? state.quoteCart.map((item, index) => {
      const gross = Math.round(Math.round(Number(item.quantity) * 1000) * (amountToCents(item.unitPrice) || 0) / 1000);
      const lineTotal = gross - Math.round(gross * Number(item.discountPercent) / 100);
      return `<tr>
        <td><span class="table-primary"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku || "Artículo libre · sin stock")}</small></span></td>
        <td><input class="field-control quote-cart-price" type="number" min="0" step="0.01" value="${escapeHtml(item.unitPrice)}" data-index="${index}" aria-label="Precio de ${escapeHtml(item.name)}" required></td>
        <td><input class="cart-quantity quote-cart-quantity" type="number" min="1" step="1" value="${escapeHtml(item.quantity)}" data-index="${index}" aria-label="Cantidad de ${escapeHtml(item.name)}" required></td>
        <td><input class="cart-discount quote-cart-discount" type="number" min="0" max="100" step="0.01" value="${escapeHtml(item.discountPercent)}" data-index="${index}" aria-label="Descuento de ${escapeHtml(item.name)}" required></td>
        <td class="cart-line-total">${formatMoney(lineTotal / 100)}</td>
        <td><button class="cart-remove" type="button" data-action="remove-quote-product" data-index="${index}" aria-label="Quitar ${escapeHtml(item.name)}">×</button></td>
      </tr>`;
    }).join("")
    : '<tr><td class="cart-empty-cell" colspan="6"><div class="empty-state"><strong>El presupuesto está vacío.</strong><span>Elegí productos o agregá un artículo libre para empezar.</span></div></td></tr>';
  updateQuotePreview();
}

async function renderDailySales(content) {
  const date = state.dailySalesDate || localBusinessDate();
  state.dailySalesDate = date;
  const data = await api(`/api/sales/daily?date=${encodeURIComponent(date)}`);
  state.salesHistory = data.transactions;
  const methods = data.paymentTotals.length
    ? data.paymentTotals.map((payment) => `<div class="summary-row"><span>${escapeHtml(paymentMethods[payment.method] || payment.method)}</span><strong>${formatMoney(payment.amount)}</strong></div>`).join("")
    : '<div class="empty-state daily-empty-methods">No hay pagos registrados para esta fecha.</div>';
  const rows = data.transactions.length
    ? data.transactions.map((sale) => `<tr>
        <td>${escapeHtml(sale.number)}</td><td>${escapeHtml(sale.contact)}</td>
        <td>${escapeHtml(sale.salespersonName || "—")}</td>
        <td>${formatDate(sale.createdAt, { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${formatMoney(sale.total)}</td><td><span class="table-actions">
          <button class="table-action table-action-edit" type="button" data-action="print-sale" data-id="${sale.id}">Comprobante</button>
          ${["admin", "manager"].includes(state.user?.role) ? `<button class="table-action" type="button" data-action="delete-sale" data-id="${sale.id}">Borrar</button>` : ""}
        </span></td></tr>`).join("")
    : '<tr><td colspan="6"><div class="empty-state"><strong>No hay ventas en esta fecha.</strong><span>Elegí otro día o registrá una venta para verla acá.</span></div></td></tr>';
  const dailyUsers = data.salesByUser?.length
    ? data.salesByUser.map((entry) => `<div class="sales-user-row"><span><strong>${escapeHtml(entry.displayName || "Sin nombre")}</strong><small>${entry.count} venta${entry.count === 1 ? "" : "s"}</small></span><strong>${formatMoney(entry.total)}</strong></div>`).join("")
    : '<div class="empty-state">No hay ventas asignadas a usuarios.</div>';
  content.innerHTML = `
    <div class="page-heading">
      <div><span class="eyebrow">CONTROL DE CAJA</span><h1>Registro diario de ventas</h1><p>Consultá las operaciones y los medios de pago de un día.</p></div>
      <label class="daily-date-field" for="daily-sales-date">Fecha<input class="field-control" id="daily-sales-date" type="date" value="${escapeHtml(date)}"></label>
    </div>
    <section class="stats-grid daily-sales-stats" aria-label="Resumen del día">
      <article class="stat-card"><div class="stat-top"><span>Ventas del día</span><span class="stat-icon" aria-hidden="true">▤</span></div><div class="stat-value">${data.count}</div><div class="stat-caption">${escapeHtml(formatDate(`${date} 12:00:00`))}</div></article>
      <article class="stat-card"><div class="stat-top"><span>Total vendido</span><span class="stat-icon" aria-hidden="true">↗</span></div><div class="stat-value">${formatMoney(data.total)}</div><div class="stat-caption">Importe cobrado en ventas</div></article>
      <article class="stat-card"><div class="stat-top"><span>Promedio por venta</span><span class="stat-icon" aria-hidden="true">◌</span></div><div class="stat-value">${formatMoney(data.count ? data.total / data.count : 0)}</div><div class="stat-caption">Promedio del día</div></article>
      <article class="stat-card"><div class="stat-top"><span>Medios de pago</span><span class="stat-icon" aria-hidden="true">▦</span></div>${methods}</article>
    </section>
    <section class="data-card sales-by-user-card"><div class="panel-header"><div class="panel-heading"><h2>Ventas por usuario</h2><p>Desglose de las ventas del día seleccionado.</p></div></div>${dailyUsers}</section>
    <section class="data-card"><div class="table-scroll"><table class="data-table">
      <thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>VENDEDOR/A</th><th>HORA</th><th>TOTAL</th><th>ACCIONES</th></tr></thead><tbody>${rows}</tbody>
    </table></div></section>`;
}

async function renderReceiptSettings(content) {
  const data = await api("/api/receipt-settings");
  const settings = data.settings;
  state.receiptLogoDataUri = settings.logo_data_uri || "";
  content.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">PERSONALIZACIÓN</span><h1>Datos del comprobante</h1><p>Estos datos se imprimirán en los comprobantes internos de venta.</p></div></div>
    <form id="receipt-settings-form" class="data-card receipt-settings-form">
      <div class="field-grid">
        <div class="field"><label for="receipt-business-name">Nombre comercial *</label><input class="field-control" id="receipt-business-name" name="businessName" maxlength="120" value="${escapeHtml(settings.business_name)}" required></div>
        <div class="field"><label for="receipt-legal-name">Razón social</label><input class="field-control" id="receipt-legal-name" name="legalName" maxlength="120" value="${escapeHtml(settings.legal_name)}"></div>
        <div class="field field-full"><label for="receipt-address">Domicilio comercial</label><input class="field-control" id="receipt-address" name="address" maxlength="200" value="${escapeHtml(settings.address)}"></div>
        <div class="field"><label for="receipt-tax-id">CUIT</label><input class="field-control" id="receipt-tax-id" name="taxId" maxlength="32" value="${escapeHtml(settings.tax_id)}"></div>
        <div class="field"><label for="receipt-gross-income">Ingresos brutos</label><input class="field-control" id="receipt-gross-income" name="grossIncome" maxlength="80" value="${escapeHtml(settings.gross_income)}"></div>
        <div class="field"><label for="receipt-vat-condition">Condición frente al IVA</label><input class="field-control" id="receipt-vat-condition" name="vatCondition" maxlength="80" value="${escapeHtml(settings.vat_condition)}"></div>
        <div class="field"><label for="receipt-email">Correo electrónico</label><input class="field-control" id="receipt-email" name="email" type="email" maxlength="254" value="${escapeHtml(settings.email)}"></div>
        <div class="field"><label for="receipt-phone">Teléfono</label><input class="field-control" id="receipt-phone" name="phone" type="tel" maxlength="40" value="${escapeHtml(settings.phone)}"></div>
        <div class="field"><label for="receipt-activity-start">Inicio de actividades</label><input class="field-control" id="receipt-activity-start" name="activityStart" maxlength="40" value="${escapeHtml(settings.activity_start)}"></div>
        <div class="field"><label for="receipt-point-of-sale">Punto de venta</label><input class="field-control" id="receipt-point-of-sale" name="pointOfSale" inputmode="numeric" maxlength="5" value="${escapeHtml(settings.point_of_sale)}" required></div>
        <div class="field"><label for="receipt-title">Título</label><input class="field-control" id="receipt-title" name="receiptTitle" maxlength="40" value="${escapeHtml(settings.receipt_title)}" required></div>
        <div class="field"><label for="receipt-format">Formato de comprobante</label><select class="field-control" id="receipt-format" name="receiptFormat"><option value="a4" ${settings.receipt_format === "ticket" ? "" : "selected"}>A4</option><option value="ticket" ${settings.receipt_format === "ticket" ? "selected" : ""}>Ticket de 80 mm</option></select><span class="field-help">Los presupuestos se mantienen siempre en A4.</span></div>
        <div class="field"><label for="receipt-logo">Logo personalizado (PNG, JPG o WebP)</label><input class="field-control" id="receipt-logo" type="file" accept="image/png,image/jpeg,image/webp"><span class="field-help">Imagen de hasta 128 KB. Si la quitás, el comprobante no imprime logo.</span></div>
        <div class="field field-full logo-preview-wrap"><img id="receipt-logo-preview" class="receipt-logo-preview" src="${escapeHtml(state.receiptLogoDataUri)}" alt="Vista previa del logo personalizado" ${state.receiptLogoDataUri ? "" : "hidden"}><button class="button button-secondary" type="button" data-action="clear-receipt-logo">Quitar logo personalizado</button></div>
      </div>
      <p class="scope-note"><span class="scope-note-icon" aria-hidden="true">i</span><span>El diseño incluye un aviso permanente: es un comprobante interno y no reemplaza una factura ni un comprobante fiscal de ARCA/AFIP.</span></p>
      <p class="form-error" id="receipt-settings-error" role="alert"></p>
      <div class="receipt-settings-actions"><button class="button button-primary" type="submit">Guardar datos</button></div>
    </form>`;
}

async function renderCashRegister(content) {
  const data = await api("/api/cash-register");
  const session = data.session;
  const methodRows = Object.entries(data.byMethod || {}).map(([method, total]) =>
    `<div class="summary-row"><span>${escapeHtml(paymentMethods[method] || method)}</span><strong>${formatMoney(total)}</strong></div>`).join("");
  const movements = (data.movements || []).map((movement) => `<tr><td>${formatDate(movement.createdAt)}</td><td>${escapeHtml(movement.kind === "in" ? "Ingreso" : "Egreso")}</td><td>${escapeHtml(movement.description)}</td><td>${escapeHtml(paymentMethods[movement.method] || movement.method)}</td><td>${formatMoney(movement.amount)}</td></tr>`).join("");
  const history = (data.history || []).map((entry) => `<tr><td>${formatDate(entry.closedAt)}</td><td>${escapeHtml(entry.openedBy)}</td><td>${escapeHtml(entry.closedBy)}</td><td>${formatMoney(entry.openingAmount)}</td><td>${formatMoney(entry.expectedCash)}</td><td>${formatMoney(entry.closingAmount)}</td><td>${formatMoney(entry.difference)}</td><td>${escapeHtml(entry.closingNote || "—")}</td></tr>`).join("");
  content.innerHTML = `<div class="page-heading"><div><span class="eyebrow">CONTROL DE EFECTIVO</span><h1>Caja</h1><p>Apertura, arqueo, movimientos y diferencias del turno.</p></div></div>
    <section class="data-card cash-register-card"><div class="panel-header"><div class="panel-heading"><h2>${session ? "Turno abierto" : "Caja cerrada"}</h2><p>${session ? `Abierta por ${escapeHtml(session.openedBy)} · ${formatDate(session.openedAt)}` : "Iniciá un turno con el efectivo disponible."}</p></div><strong class="cash-expected">${session ? formatMoney(session.expectedCash) : formatMoney(0)}</strong></div>
      ${session ? `<div class="field-grid cash-register-controls"><div class="field"><label for="cash-closing-amount">Efectivo contado</label><input class="field-control" id="cash-closing-amount" type="number" min="0" step="0.01" value="${session.expectedCash.toFixed(2)}"></div><div class="field"><label for="cash-close-note">Nota de cierre</label><input class="field-control" id="cash-close-note" maxlength="200" placeholder="Observaciones del arqueo"></div><button class="button button-primary" type="button" data-action="close-cash">Cerrar turno</button></div>
      <div class="cash-method-summary"><div class="summary-row"><span>Efectivo inicial</span><strong>${formatMoney(session.openingAmount)}</strong></div>${methodRows}<div class="summary-row"><span>Esperado en efectivo</span><strong>${formatMoney(session.expectedCash)}</strong></div><div class="summary-row"><span>Diferencia contada</span><strong id="cash-difference">${formatMoney(0)}</strong></div></div>
      <form class="cash-movement-form" id="cash-movement-form"><label class="field"><span>Movimiento</span><select class="field-control" name="kind"><option value="in">Ingreso</option><option value="out">Egreso</option></select></label><label class="field"><span>Medio</span><select class="field-control" name="method">${Object.entries(paymentMethods).map(([method, name]) => `<option value="${method}">${escapeHtml(name)}</option>`).join("")}</select></label><label class="field"><span>Importe</span><input class="field-control" name="amount" type="number" min="0.01" step="0.01" required></label><label class="field"><span>Descripción</span><input class="field-control" name="description" maxlength="120" required></label><button class="button button-secondary" type="submit">Registrar movimiento</button></form>`
      : `<form class="cash-register-controls" id="cash-open-form"><label class="field"><span>Efectivo inicial</span><input class="field-control" name="openingAmount" type="number" min="0" step="0.01" value="0.00" required></label><label class="field"><span>Nota de apertura</span><input class="field-control" name="note" maxlength="200" placeholder="Fondo inicial"></label><button class="button button-primary" type="submit">Abrir caja</button></form>`}</section>
      <section class="data-card"><div class="panel-header"><div class="panel-heading"><h2>Movimientos del turno</h2><p>Ingresos y egresos manuales registrados.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>FECHA</th><th>TIPO</th><th>DESCRIPCIÓN</th><th>MEDIO</th><th>IMPORTE</th></tr></thead><tbody>${movements || '<tr><td colspan="5"><div class="empty-state">Sin movimientos de caja registrados.</div></td></tr>'}</tbody></table></div></section>
      <section class="data-card"><div class="panel-header"><div class="panel-heading"><h2>Cierres anteriores</h2><p>Últimos 20 arqueos, con diferencia entre efectivo esperado y contado.</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>CIERRE</th><th>ABRIÓ</th><th>CERRÓ</th><th>INICIAL</th><th>ESPERADO</th><th>CONTADO</th><th>DIFERENCIA</th><th>NOTA</th></tr></thead><tbody>${history || '<tr><td colspan="8"><div class="empty-state">Todavía no hay cierres anteriores.</div></td></tr>'}</tbody></table></div></section>`;
  const closingAmount = $("#cash-closing-amount");
  if (closingAmount) closingAmount.addEventListener("input", () => {
    $("#cash-difference").textContent = formatMoney((Number(closingAmount.value) - session.expectedCash) || 0);
  });
}

async function renderAccounts(content) {
  const data = await api("/api/accounts");
  state.accounts = data.accounts;
  const canCollect = state.user?.role !== "seller";
  const rows = state.accounts.length ? state.accounts.map((account) => `<tr><td>${escapeHtml(account.customerName)}</td><td>${escapeHtml(account.number)}</td><td>${formatDate(account.createdAt)}</td><td>${formatMoney(account.total)}</td><td>${formatMoney(account.paid)}</td><td><strong>${formatMoney(account.balance)}</strong></td>${canCollect ? `<td><div class="account-collect-controls"><input class="field-control account-payment-amount" type="number" min="0.01" max="${account.balance}" step="0.01" placeholder="Importe" aria-label="Importe para ${escapeHtml(account.customerName)}"><select class="field-control account-payment-method" aria-label="Medio de pago">${Object.entries(paymentMethods).map(([method, name]) => `<option value="${method}">${escapeHtml(name)}</option>`).join("")}</select><button class="table-action table-action-edit" type="button" data-action="collect-account" data-id="${account.transactionId}">Cobrar</button></div></td>` : ""}</tr>`).join("") : `<tr><td colspan="${canCollect ? 7 : 6}"><div class="empty-state">No hay saldos pendientes de cobro.</div></td></tr>`;
  const total = state.accounts.reduce((sum, account) => sum + account.balance, 0);
  content.innerHTML = `<div class="page-heading"><div><span class="eyebrow">SALDOS PENDIENTES</span><h1>Cuenta corriente</h1><p>Consultá señas, fiados y cobros parciales de clientes.</p></div><strong class="cash-expected">${formatMoney(total)}</strong></div><section class="data-card"><div class="table-scroll"><table class="data-table"><thead><tr><th>CLIENTE</th><th>VENTA</th><th>FECHA</th><th>TOTAL</th><th>ABONADO</th><th>SALDO</th>${canCollect ? "<th>REGISTRAR COBRO</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

async function renderLabels(content) {
  const data = await api("/api/products");
  state.products = data.products;
  const activeProducts = state.products.filter((product) => product.active);
  if (!state.labelsTouched) {
    state.labelSelection = activeProducts.map((p) => ({ productId: p.id, count: 1 }));
    state.labelsTouched = true;
  }
  const allSelected = activeProducts.length > 0 && activeProducts.every((p) =>
    state.labelSelection.some((e) => e.productId === p.id)
  );
  const rows = activeProducts.map((product) => {
    const entry = state.labelSelection.find((e) => e.productId === product.id);
    const count = entry?.count || 1;
    const checked = Boolean(entry);
    return `<tr data-label-search="${escapeHtml(normalizeProductSearch(`${product.name} ${product.sku} ${product.barcode || ""}`))}">
      <td><input class="label-select" type="checkbox" data-id="${product.id}" aria-label="Seleccionar ${escapeHtml(product.name)}" ${checked ? "checked" : ""}></td>
      <td>${escapeHtml(product.name)}</td>
      <td>${escapeHtml(product.sku)}</td>
      <td>${formatMoney(product.price)}</td>
      <td><input class="field-control label-count" type="number" min="1" max="500" value="${count}" data-id="${product.id}" aria-label="Cantidad de etiquetas para ${escapeHtml(product.name)}" ${checked ? "" : "disabled"}></td>
    </tr>`;
  }).join("");
  content.innerHTML = `<div class="page-heading">
    <div>
      <span class="eyebrow">IMPRESIÓN A4</span>
      <h1>Etiquetas</h1>
      <p>Elegí artículos y cantidad de copias para preparar una plancha múltiple.</p>
    </div>
    <div class="heading-actions">
      <button class="button button-secondary" type="button" data-action="toggle-all-labels" id="btn-toggle-all-labels">${allSelected ? "Deseleccionar todo" : "Seleccionar todo"}</button>
      <button class="button button-primary" type="button" data-action="print-labels">Imprimir A4</button>
    </div>
  </div>
  <section class="data-card">
    <div class="label-search-controls">
      <input class="search-control" id="label-search" type="search" placeholder="Buscar por producto o código" aria-label="Buscar productos por nombre o código">
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th><input class="label-select-all" id="label-select-all" type="checkbox" aria-label="Seleccionar o deseleccionar todo" ${allSelected ? "checked" : ""}></th>
            <th>PRODUCTO</th>
            <th>CÓDIGO</th>
            <th>PRECIO</th>
            <th>ETIQUETAS</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function updateLabelSelection(selected) {
  const activeProducts = state.products.filter((product) => product.active);
  if (selected) {
    state.labelSelection = activeProducts.map((product) => ({
      productId: product.id,
      count: Number($(`.label-count[data-id="${product.id}"]`)?.value) ||
        state.labelSelection.find((entry) => entry.productId === product.id)?.count || 1
    }));
  } else {
    state.labelSelection = [];
  }
  state.labelsTouched = true;
  $$(".label-select").forEach((checkbox) => {
    checkbox.checked = selected;
    const countField = $(`.label-count[data-id="${checkbox.dataset.id}"]`);
    if (countField) countField.disabled = !selected;
  });
  const selectAllCheckbox = $("#label-select-all");
  if (selectAllCheckbox) selectAllCheckbox.checked = selected && activeProducts.length > 0;
  const toggleButton = $("#btn-toggle-all-labels");
  if (toggleButton) toggleButton.textContent = selected ? "Deseleccionar todo" : "Seleccionar todo";
}

async function renderAdministration(content) {
  if (!state.user?.isAdmin) {
    state.page = "dashboard";
    await renderDashboard(content);
    return;
  }
  const [userData, auditData] = await Promise.all([
    api("/api/admin/users"),
    api("/api/admin/audit")
  ]);
  const users = userData.users.map((user) => `
    <tr><td>${escapeHtml(user.email)}${user.email === state.user.email ? " (vos)" : ""}</td>
      <td><select class="field-control admin-user-role" aria-label="Perfil de ${escapeHtml(user.email)}" data-id="${user.id}">
        <option value="admin" ${user.isAdmin ? "selected" : ""}>Administrador</option>
        <option value="operator" ${user.isAdmin ? "" : "selected"}>Operador</option>
      </select></td>
      <td><span class="table-actions"><button class="table-action table-action-edit" type="button" data-action="save-user-role" data-id="${user.id}" ${user.email === state.user.email ? "disabled" : ""}>Guardar perfil</button><button class="table-action" type="button" data-action="delete-user" data-id="${user.id}" ${user.email === state.user.email ? "disabled" : ""}>Eliminar</button></span></td>
    </tr>`).join("");
  const entries = auditData.entries.length
    ? auditData.entries.map((entry) => `<tr><td>${formatDate(entry.createdAt, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td>${escapeHtml(entry.userEmail)}</td><td>${escapeHtml(entry.action)} · ${escapeHtml(entry.entity)}</td><td>${escapeHtml(entry.details || entry.entityId || "—")}</td></tr>`).join("")
    : '<tr><td colspan="4"><div class="empty-state">Todavía no hay cambios auditados.</div></td></tr>';
  content.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">CONTROL DE ACCESO Y DATOS</span><h1>Administración</h1><p>Gestioná las cuentas del equipo, respaldos y el historial de cambios.</p></div></div>
    <section class="data-card admin-backup-card"><div class="panel-header"><div class="panel-heading"><h2>Copias de seguridad</h2><p>El archivo contiene toda la empresa, sus movimientos, usuarios y configuración.</p></div>
      <div class="heading-actions"><a class="button button-secondary" href="/api/admin/backup">Descargar respaldo</a><button class="button button-danger" type="button" data-action="choose-backup-file">Restaurar copia</button><input id="backup-restore-file" type="file" accept=".sqlite,.db,application/vnd.sqlite3" hidden></div></div>
      <p class="field-help">Restaurar reemplaza los datos actuales. Antes de hacerlo se guarda automáticamente una copia preventiva junto a la base; al terminar, todas las sesiones se cierran.</p>
    </section>
    <section class="data-card"><div class="panel-header"><div class="panel-heading"><h2>Usuarios y permisos</h2><p>Los operadores pueden trabajar con ventas, compras, productos y recetas; solo administradores pueden gestionar usuarios, configuración y copias.</p></div></div>
      <form id="admin-user-form" class="admin-user-form">
        <div class="field"><label for="admin-new-email">Correo</label><input id="admin-new-email" class="field-control" type="email" maxlength="254" required></div>
        <div class="field"><label for="admin-new-password">Contraseña (mínimo 8 caracteres)</label><input id="admin-new-password" class="field-control" type="password" minlength="8" maxlength="128" required></div>
        <div class="field"><label for="admin-new-role">Perfil</label><select id="admin-new-role" class="field-control"><option value="operator">Operador</option><option value="admin">Administrador</option></select></div>
        <button class="button button-primary" type="submit">Crear usuario</button><p class="form-error" id="admin-user-error" role="alert"></p>
      </form>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>CUENTA</th><th>PERFIL</th><th>ACCIONES</th></tr></thead><tbody>${users}</tbody></table></div>
    </section>
    <section class="data-card"><div class="panel-header"><div class="panel-heading"><h2>Historial de cambios</h2><p>Últimas 200 acciones con cuenta, fecha y detalle.</p></div></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>FECHA</th><th>USUARIO</th><th>ACCIÓN</th><th>DETALLE</th></tr></thead><tbody>${entries}</tbody></table></div>
    </section>`;
}

async function renderBranches(content) {
  const [branchData, productData, transferData] = await Promise.all([
    api("/api/branches"),
    api("/api/products"),
    api("/api/branches/transfers")
  ]);
  state.branches = branchData.branches || [];
  state.products = productData.products || [];
  const activeBranchId = state.selectedBranchId || state.user.branchId;
  const destinationBranchId = state.branches.find((branch) => branch.id !== activeBranchId)?.id;
  const fromOptions = state.branches.map((branch) =>
    `<option value="${branch.id}" ${branch.id === activeBranchId ? "selected" : ""}>${escapeHtml(branch.name)}</option>`
  ).join("");
  const toOptions = state.branches.map((branch) =>
    `<option value="${branch.id}" ${branch.id === destinationBranchId ? "selected" : ""}>${escapeHtml(branch.name)}</option>`
  ).join("");
  const products = state.products.map((product) =>
    `<option value="${product.id}">${escapeHtml(product.name)} · ${escapeHtml(product.sku)}</option>`
  ).join("");
  const transfers = (transferData.transfers || []).map((transfer) => `
    <tr><td>${transfer.id}</td><td>${escapeHtml(transfer.fromBranch)} → ${escapeHtml(transfer.toBranch)}</td>
      <td>${transfer.itemCount}</td><td>${escapeHtml(transfer.createdBy || "—")}</td>
      <td>${formatDate(transfer.createdAt)}</td></tr>`).join("")
    || '<tr><td colspan="5"><div class="empty-state">Todavía no hay transferencias.</div></td></tr>';
  const users = (branchData.users || []).map((user) => `
    <tr><td>${escapeHtml(user.displayName || user.username)}<small>${escapeHtml(user.role)}</small></td>
      <td><select class="field-control branch-user-select" data-user-id="${user.id}" aria-label="Sucursal de ${escapeHtml(user.username)}">
        ${state.branches.map((branch) => `<option value="${branch.id}" ${branch.id === user.branchId ? "selected" : ""}>${escapeHtml(branch.name)}</option>`).join("")}
      </select></td>
      <td><button class="table-action table-action-edit" type="button" data-action="assign-user-branch" data-id="${user.id}" ${user.id === state.user.id ? "disabled" : ""}>Guardar</button></td></tr>`
  ).join("");
  content.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">INVENTARIO POR LOCAL</span><h1>Sucursales</h1>
      <p>El catálogo es compartido; el stock, las ventas y la caja se operan por sucursal.</p></div></div>
    ${state.user.role === "admin" ? `<section class="data-card">
      <div class="panel-header"><div class="panel-heading"><h2>Crear sucursal</h2><p>El catálogo estará disponible en todas; el stock de la nueva sucursal comienza en cero.</p></div></div>
      <form id="branch-create-form" class="admin-user-form">
        <div class="field"><label for="branch-new-name">Nombre</label><input id="branch-new-name" name="name" class="field-control" maxlength="80" required></div>
        <button class="button button-primary" type="submit">Crear sucursal</button><p class="form-error" id="branch-create-error" role="alert"></p>
      </form></section>` : ""}
    ${state.user.role === "admin" ? `<section class="data-card">
      <div class="panel-header"><div class="panel-heading"><h2>Asignar usuarios</h2><p>Cajeros y vendedores quedan limitados a la sucursal asignada. Administradores y gerentes pueden cambiar de sucursal.</p></div></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>USUARIO</th><th>SUCURSAL</th><th></th></tr></thead>
      <tbody>${users || '<tr><td colspan="3">No hay usuarios.</td></tr>'}</tbody></table></div></section>` : ""}
    <section class="data-card">
      <div class="panel-header"><div class="panel-heading"><h2>Transferir stock</h2><p>El origen debe tener existencias suficientes; al confirmar, se descuenta y acredita de inmediato.</p></div></div>
      <form id="branch-transfer-form" class="field-grid">
        <div class="field"><label for="transfer-from-branch">Origen</label><select class="field-control" id="transfer-from-branch" name="fromBranchId" required>${fromOptions}</select></div>
        <div class="field"><label for="transfer-to-branch">Destino</label><select class="field-control" id="transfer-to-branch" name="toBranchId" required>${toOptions}</select></div>
        <div class="field"><label for="transfer-product">Producto</label><select class="field-control" id="transfer-product" name="productId" required>${products}</select></div>
        <div class="field"><label for="transfer-quantity">Cantidad</label><input class="field-control" id="transfer-quantity" name="quantity" type="number" min="0.001" step="0.001" required></div>
        <div class="field field-full"><button class="button button-primary" type="submit">Confirmar transferencia</button><p class="form-error" id="branch-transfer-error" role="alert"></p></div>
      </form>
    </section>
    <section class="data-card"><div class="panel-header"><div class="panel-heading"><h2>Transferencias recientes</h2><p>Historial de movimientos entre sucursales.</p></div></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>N.º</th><th>RECORRIDO</th><th>PRODUCTOS</th><th>USUARIO</th><th>FECHA</th></tr></thead><tbody>${transfers}</tbody></table></div></section>`;
}

function saleSearchResults(query) {
  const results = $("#sale-search-results");
  if (!results) return;
  const normalized = normalizeProductSearch(query);
  const matching = normalized
    ? state.products.filter((product) =>
      normalizeProductSearch(product.name).includes(normalized)
    ).slice(0, 8)
    : [];
  results.innerHTML = matching.length
    ? matching.map((product) => `<button class="sale-search-result" type="button" role="option" data-action="select-sale-product" data-id="${product.id}">
        <span class="sale-result-name"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)}${product.barcode ? ` · ${escapeHtml(product.barcode)}` : ""}${product.category ? ` · ${escapeHtml(product.category)}` : ""}${state.recipes.some((recipe) => recipe.productId === product.id) ? " · Elaborado por receta" : ""}</small></span>
        <span class="sale-result-meta"><strong>${formatMoney(product.price)} · ${formatMoney(product.price2)} · ${formatMoney(product.price3)}</strong><small>Precios 1 / 2 / 3 · Stock: ${formatQuantity(product.stock)}</small></span>
      </button>`).join("")
    : `<span class="sale-search-empty">${normalized ? "No encontramos productos con ese nombre." : "Escribí el nombre del producto para buscar."}</span>`;
  results.hidden = false;
}

function quoteSearchResults(query) {
  const results = $("#quote-search-results");
  if (!results) return;
  const normalized = normalizeProductSearch(query);
  const matching = normalized
    ? state.products.filter((product) => product.active &&
      normalizeProductSearch(`${product.name} ${product.sku} ${product.barcode} ${product.category}`).includes(normalized)
    ).slice(0, 8)
    : [];
  results.innerHTML = matching.length
    ? matching.map((product) => `<button class="sale-search-result" type="button" role="option" data-action="select-quote-product" data-id="${product.id}">
        <span class="sale-result-name"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)}${product.barcode ? ` · ${escapeHtml(product.barcode)}` : ""}${product.category ? ` · ${escapeHtml(product.category)}` : ""}</small></span>
        <span class="sale-result-meta"><strong>${formatMoney(product.price)} · ${formatMoney(product.price2)} · ${formatMoney(product.price3)}</strong><small>Precios 1 / 2 / 3 · Stock: ${formatQuantity(product.stock)}</small></span>
      </button>`).join("")
    : `<span class="sale-search-empty">${normalized ? "No encontramos productos con ese nombre o código." : "Escribí un nombre o código para buscar."}</span>`;
  results.hidden = false;
}

function orderProductSearchResults(query) {
  const results = $("#order-search-results");
  if (!results) return;
  const normalized = normalizeProductSearch(query);
  const matching = normalized
    ? state.products.filter((product) => product.active &&
      normalizeProductSearch(product.name).includes(normalized)
    ).slice(0, 8)
    : [];
  results.innerHTML = matching.length
    ? matching.map((product) => `<button class="sale-search-result" type="button" role="option" data-action="select-order-product" data-id="${product.id}">
        <span class="sale-result-name"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)}${product.barcode ? ` · ${escapeHtml(product.barcode)}` : ""}</small></span>
        <span class="sale-result-meta"><strong>${formatMoney(product.price)} · ${formatMoney(product.price2)} · ${formatMoney(product.price3)}</strong><small>Precios 1 / 2 / 3</small></span>
      </button>`).join("")
    : `<span class="sale-search-empty">${normalized ? "No encontramos productos con ese nombre." : "Escribí el nombre del producto para buscar."}</span>`;
  results.hidden = false;
}

function updateQuoteSelectedProduct() {
  const product = state.products.find((item) => item.id === state.selectedQuoteProductId);
  const addButton = $("#quote-add-product");
  const details = $("#quote-selected-product");
  if (!addButton || !details) return;
  addButton.disabled = !product;
  if (!product) {
    details.innerHTML = "<span>Buscá y elegí un producto para agregarlo al presupuesto.</span>";
    return;
  }
  const tier = Number($("#quote-product-tier").value || 1);
  const price = product[`price${tier === 1 ? "" : tier}`] ?? product.price;
  details.innerHTML = `<strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.sku)} · ${formatMoney(price)}</span><small>Precio de referencia; podés ajustarlo en el carrito.</small>`;
}

function currentSalesTotals() {
  const totals = state.salesCart.reduce((result, item) => {
    const product = item.customName ? null : state.products.find((entry) => entry.id === item.productId);
    if (!item.customName && !product) return result;
    const quantityMilli = Math.round((Number(item.quantity) || 0) * 1000);
    const unitPriceCents = amountToCents(item.unitPrice) ??
      Math.round((product?.[`price${item.priceTier === 1 ? "" : item.priceTier}`] ?? product?.price ?? 0) * 100);
    const gross = Math.round((quantityMilli * unitPriceCents) / 1000);
    const discountPercent = Number(item.discountPercent) || 0;
    const customerDiscount = state.activeOrderId ? 0 :
      (state.customers.find((customer) => customer.id === state.selectedCustomerId)?.discountPercent || 0);
    const effectiveDiscount = Math.min(100, discountPercent + customerDiscount);
    const discount = Math.round((gross * Math.round(effectiveDiscount * 100)) / 10000);
    result.subtotalCents += gross;
    result.itemDiscountCents += discount;
    return result;
  }, { subtotalCents: 0, itemDiscountCents: 0 });
  const afterItemDiscountCents = totals.subtotalCents - totals.itemDiscountCents;
  totals.generalDiscountCents = Math.round(
    (afterItemDiscountCents * Math.round((Number(state.generalDiscountPercent) || 0) * 100)) / 10000
  );
  totals.discountCents = totals.itemDiscountCents + totals.generalDiscountCents;
  totals.totalCents = afterItemDiscountCents - totals.generalDiscountCents;
  return totals;
}

function renderSalesCart() {
  const cart = $("#sales-cart");
  if (!cart) return;
  cart.innerHTML = state.salesCart.length
    ? state.salesCart.map((item, index) => {
      const product = item.customName ? null : state.products.find((entry) => entry.id === item.productId);
      if (!item.customName && !product) return "";
      const name = item.customName || product.name;
      const sku = product?.sku || "";
      const tierPrices = [1, 2, 3].map((tier) =>
        product?.[`price${tier === 1 ? "" : tier}`] ?? product?.price ?? 0);
      const unitPriceCents = amountToCents(item.unitPrice) ??
        Math.round((product[`price${item.priceTier === 1 ? "" : item.priceTier}`] ?? product.price) * 100);
      const grossCents = Math.round((Math.round(Number(item.quantity) * 1000) * unitPriceCents) / 1000);
      const discountPercent = Number(item.discountPercent) || 0;
      const customerDiscount = state.activeOrderId ? 0 :
        (state.customers.find((customer) => customer.id === state.selectedCustomerId)?.discountPercent || 0);
      const effectiveDiscount = Math.min(100, discountPercent + customerDiscount);
      const discountCents = Math.round((grossCents * Math.round(effectiveDiscount * 100)) / 10000);
      const readOnlyOrder = Boolean(state.activeOrderId);
      return `<tr>
        <td><span class="table-primary"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(sku || (item.customName ? "Artículo libre · sin stock" : ""))}</small></span></td>
        <td><div class="cart-price-controls ${item.customName ? "is-custom-price" : ""}">${item.customName ? "" : `<select class="field-control cart-price-tier" data-index="${index}" aria-label="Elegir precio para ${escapeHtml(name)}">${tierPrices.map((price, tierIndex) => {
          const tier = tierIndex + 1;
          const selected = Number(item.priceTier || 1) === tier;
          return `<option value="${tier}" ${selected ? "selected" : ""}>Precio ${tier} · ${formatMoney(price)}</option>`;
        }).join("")}</select>`}
          <input class="field-control cart-price" type="number" min="0" step="0.01" value="${escapeHtml(item.unitPrice)}" data-index="${index}" aria-label="Precio unitario de ${escapeHtml(name)}" required ${readOnlyOrder ? "readonly" : ""}></div></td>
        <td><input class="cart-quantity" type="number" min="1" step="1" value="${escapeHtml(item.quantity)}" data-index="${index}" aria-label="Cantidad de ${escapeHtml(name)}" ${readOnlyOrder ? "readonly" : ""}></td>
        <td><input class="cart-discount" type="number" min="0" max="100" step="0.01" value="${escapeHtml(item.discountPercent)}" data-index="${index}" aria-label="Descuento propio de ${escapeHtml(name)}" ${readOnlyOrder ? "readonly" : ""}></td>
        <td class="cart-line-total" id="sales-line-total-${index}">${formatMoney((grossCents - discountCents) / 100)}</td>
        <td><button class="cart-remove" type="button" data-action="remove-sale-product" data-index="${index}" aria-label="Quitar ${escapeHtml(name)}" title="Quitar producto">Quitar</button></td>
      </tr>`;
    }).join("")
    : '<tr><td class="cart-empty-cell" colspan="6"><div class="empty-state"><strong>El carrito está vacío.</strong><span>Buscá un producto arriba y agregalo para empezar la venta.</span></div></td></tr>';
  renderPaymentRows();
  updateSalesSummary();
}

function renderPaymentRows() {
  const rows = $("#sale-payment-rows");
  if (!rows) return;
  rows.innerHTML = state.salePayments.map((payment, index) => {
    const isBalance = state.saleMode === "paid" && index === state.salePayments.length - 1;
    const availableMethods = Object.entries(paymentMethods)
      .filter(([method]) => method === payment.method || !state.salePayments.some((other, otherIndex) => otherIndex !== index && other.method === method));
    return `<div class="sale-payment-line">
      <label class="payment-method-field" for="payment-method-${index}">
        <span>Medio ${index + 1}</span>
        <select id="payment-method-${index}" class="field-control" data-payment-index="${index}" aria-label="Medio de pago ${index + 1}">
          ${availableMethods.map(([method, name]) => `<option value="${method}" ${method === payment.method ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
      </label>
      <label class="payment-amount-field" for="payment-amount-${index}">
        <span>Importe</span>
        <input id="payment-amount-${index}" class="field-control" type="number" min="0" step="0.01" value="${escapeHtml(payment.amount)}" data-payment-index="${index}" aria-label="Importe por ${escapeHtml(paymentMethods[payment.method])}" ${isBalance ? "readonly" : "required"}>
      </label>
      <button class="payment-remove" type="button" data-action="remove-payment" data-index="${index}" aria-label="Quitar medio de pago" ${state.salePayments.length === 1 ? "disabled" : ""}>×</button>
    </div>`;
  }).join("");
  syncPaymentBalance();
}

function syncPaymentBalance() {
  if (!state.salePayments.length) return;
  if (state.saleMode !== "paid") {
    $("#payment-balance-error").textContent = "";
    return;
  }
  const totals = currentSalesTotals();
  const lastIndex = state.salePayments.length - 1;
  const manualTotal = state.salePayments.slice(0, lastIndex).reduce((sum, payment) => {
    const amount = amountToCents(payment.amount);
    return amount === null ? sum : sum + amount;
  }, 0);
  const balance = (totals.totalCents - manualTotal) / 100;
  const finalPayment = state.salePayments[lastIndex];
  finalPayment.amount = balance.toFixed(2);
  const field = $(`#payment-amount-${lastIndex}`);
  if (field) field.value = finalPayment.amount;
  $("#payment-balance-error").textContent = manualTotal > totals.totalCents
    ? "Los importes de los medios de pago no pueden superar el total de la venta."
    : "";
}

function paymentsMatchTotal() {
  const amounts = state.salePayments.map((payment) => amountToCents(payment.amount));
  if (amounts.some((amount) => amount === null || amount < 0)) return false;
  const paidCents = amounts.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(paidCents) || paidCents > currentSalesTotals().totalCents) return false;
  return state.saleMode === "paid"
    ? paidCents === currentSalesTotals().totalCents
    : state.saleMode === "deposit"
      ? paidCents > 0 && paidCents < currentSalesTotals().totalCents
      : true;
}

function updateSalesSummary() {
  const totals = currentSalesTotals();
  const subtotal = $("#sale-subtotal");
  if (!subtotal) return;
  subtotal.textContent = formatMoney(totals.subtotalCents / 100);
  $("#sale-item-discount-total").textContent = `− ${formatMoney(totals.itemDiscountCents / 100)}`;
  $("#sale-general-discount-amount").textContent = `− ${formatMoney(totals.generalDiscountCents / 100)}`;
  $("#sale-discount-total").textContent = `− ${formatMoney(totals.discountCents / 100)}`;
  $("#sale-total").textContent = formatMoney(totals.totalCents / 100);
  const received = amountToCents(state.cashReceived) ?? 0;
  const cashPayment = state.salePayments.find((payment) => payment.method === "cash");
  const cashPaid = amountToCents(cashPayment?.amount) ?? 0;
  $("#sale-change").textContent = formatMoney(Math.max(0, received - cashPaid) / 100);
  $("#sale-item-count").textContent = String(state.salesCart.length);
  syncPaymentBalance();
  $("#complete-sale").disabled = !state.salesCart.length || !paymentsMatchTotal();
  $("#sale-cash-closed-message").hidden = Boolean(state.cashOpen);
  const customer = $("#sale-contact");
  $("#sale-summary-customer").textContent = customer?.value.trim() || "Consumidor final";
  for (const item of state.salesCart) {
    const index = state.salesCart.indexOf(item);
    const line = $(`#sales-line-total-${index}`);
    if (!line) continue;
    const product = item.customName ? null : state.products.find((entry) => entry.id === item.productId);
    if (!item.customName && !product) continue;
    const unitPrice = amountToCents(item.unitPrice) ??
      (item.customName ? 0 : Math.round((product[`price${item.priceTier === 1 ? "" : item.priceTier}`] ?? product.price) * 100));
    const gross = Math.round((Math.round(Number(item.quantity) * 1000) * unitPrice) / 1000);
    const discountPercent = Number(item.discountPercent) || 0;
    const customerDiscount = state.activeOrderId ? 0 :
      (state.customers.find((customer) => customer.id === state.selectedCustomerId)?.discountPercent || 0);
    const discount = Math.round((gross * Math.round(Math.min(100, discountPercent + customerDiscount) * 100)) / 10000);
    line.textContent = formatMoney((gross - discount) / 100);
  }
}

async function renderSalesDesk(content) {
  const [productData, transactionData, recipeData, customerData, orderData, cashData] = await Promise.all([
    api("/api/products"),
    api("/api/transactions?kind=sale"),
    api("/api/recipes"),
    api("/api/customers"),
    api("/api/sales-orders"),
    api("/api/cash-register")
  ]);
  state.products = productData.products;
  state.recipes = recipeData.recipes;
  state.customers = customerData.customers;
  state.salesOrders = orderData.orders;
  state.cashOpen = Boolean(cashData.session);
  if (!state.customers.some((customer) => customer.id === state.selectedCustomerId)) state.selectedCustomerId = null;
  const recentSales = transactionData.transactions.slice(0, 5);
  const pendingOrders = state.salesOrders.filter((order) => order.status === "open");
  state.salesHistory = transactionData.transactions;
  content.innerHTML = `
    <div class="page-heading">
      <div><span class="eyebrow">GESTIÓN DE TU EMPRESA</span><h1>Facturación</h1><p>Elegí un pedido pendiente o prepará una venta y registrá el cobro.</p></div>
      <span class="sales-counter"><span class="today-dot"></span> Punto de venta</span>
    </div>
    ${pendingOrders.length ? `<section class="data-card"><div class="field-grid">
      <div class="field"><label for="facturation-order-select">Pedido pendiente de venta</label><select id="facturation-order-select" class="field-control">
        <option value="">Elegí un pedido</option>${pendingOrders.map((order) => `<option value="${order.id}" ${state.activeOrderId === order.id ? "selected" : ""}>${escapeHtml(order.number)} · ${escapeHtml(order.contact)} · ${escapeHtml(order.createdBy)} · ${formatMoney(order.total)}</option>`).join("")}
      </select></div><div class="field"><label>&nbsp;</label><div class="heading-actions"><button class="button button-secondary" type="button" data-action="load-order">Cargar pedido para facturar</button>${state.activeOrderId ? '<button class="button button-secondary" type="button" data-action="clear-loaded-order">Quitar pedido</button>' : ""}</div></div>
    </div></section>` : ""}
    <section class="sales-workspace">
      <div class="sales-left-column">
        <article class="panel sales-composer">
          <header class="panel-header"><div class="panel-heading"><h2>Agregar productos</h2><p>Buscá por nombre o código de producto.</p></div></header>
          <div class="sale-customer-field field"><label for="sale-customer">Cliente registrado</label><select class="field-control" id="sale-customer" ${state.activeOrderId ? "disabled" : ""}><option value="">Consumidor final / sin descuento</option>${state.customers.map((customer) => `<option value="${customer.id}" ${String(customer.id) === String(state.selectedCustomerId || "") ? "selected" : ""}>${escapeHtml(customer.name)} · ${customer.discountPercent}% descuento</option>`).join("")}</select><span class="field-help">El descuento del cliente se suma a los descuentos por producto.</span></div>
          <div class="sale-customer-field field"><label for="sale-contact">Razón social / cliente</label><input class="field-control" id="sale-contact" maxlength="120" value="${escapeHtml(state.salesOrders.find((order) => order.id === state.activeOrderId)?.contact || state.customers.find((customer) => customer.id === state.selectedCustomerId)?.name || "Consumidor final")}" autocomplete="off" ${state.activeOrderId ? "readonly" : ""}></div>
          <details class="customer-extra sale-customer-field">
            <summary>Datos adicionales del cliente para el comprobante</summary>
            <div class="field-grid">
              <div class="field"><label for="sale-contact-tax-id">CUIT / identificación</label><input class="field-control" id="sale-contact-tax-id" maxlength="32"></div>
              <div class="field"><label for="sale-contact-vat">Condición frente al IVA</label><input class="field-control" id="sale-contact-vat" maxlength="80" value="Consumidor final"></div>
              <div class="field field-full"><label for="sale-contact-address">Domicilio comercial</label><input class="field-control" id="sale-contact-address" maxlength="200"></div>
              <div class="field"><label for="sale-contact-phone">Teléfono</label><input class="field-control" id="sale-contact-phone" type="tel" maxlength="40"></div>
              <div class="field"><label for="sale-contact-email">Correo</label><input class="field-control" id="sale-contact-email" type="email" maxlength="254"></div>
            </div>
          </details>
          <div class="sale-product-picker">
            <label class="sale-search-label" for="sale-product-search">Producto</label>
            <div class="sale-search-wrap">
              <span class="sale-search-icon" aria-hidden="true">⌕</span>
              <input class="field-control sale-search-input" id="sale-product-search" type="search" placeholder="Buscar por nombre del producto…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="sale-search-results" aria-expanded="false">
              <button class="camera-scan-button" type="button" data-action="toggle-camera-scanner" aria-label="Activar lector con cámara" title="Activar lector con cámara">▣</button>
              <div class="sale-search-results" id="sale-search-results" role="listbox" hidden></div>
            </div>
            <div class="sale-selected-product" id="sale-selected-product"><span>Seleccioná un producto para agregarlo a la venta.</span></div>
          </div>
          <div class="sale-item-controls">
            <div class="field"><label for="sale-quantity">Cantidad (unidades enteras)</label><input class="field-control" id="sale-quantity" type="number" min="1" step="1" value="1"></div>
            <div class="field"><label for="sale-discount">Descuento (%)</label><input class="field-control" id="sale-discount" type="number" min="0" max="100" step="0.01" value="0"></div>
            <button class="button button-primary sale-add-button" id="sale-add-product" type="button" data-action="add-sale-product" disabled>Agregar al carrito <span aria-hidden="true">＋</span></button>
          </div>
          <details class="custom-sale-item">
            <summary>Agregar un artículo que no está en stock</summary>
            <div class="sale-item-controls">
              <div class="field"><label for="custom-sale-name">Descripción</label><input class="field-control" id="custom-sale-name" maxlength="120"></div>
              <div class="field"><label for="custom-sale-price">Precio unitario</label><input class="field-control" id="custom-sale-price" type="number" min="0" step="0.01" value="0.00"></div>
              <div class="field"><label for="custom-sale-quantity">Cantidad (unidades enteras)</label><input class="field-control" id="custom-sale-quantity" type="number" min="1" step="1" value="1"></div>
              <div class="field"><label for="custom-sale-discount">Descuento (%)</label><input class="field-control" id="custom-sale-discount" type="number" min="0" max="100" step="0.01" value="0"></div>
              <button class="button button-secondary sale-add-button" type="button" data-action="add-custom-sale-item">Agregar artículo libre</button>
            </div>
            <p class="field-help">Se guarda solamente en esta venta y no modifica el inventario.</p>
          </details>
          <p class="sale-stock-note"><span class="scope-note-icon" aria-hidden="true">i</span> Los productos del catálogo se descuentan del inventario aunque el stock quede negativo.</p>
        </article>
        <article class="panel cart-panel">
          <header class="panel-header"><div class="panel-heading"><h2>Carrito de venta</h2><p><span id="sale-item-count">${state.salesCart.length}</span> productos · ${state.activeOrderId ? "Quitá los artículos que no vas a facturar." : "Editá cantidad o descuento directamente."}</p></div></header>
          <div class="table-scroll"><table class="data-table sales-cart-table"><thead><tr><th>PRODUCTO</th><th>PRECIO UNIT.</th><th>CANTIDAD</th><th>DESC. %</th><th>SUBTOTAL</th><th></th></tr></thead><tbody id="sales-cart"></tbody></table></div>
        </article>
        <article class="panel sales-history">
          <header class="panel-header"><div class="panel-heading"><h2>Ventas recientes</h2><p>Últimos movimientos registrados</p></div></header>
          ${recentSales.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>CREÓ</th><th>FECHA</th><th>TOTAL</th><th>ACCIONES</th></tr></thead><tbody>${recentSales.map((sale) => `<tr><td>${escapeHtml(sale.number)}</td><td>${escapeHtml(sale.contact)}</td><td>${escapeHtml(sale.createdBy || "—")}</td><td>${formatDate(sale.createdAt)}</td><td>${formatMoney(sale.total)}</td><td><span class="table-actions"><button class="table-action table-action-edit" type="button" data-action="print-sale" data-id="${sale.id}">Comprobante</button>${["admin", "manager"].includes(state.user?.role) ? `<button class="table-action" type="button" data-action="delete-sale" data-id="${sale.id}">Borrar</button>` : ""}</span></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state"><strong>Todavía no hay ventas registradas.</strong><span>Al completar la primera venta, la vas a encontrar acá.</span></div>'}
        </article>
      </div>
      <aside class="panel sale-summary">
        <div class="sale-summary-header"><span class="summary-icon" aria-hidden="true">▤</span><span><strong>Resumen de venta</strong><small>Importes en pesos argentinos</small></span></div>
        <div class="summary-row"><span>Subtotal</span><strong id="sale-subtotal">${formatMoney(0)}</strong></div>
        <div class="summary-row"><span>Desc. por producto</span><strong class="summary-discount" id="sale-item-discount-total">− ${formatMoney(0)}</strong></div>
        <label class="summary-discount-control" for="sale-general-discount"><span>Descuento general (%)</span><input class="field-control" id="sale-general-discount" type="number" min="0" max="100" step="0.01" value="${escapeHtml(state.generalDiscountPercent)}" aria-label="Descuento general en porcentaje" ${state.activeOrderId ? "readonly" : ""}></label>
        <div class="summary-row"><span>Importe desc. general</span><strong class="summary-discount" id="sale-general-discount-amount">− ${formatMoney(0)}</strong></div>
        <div class="summary-row summary-row-total-discounts"><span>Total de descuentos</span><strong class="summary-discount" id="sale-discount-total">− ${formatMoney(0)}</strong></div>
        <div class="summary-grand-total"><span>Total a cobrar</span><strong id="sale-total">${formatMoney(0)}</strong></div>
        <label class="summary-discount-control sale-mode-control" for="sale-mode"><span>Modalidad de cobro</span><select class="field-control" id="sale-mode"><option value="paid" ${state.saleMode === "paid" ? "selected" : ""}>Venta cobrada</option><option value="deposit" ${state.saleMode === "deposit" ? "selected" : ""}>Venta con seña</option><option value="account" ${state.saleMode === "account" ? "selected" : ""}>Fiado / cuenta corriente</option></select></label>
        <div class="sale-payments-section">
          <div class="sale-payment-heading"><strong>Medios de pago</strong><button type="button" class="add-line" data-action="add-payment">+ Agregar</button></div>
          <div id="sale-payment-rows"></div>
          <p id="payment-balance-error" class="payment-balance-error" role="alert"></p>
        </div>
        <label class="summary-discount-control" for="sale-cash-received"><span>Efectivo recibido</span><input class="field-control" id="sale-cash-received" type="number" min="0" step="0.01" value="${escapeHtml(state.cashReceived)}"></label>
        <div class="summary-row sale-change-row"><span>Cambio a entregar</span><strong id="sale-change">${formatMoney(0)}</strong></div>
        <button class="button button-primary complete-sale-button" type="button" id="complete-sale" data-action="complete-sale" ${state.salesCart.length ? "" : "disabled"}>Registrar venta <span aria-hidden="true">→</span></button>
        <p class="field-help sale-cash-closed-message" id="sale-cash-closed-message" ${state.cashOpen ? "hidden" : ""}>No hay un turno abierto. Las ventas se registrarán igualmente, pero no se incluirán en el arqueo de caja.</p>
        <p class="summary-customer">Cliente: <strong id="sale-summary-customer">Consumidor final</strong></p>
      </aside>
    </section>
    <section class="scope-note"><span class="scope-note-icon" aria-hidden="true">i</span><div><strong>Registro comercial interno</strong><p>La venta y sus descuentos se guardan para control y seguimiento, pero no generan una factura fiscal ni un comprobante electrónico de ARCA/AFIP.</p></div></section>`;
  state.selectedSaleProductId = null;
  if (!state.salePayments.length) state.salePayments = [{ method: "cash", amount: "0" }];
  $("#sale-search-results").hidden = true;
  renderSalesCart();
}

async function renderSalesOrders(content) {
  const [productData, customerData, orderData] = await Promise.all([
    api("/api/products"), api("/api/customers"), api("/api/sales-orders")
  ]);
  state.products = productData.products;
  state.customers = customerData.customers;
  state.salesOrders = orderData.orders;
  state.selectedOrderProductId = null;
  const orderCustomerId = Number($("#order-customer")?.value || 0);
  state.orderGeneralDiscountPercent = $("#order-general-discount")?.value || state.orderGeneralDiscountPercent || "0";
  const selectedCustomer = state.customers.find((customer) => customer.id === orderCustomerId);
  const cartRows = state.orderCart.length
    ? state.orderCart.map((item, index) => {
        const product = state.products.find((entry) => entry.id === item.productId);
        if (!product) return "";
        const unitPrice = amountToCents(item.unitPrice) ?? 0;
        const gross = Math.round(unitPrice * Number(item.quantity));
        const discount = Math.min(100, Number(item.discountPercent || 0) +
          (selectedCustomer?.discountPercent || 0));
        const total = gross - Math.round(gross * discount / 100);
        return `<tr><td>${escapeHtml(product.name)}<small>${escapeHtml(product.sku)}</small></td>
          <td>${formatMoney(unitPrice / 100)}</td>
          <td><input class="order-quantity field-control" data-index="${index}" type="number" min="1" step="1" value="${escapeHtml(item.quantity)}"></td>
          <td>${discount.toFixed(2)}%</td><td>${formatMoney(total / 100)}</td>
          <td><button class="cart-remove" type="button" data-action="remove-order-item" data-index="${index}" aria-label="Quitar ${escapeHtml(product.name)} del pedido" title="Quitar producto">Quitar</button></td></tr>`;
      }).join("")
    : '<tr><td colspan="6"><div class="empty-state"><strong>El pedido está vacío.</strong><span>Elegí productos y agregalos al carrito.</span></div></td></tr>';
  const pendingOrders = state.salesOrders.filter((order) => order.status === "open");
  const orderRows = state.salesOrders.length
    ? state.salesOrders.map((order) => `<tr>
        <td>${escapeHtml(order.number)}</td><td>${escapeHtml(order.contact)}</td>
        <td>${escapeHtml(order.createdBy || "—")}</td><td>${formatDate(order.createdAt)}</td>
        <td>${formatMoney(order.total)}</td><td>${order.status === "open" ? "Pendiente" : order.status === "converted" ? "Facturado" : "Cancelado"}</td>
        <td><span class="table-actions">${order.status === "open" && state.user?.role !== "seller" ? `<button class="table-action table-action-edit" type="button" data-action="invoice-order" data-id="${order.id}">Facturar</button>` : ""}${order.status === "open" ? `<button class="table-action" type="button" data-action="cancel-order" data-id="${order.id}">Cancelar</button>` : ""}</span></td>
      </tr>`).join("")
    : '<tr><td colspan="7"><div class="empty-state">Todavía no hay pedidos de venta.</div></td></tr>';
  const subtotal = state.orderCart.reduce((sum, item) => sum +
    Math.round((amountToCents(item.unitPrice) || 0) * Number(item.quantity)), 0);
  const customerDiscountCents = state.orderCart.reduce((sum, item) => {
    const gross = Math.round((amountToCents(item.unitPrice) || 0) * Number(item.quantity));
    const discount = Math.min(100, Number(item.discountPercent || 0) + (selectedCustomer?.discountPercent || 0));
    return sum + Math.round(gross * discount / 100);
  }, 0);
  const totalBeforeGeneral = subtotal - customerDiscountCents;
  const generalDiscountCents = Math.round(totalBeforeGeneral * Number(state.orderGeneralDiscountPercent || 0) / 100);
  const orderTotalCents = totalBeforeGeneral - generalDiscountCents;
  content.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">PEDIDOS DE VENTA</span><h1>Ventas</h1><p>Prepará pedidos sin descontar stock. La venta se confirma en Facturación.</p></div></div>
    <section class="sales-workspace quote-workspace">
      <div class="sales-left-column">
        <article class="panel sales-composer">
          <header class="panel-header"><div class="panel-heading"><h2>Nuevo pedido</h2><p>El usuario que lo crea queda registrado en el pedido.</p></div></header>
          <div class="field"><label for="order-customer">Cliente</label><select id="order-customer" class="field-control"><option value="">Consumidor final / sin descuento</option>${state.customers.map((customer) => `<option value="${customer.id}" ${customer.id === orderCustomerId ? "selected" : ""}>${escapeHtml(customer.name)} · ${customer.discountPercent}% descuento</option>`).join("")}</select></div>
          <div class="field"><label for="order-contact">Nombre del cliente (si no está registrado)</label><input id="order-contact" class="field-control" maxlength="120" value="${escapeHtml(selectedCustomer?.name || "Consumidor final")}"></div>
          <div class="field-grid">
            <div class="field sale-product-picker"><label for="order-product-search">Producto</label>
              <div class="sale-search-wrap"><span class="sale-search-icon" aria-hidden="true">⌕</span>
                <input class="field-control sale-search-input" id="order-product-search" type="search" placeholder="Buscar por nombre del producto..." autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="order-search-results" aria-expanded="false">
              <button class="camera-scan-button" type="button" data-action="toggle-camera-scanner" aria-label="Activar lector con cámara" title="Activar lector con cámara">▣</button>
              <div class="sale-search-results" id="order-search-results" role="listbox" hidden></div>
              </div>
            </div>
            <div class="field"><label for="order-tier">Precio</label><select id="order-tier" class="field-control"><option value="1">Precio 1</option><option value="2">Precio 2</option><option value="3">Precio 3</option></select></div>
            <div class="field"><label for="order-quantity-new">Cantidad</label><input id="order-quantity-new" class="field-control" type="number" min="1" step="1" value="1"></div>
            <div class="field"><label for="order-price">Precio unitario</label><input id="order-price" class="field-control" type="number" min="0" step="0.01" value="0.00"></div>
          </div>
          <button class="button button-primary" type="button" data-action="add-order-item">Agregar al pedido</button>
        </article>
        <article class="panel cart-panel"><header class="panel-header"><div class="panel-heading"><h2>Carrito del pedido</h2></div></header>
          <div class="table-scroll"><table class="data-table"><thead><tr><th>PRODUCTO</th><th>PRECIO</th><th>CANTIDAD</th><th>DESC. TOTAL</th><th>SUBTOTAL</th><th></th></tr></thead><tbody>${cartRows}</tbody></table></div>
        </article>
      </div>
      <aside class="panel sale-summary"><div class="sale-summary-header"><span class="summary-icon" aria-hidden="true">↗</span><span><strong>Resumen del pedido</strong><small>No descuenta stock hasta facturarlo</small></span></div>
        <div class="summary-row"><span>Subtotal</span><strong>${formatMoney(subtotal / 100)}</strong></div>
        <div class="summary-row"><span>Descuento total de productos</span><strong class="summary-discount">− ${formatMoney(customerDiscountCents / 100)}</strong></div>
        <label class="summary-discount-control" for="order-general-discount"><span>Descuento general (%)</span><input id="order-general-discount" class="field-control" type="number" min="0" max="100" step="0.01" value="${escapeHtml(state.orderGeneralDiscountPercent)}"></label>
        <div class="summary-row"><span>Importe desc. general</span><strong class="summary-discount">− ${formatMoney(generalDiscountCents / 100)}</strong></div>
        <div class="summary-grand-total"><span>Total del pedido</span><strong>${formatMoney(orderTotalCents / 100)}</strong></div>
        <button class="button button-primary complete-sale-button" type="button" data-action="save-order" ${state.orderCart.length ? "" : "disabled"}>Guardar pedido</button>
      </aside>
    </section>
    <section class="data-card"><div class="panel-header"><div class="panel-heading"><h2>Pedidos de venta</h2><p>${pendingOrders.length} pendiente${pendingOrders.length === 1 ? "" : "s"} de facturar</p></div></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>NÚMERO</th><th>CLIENTE</th><th>CREÓ</th><th>FECHA</th><th>TOTAL</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>${orderRows}</tbody></table></div>
    </section>`;
  $("#order-tier")?.addEventListener("change", () => {
    const product = state.products.find((entry) => entry.id === state.selectedOrderProductId);
    const tier = Number($("#order-tier").value || 1);
    $("#order-price").value = String(product?.[`price${tier === 1 ? "" : tier}`] ?? product?.price ?? 0);
  });
}

async function renderCustomers(content) {
  const data = await api("/api/customers");
  state.customers = data.customers;
  const rows = state.customers.length
    ? state.customers.map((customer) => `<tr>
        <td><input class="field-control customer-name" data-id="${customer.id}" value="${escapeHtml(customer.name)}" aria-label="Nombre del cliente"></td>
        <td><input class="field-control customer-discount" data-id="${customer.id}" type="number" min="0" max="100" step="0.01" value="${customer.discountPercent}" aria-label="Descuento del cliente"></td>
        <td><input class="field-control customer-phone" data-id="${customer.id}" value="${escapeHtml(customer.phone)}" aria-label="Teléfono"></td>
        <td><input class="field-control customer-tax-id" data-id="${customer.id}" value="${escapeHtml(customer.taxId)}" aria-label="Identificación fiscal"></td>
        <td><span class="table-actions"><button class="table-action table-action-edit" type="button" data-action="save-customer" data-id="${customer.id}">Guardar</button><button class="table-action" type="button" data-action="archive-customer" data-id="${customer.id}">Archivar</button></span></td>
      </tr>`).join("")
    : '<tr><td colspan="5"><div class="empty-state">Todavía no hay clientes cargados.</div></td></tr>';
  content.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">CARTERA DE CLIENTES</span><h1>Clientes</h1><p>Guardá descuentos y datos para aplicarlos automáticamente en Facturación.</p></div></div>
    <section class="data-card"><div class="panel-header"><div class="panel-heading"><h2>Nuevo cliente</h2><p>El descuento se suma a los descuentos por producto, hasta un máximo total del 100 %.</p></div></div>
      <form id="customer-form" class="field-grid">
        <div class="field"><label for="customer-name-new">Nombre *</label><input id="customer-name-new" name="name" class="field-control" maxlength="120" required></div>
        <div class="field"><label for="customer-discount-new">Descuento (%)</label><input id="customer-discount-new" name="discountPercent" class="field-control" type="number" min="0" max="100" step="0.01" value="0" required></div>
        <div class="field"><label for="customer-tax-new">CUIT / identificación</label><input id="customer-tax-new" name="taxId" class="field-control" maxlength="32"></div>
        <div class="field"><label for="customer-phone-new">Teléfono</label><input id="customer-phone-new" name="phone" class="field-control" maxlength="40"></div>
        <div class="field"><label for="customer-email-new">Correo</label><input id="customer-email-new" name="email" class="field-control" type="email" maxlength="254"></div>
        <div class="field"><label for="customer-address-new">Domicilio</label><input id="customer-address-new" name="address" class="field-control" maxlength="200"></div>
        <div class="field"><label for="customer-vat-new">Condición IVA</label><input id="customer-vat-new" name="vatCondition" class="field-control" maxlength="80" value="Consumidor final"></div>
        <div class="field"><button class="button button-primary" type="submit">Guardar cliente</button></div>
        <p id="customer-form-error" class="form-error" role="alert"></p>
      </form>
    </section>
    <section class="data-card"><div class="table-scroll"><table class="data-table"><thead><tr><th>CLIENTE</th><th>DESCUENTO %</th><th>TELÉFONO</th><th>CUIT / ID</th><th>ACCIONES</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function productRows(products) {
  if (!products.length) return '<tr><td colspan="7"><div class="empty-state"><strong>Tu catálogo está vacío.</strong><span>Agregá tu primer producto para empezar a gestionar el stock.</span></div></td></tr>';
  return products.map((product) => {
    const isLow = product.stock <= product.minimumStock;
    const recipe = state.recipes.find((entry) => Number(entry.productId) === Number(product.id));
    const recipeSearch = recipe
      ? normalizeProductSearch(`${recipe.productName || product.name} ${recipe.components.map((component) => component.name).join(" ")}`)
      : "";
    return `<tr data-product-search="${escapeHtml(normalizeProductSearch(`${product.name} ${product.sku} ${product.barcode}`))}"
      data-category-search="${escapeHtml(normalizeProductSearch(product.category || ""))}"
      data-recipe-search="${escapeHtml(recipeSearch)}" data-has-recipe="${Boolean(recipe)}">
      <td><span class="table-primary"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)}</small></span></td>
      <td>${escapeHtml(product.category || "—")}</td><td>${formatMoney(product.cost)}</td>
      <td>${formatMoney(product.price)}</td>
      <td><span class="stock-cell ${isLow ? "low" : ""}">${isLow ? '<span class="status-dot" aria-hidden="true"></span>' : ""}${formatQuantity(product.stock)}</span></td>
      <td>${formatQuantity(product.minimumStock)}</td>
      <td><span class="table-actions"><button class="table-action table-action-edit" type="button" data-action="edit-product" data-id="${product.id}">Editar</button><button class="table-action" type="button" data-action="archive-product" data-id="${product.id}">Archivar</button></span></td>
    </tr>`;
  }).join("");
}

function filterProductRows() {
  const search = $("#product-search");
  const mode = $("#product-search-mode");
  if (!search || !mode) return;
  const term = normalizeProductSearch(search.value);
  const attribute = {
    product: "productSearch",
    category: "categorySearch",
    recipe: "recipeSearch"
  }[mode.value];
  $$("[data-product-search]", $("#product-rows")).forEach((row) => {
    row.hidden = mode.value === "recipe"
      ? row.dataset.hasRecipe !== "true" || (term && !row.dataset[attribute].includes(term))
      : Boolean(term) && !row.dataset[attribute].includes(term);
  });
}

async function renderTransactions(content, kind) {
  const endpoint = kind === "sale" ? "/api/transactions?kind=sale" : "/api/transactions?kind=purchase";
  const data = await api(endpoint);
  if (kind === "sale") state.salesHistory = data.transactions;
  const noun = kind === "sale" ? "venta" : "compra";
  const rows = data.transactions.length
    ? data.transactions.map((transaction) => `
      <tr>
        <td>${escapeHtml(transaction.number)}</td>
        <td>${kind === "purchase"
          ? `<span class="table-primary"><strong>${escapeHtml(transaction.contact)}</strong><small>${escapeHtml(transaction.place || "Lugar no indicado")}</small></span>`
          : escapeHtml(transaction.contact)}</td>
        ${kind === "sale" ? `<td>${escapeHtml(transaction.salespersonName || "—")}</td>` : ""}
        <td>${transaction.items.length} ${transaction.items.length === 1 ? "producto" : "productos"}</td>
        <td>${formatDate(transaction.createdAt)}</td>
        <td>${formatMoney(transaction.total)}</td>
        ${kind === "sale"
          ? `<td><span class="table-actions"><button class="table-action table-action-edit" type="button" data-action="print-sale" data-id="${transaction.id}">Comprobante</button>${["admin", "manager"].includes(state.user?.role) ? `<button class="table-action" type="button" data-action="delete-sale" data-id="${transaction.id}">Borrar</button>` : ""}</span></td>`
          : `<td>${transaction.document
            ? `<a class="table-action purchase-document-link" href="/api/transactions/${transaction.id}/document">${escapeHtml(transaction.document.fileName)}</a>`
            : '<span class="field-help">Sin archivo</span>'}</td>`}
      </tr>`).join("")
    : `<tr><td colspan="${kind === "sale" ? 7 : 6}"><div class="empty-state"><strong>Todavía no registraste ${noun === "venta" ? "ventas" : "compras"}.</strong><span>Usá el botón de arriba para cargar la primera operación.</span></div></td></tr>`;
  content.innerHTML = `
    ${pageHeading(pageTitles[kind === "sale" ? "sales" : "purchases"], `Consultá el historial de ${noun}s y registrá nuevos movimientos.`, `Nueva ${noun}`, kind === "sale" ? "new-sale" : "new-purchase")}
    <section class="data-card">
      <div class="panel-header"><div class="panel-heading"><h2>Historial de ${noun}s</h2><p>Mostrando los últimos ${Math.min(data.transactions.length, 100)} movimientos</p></div></div>
      <div class="table-scroll"><table class="data-table ${kind === "purchase" ? "purchase-history-table" : ""}"><thead><tr><th>NÚMERO</th><th>${kind === "sale" ? "CLIENTE" : "PROVEEDOR / LUGAR"}</th>${kind === "sale" ? "<th>VENDEDOR/A</th>" : ""}<th>ARTÍCULOS</th><th>FECHA</th><th>TOTAL</th><th>${kind === "sale" ? "ACCIONES" : "COMPROBANTE"}</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    ${kind === "sale" ? scopeNotice() : ""}`;
}

function showModal(title, eyebrow, body, footer) {
  $("#modal-title").textContent = title;
  $("#modal-eyebrow").textContent = eyebrow;
  $("#modal-body").innerHTML = body;
  $("#modal-footer").innerHTML = footer;
  $("#modal").showModal();
}

async function openQuoteModal() {
  if (!state.products.length) state.products = (await api("/api/products")).products;
  $("#modal-form").dataset.kind = "quote";
  showModal("Nuevo presupuesto", "VENTAS", `
    <p class="transaction-intro">Los precios quedan guardados y no se modifica el stock hasta convertir el presupuesto en venta.</p>
    <div class="field-grid">
      <div class="field"><label for="quote-contact">Cliente *</label><input class="field-control" id="quote-contact" maxlength="120" required></div>
      <div class="field"><label for="quote-valid-until">Válido hasta *</label><input class="field-control" id="quote-valid-until" type="date" value="${quoteValidityDate()}" required></div>
      <div class="field"><label for="quote-tax-id">CUIT / identificación</label><input class="field-control" id="quote-tax-id" maxlength="32"></div>
      <div class="field"><label for="quote-vat">Condición frente al IVA</label><input class="field-control" id="quote-vat" maxlength="80" value="Consumidor final"></div>
      <div class="field"><label for="quote-phone">Teléfono</label><input class="field-control" id="quote-phone" type="tel" maxlength="40"></div>
      <div class="field"><label for="quote-email">Correo</label><input class="field-control" id="quote-email" type="email" maxlength="254"></div>
      <div class="field field-full"><label for="quote-address">Domicilio</label><input class="field-control" id="quote-address" maxlength="200"></div>
    </div>
    <div class="item-editor"><div class="item-editor-header"><span class="item-editor-title">Artículos</span><button class="add-line" type="button" data-action="add-quote-line">+ Agregar artículo</button></div>
      <div id="quote-lines">${quoteEditorLine(0)}</div>
    </div>
    <div class="field quote-general-discount"><label for="quote-general-discount">Descuento general (%)</label><input class="field-control" id="quote-general-discount" type="number" min="0" max="100" step="0.01" value="0"></div>
    <div class="transaction-total"><span>Total del presupuesto</span><strong id="quote-total">${formatMoney(0)}</strong></div>
    <p class="modal-error" id="modal-error" role="alert"></p>`,
    '<button class="button button-secondary" type="button" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">Guardar presupuesto</button>');
  $("#modal-form").dataset.kind = "quote";
  $("#quote-contact").focus();
  updateQuotePreview();
  updateQuoteSelectedProduct();
}

function openQuoteConversionModal(quote) {
  $("#modal-form").dataset.kind = "quote-convert";
  $("#modal-form").dataset.quoteId = quote.id;
  showModal(`Convertir ${quote.number}`, "REGISTRAR VENTA", `
    <p class="transaction-intro">Se registrará la venta con los precios guardados en el presupuesto y se actualizará el inventario una sola vez.</p>
    <div class="field"><label for="quote-payment-method">Medio de pago</label><select class="field-control" id="quote-payment-method">${Object.entries(paymentMethods).map(([method, label]) => `<option value="${method}">${escapeHtml(label)}</option>`).join("")}</select></div>
    <div class="field"><label for="quote-payment-amount">Importe recibido</label><input class="field-control" id="quote-payment-amount" type="number" min="0" step="0.01" value="${escapeHtml(quote.total.toFixed(2))}" required></div>
    <p class="field-help">El importe debe coincidir con el total de ${formatMoney(quote.total)}. Para pagos divididos, registrá la venta desde el punto de venta.</p>
    <p class="modal-error" id="modal-error" role="alert"></p>`,
    '<button class="button button-secondary" type="button" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">Confirmar venta</button>');
  $("#modal-form").dataset.kind = "quote-convert";
}

function openProductModal(product = null) {
  $("#modal-form").dataset.kind = product ? "product-edit" : "product";
  $("#modal-form").dataset.productId = product?.id || "";
  $("#modal-form").dataset.isNewProduct = String(!product);
  const value = (field) => escapeHtml(String(product?.[field] ?? ""));
  showModal(product ? "Editar producto" : "Nuevo producto", "CATÁLOGO", `
    <div class="field-grid">
      <div class="field"><label for="product-sku">Código / SKU *</label><input class="field-control" id="product-sku" name="sku" maxlength="40" placeholder="EJ. PROD-001" value="${product ? value("sku") : escapeHtml(generateProductSku())}" required></div>
      <div class="field"><label for="product-barcode">Código de barras</label><input class="field-control" id="product-barcode" name="barcode" maxlength="80" inputmode="numeric" placeholder="Escaneá o ingresá el código" value="${value("barcode")}"></div>
      <div class="field"><label for="product-category">Categoría</label><input class="field-control" id="product-category" name="category" maxlength="80" placeholder="Ej. Accesorios" value="${value("category")}"></div>
      <div class="field"><label for="product-brand">Marca</label><input class="field-control" id="product-brand" name="brand" maxlength="80" value="${value("brand")}"></div>
      <div class="field field-full"><label for="product-name">Nombre del producto *</label><input class="field-control" id="product-name" name="name" maxlength="120" placeholder="Nombre que verá tu equipo" value="${value("name")}" required></div>
      <div class="field"><label for="product-cost">Precio de compra</label><input class="field-control" id="product-cost" name="cost" type="number" min="0" step="0.01" value="${product ? value("cost") : "0"}" required></div>
      <div class="field"><label for="product-bonus-percent">Bonificación (%)</label><input class="field-control" id="product-bonus-percent" name="bonusPercent" type="number" min="0" max="100" step="0.01" value="${product ? value("bonusPercent") : "0"}"></div>
      <div class="field"><label for="product-discounted-cost">Precio bonificado</label><input class="field-control" id="product-discounted-cost" name="discountedCost" type="number" min="0" step="0.01" value="${product ? value("discountedCost") : "0.00"}" required></div>
      <div class="field"><label for="product-price-with-vat">Precio c/IVA (21%)</label><input class="field-control" id="product-price-with-vat" name="priceWithVat" type="number" min="0" step="0.01" value="${product ? value("priceWithVat") : "0.00"}" required></div>
      <div class="field"><label for="product-profit-percent">% de ganancia</label><input class="field-control" id="product-profit-percent" name="profitPercent" type="number" min="-100" max="10000" step="0.01" value="${product ? value("profitPercent") : "0"}" required></div>
      <div class="field"><label for="product-guild-discount">% desc. gremio</label><input class="field-control" id="product-guild-discount" name="guildDiscountPercent" type="number" min="0" max="100" step="0.01" value="${product ? value("guildDiscountPercent") : "0"}"></div>
      <div class="field field-full"><label for="product-price">PV público / Precio 1</label><input class="field-control" id="product-price" name="price" type="number" min="0" step="1" value="${product ? Math.round(product.price) : "0"}" required></div>
      <div class="field"><label for="product-price2">Precio 2</label><input class="field-control" id="product-price2" name="price2" type="number" min="0" step="1" value="${product ? Math.round(product.price2) : "0"}" required></div>
      <div class="field"><label for="product-price3">Precio 3</label><input class="field-control" id="product-price3" name="price3" type="number" min="0" step="1" value="${product ? Math.round(product.price3) : "0"}" required></div>
      <div class="field"><label for="product-stock">Stock actual</label><input class="field-control" id="product-stock" name="stock" type="number" step="0.001" value="${product ? value("stock") : "0"}" required></div>
      <div class="field"><label for="product-minimum">Avisarme cuando llegue a</label><input class="field-control" id="product-minimum" name="minimumStock" type="number" min="0" step="0.001" value="${product ? value("minimumStock") : "0"}" required></div>
      <div class="field field-full"><span class="field-help">Los precios de venta se expresan en pesos enteros. Los importes se calculan inicialmente con bonificación, IVA del 21% y ganancia; si editás un importe calculado, se actualizarán los campos relacionados.</span></div>
      <div class="field field-full"><span class="field-help">${product ? "El stock puede ser negativo si vendiste más unidades de las disponibles." : "El stock también se actualiza cuando registrás compras y ventas."}</span></div>
    </div>
    <p class="modal-error" id="modal-error" role="alert"></p>`,
    `<button class="button button-secondary" type="button" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">${product ? "Guardar cambios" : "Guardar producto"}</button>`);
  $("#modal").dataset.lockedProductModal = "true";
  $(".modal-close").hidden = true;
  $("#product-sku").focus();
}

function updateProductPricing(changedField) {
  const cost = Number($("#product-cost").value) || 0;
  let bonusPercent = Number($("#product-bonus-percent").value) || 0;
  let discountedCost = Number($("#product-discounted-cost").value) || 0;
  let priceWithVat = Number($("#product-price-with-vat").value) || 0;
  let profitPercent = Number($("#product-profit-percent").value) || 0;
  let publicPrice = Number($("#product-price").value) || 0;

  if (changedField === "product-cost" || changedField === "product-bonus-percent") {
    discountedCost = Math.round(cost * (1 - bonusPercent / 100) * 100) / 100;
    priceWithVat = Math.round(discountedCost * 1.21 * 100) / 100;
    publicPrice = Math.round(priceWithVat * (1 + profitPercent / 100));
  } else if (changedField === "product-discounted-cost") {
    priceWithVat = Math.round(discountedCost * 1.21 * 100) / 100;
    publicPrice = Math.round(priceWithVat * (1 + profitPercent / 100));
  } else if (changedField === "product-price-with-vat") {
    publicPrice = Math.round(priceWithVat * (1 + profitPercent / 100));
  } else if (changedField === "product-profit-percent") {
    publicPrice = Math.round(priceWithVat * (1 + profitPercent / 100));
  } else if (changedField === "product-price" && priceWithVat > 0) {
    profitPercent = Math.round((publicPrice / priceWithVat - 1) * 10000) / 100;
    $("#product-profit-percent").value = profitPercent.toFixed(2);
  }

  if (changedField !== "product-discounted-cost") {
    $("#product-discounted-cost").value = discountedCost.toFixed(2);
  }
  if (changedField !== "product-price-with-vat") {
    $("#product-price-with-vat").value = priceWithVat.toFixed(2);
  }
  if (changedField !== "product-price") {
    $("#product-price").value = publicPrice.toFixed(0);
  }
  if ($("#modal-form").dataset.isNewProduct === "true") {
    for (const id of ["product-price2", "product-price3"]) {
      const field = $(`#${id}`);
      if (field && field.dataset.touched !== "true") field.value = publicPrice.toFixed(0);
    }
  }
}

function recipeProductOptions(selectedId = "", recipeId = "") {
  const usedAsIngredient = new Set(state.recipes
    .filter((recipe) => recipe.id !== Number(recipeId))
    .flatMap((recipe) => recipe.components.map((component) => component.productId)));
  const existingRecipeProducts = new Set(state.recipes
    .filter((recipe) => recipe.id !== Number(recipeId))
    .map((recipe) => recipe.productId));
  const options = state.products.filter((product) =>
    product.active && !existingRecipeProducts.has(product.id) && !usedAsIngredient.has(product.id)
  );
  return `<option value="">Elegí el producto elaborado</option>${options.map((product) =>
    `<option value="${product.id}" ${String(product.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(product.name)} · ${escapeHtml(product.sku)}</option>`
  ).join("")}${recipeId ? "" : '<option value="new">Crear un producto nuevo…</option>'}`;
}

function openRecipeModal(recipe = null) {
  const form = $("#modal-form");
  form.dataset.kind = recipe ? "recipe-edit" : "recipe";
  form.dataset.recipeId = recipe?.id || "";
  const productId = recipe?.productId || "";
  const components = recipe?.components || [{ quantity: 1 }, { quantity: 1 }];
  showModal(recipe ? "Editar receta" : "Nueva receta", "PRODUCTO ELABORADO", `
    <p class="transaction-intro">Indicá cuántas unidades de cada ingrediente se descuentan por cada unidad vendida del producto elaborado.</p>
    <div class="field"><label for="recipe-product">Producto elaborado</label><select class="field-control" id="recipe-product" required>${recipeProductOptions(productId, recipe?.id || "")}</select></div>
    <div id="recipe-new-product" class="field-grid recipe-new-product" hidden>
      <div class="field"><label for="recipe-new-sku">Código / SKU *</label><input class="field-control" id="recipe-new-sku" maxlength="40" value="${escapeHtml(generateProductSku())}" required disabled></div>
      <div class="field"><label for="recipe-new-price">Precio de venta *</label><input class="field-control" id="recipe-new-price" type="number" min="0" step="1" required disabled></div>
      <div class="field field-full"><label for="recipe-new-name">Nombre del producto *</label><input class="field-control" id="recipe-new-name" maxlength="120" required disabled></div>
      <div class="field"><label for="recipe-new-category">Categoría</label><input class="field-control" id="recipe-new-category" maxlength="80"></div>
      <div class="field"><label for="recipe-new-cost">Costo unitario</label><input class="field-control" id="recipe-new-cost" type="number" min="0" step="0.01" value="0"></div>
    </div>
    <div class="item-editor">
      <div class="item-editor-header"><span class="item-editor-title">Ingredientes</span><button class="add-line" type="button" data-action="add-recipe-component">+ Agregar ingrediente</button></div>
      <div id="recipe-components">${components.map((component, index) => recipeComponentLine(index, component, productId)).join("")}</div>
    </div>
    <p class="modal-error" id="modal-error" role="alert"></p>`,
    `<button class="button button-secondary" type="button" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">${recipe ? "Guardar cambios" : "Guardar receta"}</button>`);
  $("#recipe-product").focus();
}

function transactionLine(index) {
  return `<div class="item-line purchase-item-line" data-line="${index}">
    <div class="field"><label for="item-name-${index}">Producto / descripción</label><input class="field-control item-name" id="item-name-${index}" maxlength="120" placeholder="Escribí el producto comprado" required></div>
    <div class="field"><label for="item-sku-${index}">SKU del catálogo (opcional)</label><input class="field-control item-sku" id="item-sku-${index}" maxlength="40" placeholder="Solo si querés actualizar stock"></div>
    <div class="field"><label for="item-price-${index}">Precio de compra</label><input class="field-control item-price" id="item-price-${index}" type="number" min="0" step="0.01" value="0.00" required></div>
    <div class="field"><label for="item-quantity-${index}">Cantidad</label><input class="field-control item-quantity" id="item-quantity-${index}" type="number" min="0.001" step="0.001" value="1" required></div>
    <button class="remove-line" type="button" data-action="remove-line" aria-label="Quitar producto">×</button>
  </div>`;
}

async function openTransactionModal(kind) {
  if (kind === "sale") return;
  const contactLabel = "Proveedor / comercio";
  $("#modal-form").dataset.kind = kind;
  showModal("Registrar una compra", "COMPRAS", `
    <p class="transaction-intro">Registrá quién te vendió, dónde compraste y el precio real. Podés adjuntar el comprobante original (PDF o imagen, hasta 5 MB).</p>
    <div class="field-grid">
      <div class="field"><label for="transaction-contact">${contactLabel} *</label><input class="field-control" id="transaction-contact" maxlength="120" placeholder="Nombre del proveedor" required></div>
      <div class="field"><label for="purchase-place">Lugar de compra</label><input class="field-control" id="purchase-place" maxlength="200" placeholder="Local, dirección o plataforma"></div>
      <div class="field field-full"><label for="purchase-document">Comprobante de compra</label><input class="field-control" id="purchase-document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"><span class="field-help">PDF, JPG, PNG o WebP · máximo 5 MB · se guarda localmente en esta computadora.</span></div>
    </div>
    <div class="item-editor">
      <div class="item-editor-header"><span class="item-editor-title">Productos comprados</span><button class="add-line" type="button" data-action="add-line">+ Agregar artículo</button></div>
      <div id="item-lines">${transactionLine(0)}</div>
    </div>
    <div class="transaction-total"><span>Total estimado</span><strong id="transaction-total">${formatMoney(0)}</strong></div>
    <p class="field-help">Escribí cada producto manualmente. Si ingresás el SKU exacto de un producto del catálogo, la compra también actualizará su stock; sin SKU, el artículo solo quedará en el historial.</p>
    <p class="modal-error" id="modal-error" role="alert"></p>`,
    '<button class="button button-secondary" type="button" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">Guardar movimiento</button>');
  $("#modal-form").dataset.kind = kind;
  $("#transaction-contact").focus();
  updateTransactionPreview();
}

function updateTransactionPreview() {
  const kind = $("#modal-form").dataset.kind;
  if (kind !== "sale" && kind !== "purchase") return;
  let total = 0;
  $$(".item-line", $("#modal-body")).forEach((line) => {
    const quantity = Number($(".item-quantity", line).value) || 0;
    const unitPrice = Number($(".item-price", line).value) || 0;
    if ($(".item-name", line).value.trim() && quantity > 0) total += quantity * unitPrice;
  });
  $("#transaction-total").textContent = formatMoney(total);
  $$(".remove-line", $("#modal-body")).forEach((button) => {
    button.disabled = $$(".item-line", $("#modal-body")).length === 1;
    button.title = button.disabled ? "Agregá otro producto para quitar esta fila" : "Quitar producto";
  });
}

async function submitAuth(form, endpoint, errorSelector, mapBody) {
  const errorElement = $(errorSelector);
  errorElement.textContent = "";
  const submit = $('button[type="submit"]', form);
  submit.disabled = true;
  try {
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(mapBody(new FormData(form))) });
    await showApp(data.user);
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.classList.toggle("subscription-cancelled-message", Boolean(error.subscriptionCancelled));
  } finally {
    submit.disabled = false;
  }
}

$("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuth(event.currentTarget, "/api/login", "#login-error", (form) => ({
    username: form.get("username"),
    password: form.get("password")
  }));
});

function loadOrderForBilling(order) {
  state.activeOrderId = order.id;
  state.selectedCustomerId = order.customerId;
  state.generalDiscountPercent = String(order.generalDiscountPercent || 0);
  state.salesCart = order.items.map((item) => ({
    productId: item.productId,
    priceTier: item.priceTier,
    unitPrice: String(item.unitPrice),
    quantity: String(item.quantity),
    discountPercent: String(item.discountPercent)
  }));
  state.salePayments = [{ method: "cash", amount: "0.00" }];
  state.saleMode = "paid";
  state.cashReceived = "0";
  setPage("sales");
}

document.addEventListener("click", async (event) => {
  if (state.onlineVerificationLocked) {
    const retryButton = event.target.closest('[data-action="retry-online-verification"]');
    if (!retryButton) return;
    retryButton.disabled = true;
    try {
      await verifyOnlineAccess();
    } finally {
      retryButton.disabled = false;
    }
    return;
  }
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    setPage(pageButton.dataset.page);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const { action } = actionButton.dataset;
  if (action === "toggle-theme") {
    toggleTheme();
    return;
  }
  if (action === "retry-start") {
    $("#launch-title").textContent = "Iniciá la aplicación para continuar.";
    $("#launch-message").textContent = "Estamos comprobando la conexión con el servidor.";
    $("#launch-retry").hidden = true;
    await start();
  }
  if (action === "toggle-camera-scanner") {
    try {
      if (state.cameraScannerActive) showCameraScanner();
      else await startCameraScanner();
    } catch (error) {
      notify(error.message, true);
    }
    return;
  }
  if (action === "hide-camera-scanner") {
    hideCameraScanner();
    return;
  }
  if (action === "stop-camera-scanner") {
    stopCameraScanner();
    return;
  }
  if (action === "assign-user-branch") {
    const userId = Number(actionButton.dataset.id);
    const branchId = Number($(`.branch-user-select[data-user-id="${userId}"]`)?.value);
    try {
      await api(`/api/branches/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ branchId })
      });
      notify("Sucursal del usuario actualizada.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
    return;
  }
  if (action === "new-product") openProductModal();
  if (action === "new-quote") {
    setPage("quotes");
  }
  if (action === "print-quote") {
    window.open(branchDocumentUrl(`/quotes/${Number(actionButton.dataset.id)}`), "_blank", "noopener");
  }
  if (action === "convert-quote") {
    const quote = state.quotes.find((item) => item.id === Number(actionButton.dataset.id));
    if (quote) openQuoteConversionModal(quote);
  }
  if (action === "cancel-quote") {
    const quote = state.quotes.find((item) => item.id === Number(actionButton.dataset.id));
    if (!quote || !window.confirm(`¿Cancelar el presupuesto ${quote.number}?`)) return;
    try {
      const result = await api(`/api/quotes/${quote.id}`, { method: "DELETE" });
      notify(result.offlineQueued
        ? "Cancelación guardada en este dispositivo; se sincronizará al volver a estar online."
        : "Presupuesto cancelado.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "add-quote-line") {
    const lines = $("#quote-lines");
    const index = $$(".quote-editor-line", lines).length;
    if (index >= 100) {
      notify("Un presupuesto admite hasta 100 artículos.", true);
      return;
    }
    lines.insertAdjacentHTML("beforeend", quoteEditorLine(index));
    updateQuotePreview();
  }
  if (action === "remove-quote-line") {
    const lines = $("#quote-lines");
    if ($$(".quote-editor-line", lines).length > 1) {
      actionButton.closest(".quote-editor-line").remove();
      updateQuotePreview();
    }
  }
  if (action === "select-quote-product") {
    state.selectedQuoteProductId = Number(actionButton.dataset.id) || null;
    const product = state.products.find((item) => item.id === state.selectedQuoteProductId);
    if (product) {
      $("#quote-product-search").value = product.name;
      $("#quote-product-search").setAttribute("aria-expanded", "false");
      $("#quote-search-results").hidden = true;
      updateQuoteSelectedProduct();
    }
  }
  if (action === "add-quote-product") {
    const product = state.products.find((item) => item.id === state.selectedQuoteProductId);
      const quantityField = $("#quote-product-quantity");
      const discountField = $("#quote-product-discount");
      if (!product) {
        notify("Elegí un producto del catálogo para agregarlo.", true);
        return;
      }
      if (!quantityField.reportValidity() || !discountField.reportValidity()) return;
      const tier = Number($("#quote-product-tier").value);
      state.quoteCart.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        priceTier: tier,
        unitPrice: String(product[`price${tier === 1 ? "" : tier}`] ?? product.price),
        quantity: quantityField.value,
        discountPercent: discountField.value || "0"
      });
      state.selectedQuoteProductId = null;
      $("#quote-product-search").value = "";
      $("#quote-product-search").setAttribute("aria-expanded", "false");
      $("#quote-search-results").hidden = true;
      updateQuoteSelectedProduct();
      quantityField.value = "1";
      discountField.value = "0";
      renderQuoteCart();
  }
    if (action === "add-custom-quote-item") {
      const name = $("#quote-custom-name");
      const price = $("#quote-custom-price");
      const quantity = $("#quote-custom-quantity");
      const discount = $("#quote-custom-discount");
      if (!name.value.trim()) {
        name.setCustomValidity("Ingresá una descripción.");
        name.reportValidity();
        name.setCustomValidity("");
        return;
      }
      if (!price.reportValidity() || !quantity.reportValidity() || !discount.reportValidity()) return;
      state.quoteCart.push({
        custom: true, name: name.value.trim(), sku: "",
        unitPrice: price.value, quantity: quantity.value, discountPercent: discount.value || "0"
      });
      name.value = "";
      price.value = "0.00";
      quantity.value = "1";
      discount.value = "0";
      renderQuoteCart();
    }
    if (action === "remove-quote-product") {
      state.quoteCart.splice(Number(actionButton.dataset.index), 1);
      renderQuoteCart();
    }
    if (action === "save-quote") {
      if (!$("#quote-contact").reportValidity() || !$("#quote-valid-until").reportValidity() ||
          !$("#quote-general-discount").reportValidity()) return;
      if (!state.quoteCart.length) {
        notify("Agregá al menos un artículo antes de guardar el presupuesto.", true);
        return;
      }
      for (const field of $$(".quote-cart-price, .quote-cart-quantity, .quote-cart-discount")) {
        if (!field.reportValidity()) return;
      }
      actionButton.disabled = true;
      try {
        const result = await api("/api/quotes", {
          method: "POST",
          body: JSON.stringify({
            contact: $("#quote-contact").value,
            validUntil: $("#quote-valid-until").value,
            contactTaxId: $("#quote-tax-id").value,
            contactVatCondition: $("#quote-vat").value,
            contactAddress: $("#quote-address").value,
            contactPhone: $("#quote-phone").value,
            contactEmail: $("#quote-email").value,
            generalDiscountPercent: $("#quote-general-discount").value,
            items: state.quoteCart.map((item) => ({
              custom: Boolean(item.custom),
              name: item.custom ? item.name : undefined,
              productId: item.custom ? undefined : item.productId,
              priceTier: item.priceTier || 1,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              discountPercent: item.discountPercent
            }))
          })
        });
        state.quoteCart = [];
        if (result.offlineQueued) {
          notify("Presupuesto guardado en este dispositivo; se sincronizará al volver a estar online.");
          await renderPage();
          return;
        }
        notify(`Presupuesto ${result.quote.number} guardado por ${formatMoney(result.quote.total)}.`);
        await renderPage();
      } catch (error) {
        notify(error.message, true);
        actionButton.disabled = false;
      }
  }
  if (action === "choose-stock-file") $("#stock-import-file").click();
  if (action === "choose-backup-file") $("#backup-restore-file").click();
  if (action === "save-user-role") {
    const userId = Number(actionButton.dataset.id);
    const role = $(`.admin-user-role[data-id="${userId}"]`).value;
    try {
      await api(`/api/admin/users/${userId}`, { method: "PUT", body: JSON.stringify({ role }) });
      notify("Permisos actualizados.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "delete-user") {
    const row = actionButton.closest("tr");
    const email = $("td", row).textContent.replace(" (vos)", "");
    if (!window.confirm(`¿Eliminar la cuenta ${email}? Sus sesiones activas se cerrarán.`)) return;
    try {
      await api(`/api/admin/users/${Number(actionButton.dataset.id)}`, { method: "DELETE" });
      notify("Usuario eliminado.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "new-recipe") openRecipeModal();
  if (action === "edit-recipe") {
    const recipe = state.recipes.find((item) => item.id === Number(actionButton.dataset.id));
    if (recipe) openRecipeModal(recipe);
  }
  if (action === "add-recipe-component") {
    const lines = $("#recipe-components");
    const components = $$(".recipe-component-line", lines);
    if (components.length >= 50) {
      notify("Una receta admite hasta 50 ingredientes.", true);
      return;
    }
    const index = components.length;
    lines.insertAdjacentHTML("beforeend", recipeComponentLine(index, {}, $("#recipe-product").value));
  }
  if (action === "remove-recipe-component") {
    const lines = $("#recipe-components");
    if ($$(".recipe-component-line", lines).length <= 2) {
      notify("Una receta debe tener por lo menos dos ingredientes.", true);
      return;
    }
    actionButton.closest(".recipe-component-line").remove();
    $$(".recipe-component-line", lines).forEach((line, index) => {
      const label = $("label", line);
      const select = $(".recipe-ingredient", line);
      const quantity = $(".recipe-quantity", line);
      label.htmlFor = `recipe-ingredient-${index}`;
      label.textContent = `Ingrediente ${index + 1}`;
      select.id = `recipe-ingredient-${index}`;
      quantity.id = `recipe-quantity-${index}`;
      $("label[for^='recipe-quantity-']", line).htmlFor = quantity.id;
    });
  }
  if (action === "delete-recipe") {
    const recipe = state.recipes.find((item) => item.id === Number(actionButton.dataset.id));
    if (!recipe || !window.confirm(`¿Borrar la receta de "${recipe.productName}"? Las ventas ya registradas conservarán el detalle de inventario necesario para poder revertirlas.`)) return;
    actionButton.disabled = true;
    try {
      await api(`/api/recipes/${recipe.id}`, { method: "DELETE" });
      notify(`Receta de ${recipe.productName} borrada.`);
      await renderPage();
    } catch (error) {
      actionButton.disabled = false;
      notify(error.message, true);
    }
  }
  if (action === "clear-receipt-logo") {
    state.receiptLogoDataUri = "";
    const preview = $("#receipt-logo-preview");
    preview.removeAttribute("src");
    preview.hidden = true;
    $("#receipt-logo").value = "";
  }
  if (action === "edit-product") {
    const product = state.products.find((item) => item.id === Number(actionButton.dataset.id));
    if (product) openProductModal(product);
  }
  if (action === "new-sale") {
    setPage("sales");
  } else if (action === "new-purchase") {
    try {
      await openTransactionModal("purchase");
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "go-cash") setPage("cashRegister");
  if (action === "add-order-item") {
    const product = state.products.find((item) => item.id === state.selectedOrderProductId);
    if (!product || !$("#order-quantity-new").reportValidity() || !$("#order-price").reportValidity()) {
      notify("Elegí un producto e indicá una cantidad y un precio válidos.", true);
      return;
    }
    const tier = Number($("#order-tier").value);
    state.orderCart.push({
      productId: product.id,
      priceTier: tier,
      unitPrice: $("#order-price").value,
      quantity: $("#order-quantity-new").value,
      discountPercent: "0"
    });
    state.selectedOrderProductId = null;
    $("#order-product-search").value = "";
    $("#order-product-search").setAttribute("aria-expanded", "false");
    $("#order-search-results").hidden = true;
    $("#order-tier").value = "1";
    $("#order-quantity-new").value = "1";
    $("#order-price").value = "0.00";
    await renderPage();
  }
  if (action === "remove-order-item") {
    state.orderCart.splice(Number(actionButton.dataset.index), 1);
    await renderPage();
  }
  if (action === "save-order") {
    const customerId = Number($("#order-customer").value) || null;
    const customer = state.customers.find((entry) => entry.id === customerId);
    if (!customer && !$("#order-contact").reportValidity()) return;
    if (!state.orderCart.length) {
      notify("Agregá al menos un producto al pedido.", true);
      return;
    }
    actionButton.disabled = true;
    try {
      const result = await api("/api/sales-orders", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          contact: customer?.name || $("#order-contact").value,
          generalDiscountPercent: $("#order-general-discount").value,
          items: state.orderCart
        })
      });
      state.orderCart = [];
      state.orderGeneralDiscountPercent = "0";
      notify(result.offlineQueued
        ? "Pedido guardado en este dispositivo; se sincronizará al volver a estar online."
        : `Pedido ${result.order.number} guardado y asignado a ${result.order.createdBy}.`);
      await renderPage();
    } catch (error) {
      notify(error.message, true);
      actionButton.disabled = false;
    }
  }
  if (action === "invoice-order" || action === "load-order") {
    const orderId = action === "invoice-order"
      ? Number(actionButton.dataset.id)
      : Number($("#facturation-order-select").value);
    const order = state.salesOrders.find((entry) => entry.id === orderId && entry.status === "open");
    if (!order) {
      notify("Elegí un pedido pendiente válido.", true);
      return;
    }
    loadOrderForBilling(order);
    notify(`Pedido ${order.number} cargado. Verificá los medios de pago y registrá la venta.`);
  }
  if (action === "clear-loaded-order") {
    state.activeOrderId = null;
    state.salesCart = [];
    state.generalDiscountPercent = "0";
    state.selectedCustomerId = null;
    state.salePayments = [{ method: "cash", amount: "0" }];
    state.saleMode = "paid";
    state.cashReceived = "0";
    await renderPage();
  }
  if (action === "cancel-order") {
    const orderId = Number(actionButton.dataset.id);
    if (!window.confirm("¿Cancelar este pedido de venta?")) return;
    try {
      await api(`/api/sales-orders/${orderId}`, { method: "DELETE" });
      state.orderCart = [];
      notify("Pedido cancelado.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "open-cash") {
    try {
      await api("/api/cash-register/open", {
        method: "POST",
        body: JSON.stringify({ openingAmount: $("#cash-opening-amount").value })
      });
      notify("Caja abierta. Ya podés registrar ventas.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "collect-account") {
    const row = actionButton.closest("tr");
    const amount = $(".account-payment-amount", row)?.value;
    const method = $(".account-payment-method", row)?.value;
    try {
      await api(`/api/accounts/${Number(actionButton.dataset.id)}/payments`, {
        method: "POST", body: JSON.stringify({ amount, method })
      });
      notify("Cobro aplicado a la cuenta corriente.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "toggle-all-labels") {
    const activeProducts = state.products.filter((p) => p.active);
    const allSelected = activeProducts.length > 0 && activeProducts.every((p) => state.labelSelection.some((e) => e.productId === p.id));
    updateLabelSelection(!allSelected);
  }
  if (action === "copy-mobile-url") {
    const text = $("#mobile-ip-display")?.textContent || "";
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        notify("Dirección IP copiada al portapapeles.");
      }).catch(() => {
        notify("No se pudo copiar automáticamente.", true);
      });
    }
  }
  if (action === "refresh-mobile-connect") {
    await renderMobileConnect($("#page-content"));
  }
  if (action === "test-scanner-scan") {
    const input = $("#test-scanner-input");
    const barcode = input?.value?.trim();
    if (!barcode) {
      notify("Ingresá un código de barras o SKU para probar.", true);
      return;
    }
    try {
      await api("/api/scanner/scan", {
        method: "POST",
        body: JSON.stringify({ barcode })
      });
      notify(`Escaneo de prueba enviado con código: ${barcode}`);
      if (input) input.value = "";
    } catch (err) {
      notify(err.message, true);
    }
  }
  if (action === "print-labels") {
    const selected = state.labelSelection.flatMap((entry) => {
      const product = state.products.find((item) => item.id === entry.productId);
      return product ? Array.from({ length: entry.count }, () => product) : [];
    });
    if (!selected.length) {
      notify("Seleccioná al menos un producto y una cantidad de etiquetas.", true);
      return;
    }
    const labels = selected.map((product) => `<article><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)}${product.barcode ? ` · ${escapeHtml(product.barcode)}` : ""}</small><b>${formatMoney(product.price)}</b></article>`).join("");
    const printSheet = document.createElement("main");
    printSheet.id = "label-print-sheet";
    printSheet.className = "label-print-sheet";
    printSheet.innerHTML = labels;
    document.body.append(printSheet);
    document.body.classList.add("is-printing-labels");
    window.addEventListener("afterprint", () => {
      document.body.classList.remove("is-printing-labels");
      printSheet.remove();
      if (state.user && state.page === "labels") renderPage();
    }, { once: true });
    setTimeout(() => window.print(), 100);
  }
  if (action === "close-cash") {
    try {
      await api("/api/cash-register/close", {
        method: "POST",
        body: JSON.stringify({ closingAmount: $("#cash-closing-amount").value, note: $("#cash-close-note")?.value || "" })
      });
      notify("Caja cerrada correctamente.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "save-customer") {
    const id = Number(actionButton.dataset.id);
    try {
      await api(`/api/customers/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: $(`.customer-name[data-id="${id}"]`).value,
          discountPercent: $(`.customer-discount[data-id="${id}"]`).value,
          phone: $(`.customer-phone[data-id="${id}"]`).value,
          taxId: $(`.customer-tax-id[data-id="${id}"]`).value
        })
      });
      notify("Cliente actualizado.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "archive-customer") {
    const id = Number(actionButton.dataset.id);
    if (!window.confirm("¿Archivar este cliente? No aparecerá en nuevas ventas.")) return;
    try {
      await api(`/api/customers/${id}`, { method: "DELETE" });
      notify("Cliente archivado.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "close-modal") $("#modal").close();
  if (action === "close-update-dialog") $("#update-dialog").close();
  if (action === "toggle-sidebar") {
    if (window.matchMedia("(max-width: 780px)").matches) {
      $("#sidebar").classList.toggle("is-open");
      $("#sidebar-scrim").classList.toggle("is-visible");
    } else {
      const collapsed = $("#sidebar").classList.toggle("is-collapsed");
      localStorage.setItem("tonoto-sidebar-collapsed", String(collapsed));
    }
  }
  if (action === "close-sidebar") {
    $("#sidebar").classList.remove("is-open");
    $("#sidebar-scrim").classList.remove("is-visible");
  }
  if (action === "view-sales") setPage("sales");
  if (action === "retry") renderPage();
  if (action === "show-scope") {
    event.preventDefault();
    showModal("Alcance de esta versión", "TONOTOS GESTIÓN", `
      <p class="transaction-intro">La primera versión permite crear un espacio privado para tu empresa y gestionar un catálogo de productos con código, categoría, costo, precio y existencias.</p>
      <p class="transaction-intro">Podés registrar ventas y compras, consultar el registro diario, aplicar descuentos y armar recetas de productos. Al vender un producto con receta se descuentan sus ingredientes; las ventas pueden dejar saldos negativos que se compensan con compras posteriores.</p>
      <div class="scope-note"><span class="scope-note-icon" aria-hidden="true">i</span><div><strong>Importante para operar en Argentina</strong><p>El comprobante es interno, no es una factura ni un comprobante fiscal de ARCA/AFIP. Esta versión no calcula impuestos, IVA, contabilidad o nómina.</p></div></div>`,
      '<button class="button button-primary" type="button" data-action="close-modal">Entendido</button>');
  }
  if (action === "add-line") {
    const lines = $("#item-lines");
    const nextIndex = lines.querySelectorAll(".item-line").length;
    if (nextIndex >= 100) {
      notify("Una compra admite hasta 100 artículos.", true);
      return;
    }
    lines.insertAdjacentHTML("beforeend", transactionLine(nextIndex));
    updateTransactionPreview();
    $(".item-name", lines.lastElementChild).focus();
  }
  if (action === "remove-line") {
    if ($$(".item-line", $("#modal-body")).length > 1) {
      actionButton.closest(".item-line").remove();
      updateTransactionPreview();
    }
  }
  if (action === "select-sale-product") {
    const product = state.products.find((item) => item.id === Number(actionButton.dataset.id));
    if (!product) return;
    state.selectedSaleProductId = product.id;
    state.salePriceTier = 1;
    $("#sale-product-search").value = `${product.name} · ${product.sku}`;
    $("#sale-product-search").setAttribute("aria-expanded", "false");
    $("#sale-search-results").hidden = true;
    const recipe = state.recipes.find((entry) => entry.productId === product.id);
    $("#sale-selected-product").innerHTML = `<strong>${escapeHtml(product.name)}</strong><span class="sale-selected-sku">${escapeHtml(product.sku)}</span><div class="sale-selected-prices" role="group" aria-label="Elegir precio del producto">${[product.price, product.price2, product.price3].map((price, index) => {
      const tier = index + 1;
      return `<button class="sale-price-option ${tier === state.salePriceTier ? "is-selected" : ""}" type="button" data-action="select-sale-price" data-tier="${tier}" aria-pressed="${tier === state.salePriceTier}"><small>Precio ${tier}</small><strong>${formatMoney(price)}</strong></button>`;
    }).join("")}</div><small>${recipe ? "Se descontarán sus ingredientes según la receta." : `Stock actual: ${formatQuantity(product.stock)} · Podés vender igual si no alcanza.`}</small>`;
    $("#sale-add-product").disabled = false;
    $("#sale-quantity").focus();
  }
  if (action === "select-sale-price") {
    const tier = Number(actionButton.dataset.tier);
    if (![1, 2, 3].includes(tier) || !state.products.some((product) => product.id === state.selectedSaleProductId)) return;
    state.salePriceTier = tier;
    $$(".sale-price-option", $("#sale-selected-product")).forEach((option) => {
      const selected = Number(option.dataset.tier) === tier;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
  }
  if (action === "select-order-product") {
    const product = state.products.find((item) => item.id === Number(actionButton.dataset.id));
    if (!product) return;
    state.selectedOrderProductId = product.id;
    $("#order-product-search").value = `${product.name} · ${product.sku}`;
    $("#order-product-search").setAttribute("aria-expanded", "false");
    $("#order-search-results").hidden = true;
    const tier = Number($("#order-tier").value || 1);
    $("#order-price").value = String(product[`price${tier === 1 ? "" : tier}`] ?? product.price);
    $("#order-quantity-new").focus();
  }
  if (action === "add-sale-product") {
    const product = state.products.find((item) => item.id === state.selectedSaleProductId);
    if (!product) {
      notify("Buscá y elegí un producto antes de agregarlo.", true);
      return;
    }
    const quantityField = $("#sale-quantity");
    const discountField = $("#sale-discount");
    if (!quantityField.reportValidity() || !discountField.reportValidity()) return;
    const quantity = Number(quantityField.value);
    const discountPercent = Number(discountField.value);
    const priceTier = Number(state.salePriceTier || 1);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      notify("Ingresá una cantidad entera mayor que cero.", true);
      quantityField.focus();
      return;
    }
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      notify("El descuento debe estar entre 0 % y 100 %.", true);
      discountField.focus();
      return;
    }
    const existing = state.salesCart.find((item) => item.productId === product.id && item.priceTier === priceTier);
    if (existing) {
      const previousQuantity = Number(existing.quantity);
      const totalQuantity = previousQuantity + quantity;
      existing.discountPercent = String(Math.round(
        (Number(existing.discountPercent) * (previousQuantity / totalQuantity) +
          discountPercent * (quantity / totalQuantity)) * 100
      ) / 100);
      existing.quantity = String(totalQuantity);
    } else {
      state.salesCart.push({
        productId: product.id,
        priceTier,
        unitPrice: String(product[`price${priceTier === 1 ? "" : priceTier}`] ?? product.price),
        quantity: String(quantityField.value),
        discountPercent: String(discountField.value || "0")
      });
    }
    state.selectedSaleProductId = null;
    state.salePriceTier = 1;
    $("#sale-product-search").value = "";
    $("#sale-product-search").setAttribute("aria-expanded", "false");
    $("#sale-search-results").hidden = true;
    $("#sale-selected-product").innerHTML = "<span>Seleccioná un producto para agregarlo a la venta.</span>";
    $("#sale-quantity").value = "1";
    $("#sale-discount").value = "0";
    $("#sale-add-product").disabled = true;
    renderSalesCart();
    $("#sale-product-search").focus();
  }
  if (action === "add-custom-sale-item") {
    const nameField = $("#custom-sale-name");
    const priceField = $("#custom-sale-price");
    const quantityField = $("#custom-sale-quantity");
    const discountField = $("#custom-sale-discount");
    if (!nameField.reportValidity() || !priceField.reportValidity() ||
        !quantityField.reportValidity() || !discountField.reportValidity()) return;
    const name = nameField.value.trim();
    const price = amountToCents(priceField.value);
    const quantity = Number(quantityField.value);
    const discount = Number(discountField.value);
    if (!name || name.length > 120 || price === null || !Number.isSafeInteger(quantity) ||
        quantity <= 0 || !Number.isFinite(discount) || discount < 0 || discount > 100) {
      notify("Revisá la descripción, el precio, la cantidad y el descuento del artículo libre.", true);
      return;
    }
    state.salesCart.push({
      customName: name,
      customItemId: state.nextCustomSaleItemId++,
      unitPrice: priceField.value,
      quantity: quantityField.value,
      discountPercent: discountField.value || "0",
      priceTier: 1
    });
    nameField.value = "";
    priceField.value = "0.00";
    quantityField.value = "1";
    discountField.value = "0";
    renderSalesCart();
  }
  if (action === "remove-sale-product") {
    state.salesCart.splice(Number(actionButton.dataset.index), 1);
    renderSalesCart();
  }
  if (action === "add-payment") {
    if (state.salePayments.length >= Object.keys(paymentMethods).length) {
      notify("Ya agregaste todos los medios de pago disponibles.", true);
      return;
    }
    const used = new Set(state.salePayments.map((payment) => payment.method));
    const nextMethod = Object.keys(paymentMethods).find((method) => !used.has(method));
    if (!nextMethod) return;
    state.salePayments.push({ method: nextMethod, amount: "0.00" });
    renderPaymentRows();
    updateSalesSummary();
  }
  if (action === "remove-payment") {
    const index = Number(actionButton.dataset.index);
    if (state.salePayments.length > 1 && Number.isInteger(index)) {
      state.salePayments.splice(index, 1);
      renderPaymentRows();
      updateSalesSummary();
    }
  }
  if (action === "print-sale") {
    const sale = state.salesHistory.find((transaction) => transaction.id === Number(actionButton.dataset.id));
    if (!sale) {
      notify("No encontramos los detalles de esta venta. Actualizá la página e intentá de nuevo.", true);
      return;
    }
    if (!openReceiptWindow(sale)) {
      notifyReceiptLink(sale, `Venta ${sale.number}. No se pudo abrir una ventana nueva.`);
    }
  }
  if (action === "delete-sale") {
    const sale = state.salesHistory.find((transaction) => transaction.id === Number(actionButton.dataset.id));
    if (!sale || !window.confirm(`¿Borrar la venta ${sale.number} de ${formatMoney(sale.total)}? Se eliminará el comprobante, se devolverán al inventario los productos o ingredientes descontados y su número quedará disponible para volver a usarse.`)) return;
    actionButton.disabled = true;
    try {
      const result = await api(`/api/transactions/${sale.id}`, { method: "DELETE" });
      state.salesHistory = state.salesHistory.filter((transaction) => transaction.id !== sale.id);
      notify(result.offlineQueued
        ? `Borrado de la venta ${sale.number} guardado para sincronizar.`
        : `Venta ${sale.number} borrada y el inventario fue actualizado.`);
      await renderPage();
    } catch (error) {
      actionButton.disabled = false;
      notify(error.message, true);
    }
  }
  if (action === "complete-sale") {
    if (!$("#sale-contact").reportValidity() || !$("#sale-general-discount").reportValidity()) return;
    for (const field of $$(".cart-quantity, .cart-discount, .cart-price")) {
      if (!field.reportValidity()) return;
    }
    if (!state.salesCart.length) {
      notify("Agregá al menos un producto antes de registrar la venta.", true);
      return;
    }
    if (state.saleMode !== "paid" && !state.selectedCustomerId) {
      notify("Elegí un cliente registrado para guardar la seña o el saldo en cuenta corriente.", true);
      return;
    }
    syncPaymentBalance();
    if (!paymentsMatchTotal()) {
      notify(state.saleMode === "paid"
        ? "La suma de los medios de pago debe coincidir con el total de la venta."
        : "Revisá el importe abonado; no puede superar el total y la seña debe ser mayor que cero.", true);
      return;
    }
    const receiptWindow = window.open("about:blank", "_blank");
    actionButton.disabled = true;
    try {
      const orderId = state.activeOrderId;
      const salePayload = orderId
        ? {
          saleMode: state.saleMode,
          items: state.salesCart.map((item) => ({
            productId: item.productId,
            unitPrice: item.unitPrice,
            priceTier: item.priceTier || 1,
            quantity: item.quantity,
            discountPercent: item.discountPercent || "0"
          })),
          payments: state.salePayments.map((payment) => ({ method: payment.method, amount: payment.amount }))
        }
        : {
          saleMode: state.saleMode,
          customerId: state.selectedCustomerId,
          contact: $("#sale-contact").value.trim() || "Consumidor final",
          contactTaxId: $("#sale-contact-tax-id").value,
          contactVatCondition: $("#sale-contact-vat").value,
          contactAddress: $("#sale-contact-address").value,
          contactPhone: $("#sale-contact-phone").value,
          contactEmail: $("#sale-contact-email").value,
          generalDiscountPercent: state.generalDiscountPercent,
          items: state.salesCart.map((item) => ({
            productId: item.productId,
            custom: Boolean(item.customName),
            name: item.customName,
            unitPrice: item.unitPrice,
            priceTier: item.priceTier || 1,
            quantity: item.quantity,
            discountPercent: item.discountPercent || "0"
          })),
          payments: state.salePayments.map((payment) => ({
            method: payment.method,
            amount: payment.amount
          }))
        };
      const result = await api(orderId ? `/api/sales-orders/${orderId}/convert` : "/api/sales", {
        method: "POST",
        body: JSON.stringify(salePayload)
      });
      state.salesCart = [];
      state.activeOrderId = null;
      state.selectedCustomerId = null;
      state.salePayments = [{ method: "cash", amount: "0" }];
      state.saleMode = "paid";
      state.cashReceived = "0";
      state.generalDiscountPercent = "0";
      state.selectedSaleProductId = null;
      if (result.offlineQueued) {
        if (receiptWindow) receiptWindow.close();
        notify("Venta guardada en este dispositivo; se sincronizará al volver a estar online.");
        await renderPage();
        return;
      }
      if (receiptWindow) {
        receiptWindow.location.replace(branchDocumentUrl(`/receipts/${result.transaction.id}`));
      }
      notifyReceiptLink(result.transaction, `Venta ${result.transaction.number} registrada por ${formatMoney(result.transaction.total)}.`);
      await renderPage();
    } catch (error) {
      if (receiptWindow && !receiptWindow.closed) receiptWindow.close();
      notify(error.message, true);
      actionButton.disabled = false;
    }
  }
  if (action === "archive-product") {
    const product = state.products.find((item) => item.id === Number(actionButton.dataset.id));
    if (!product || !window.confirm(`¿Archivar "${product.name}"? No estará disponible para nuevas ventas o compras; su historial se conservará.`)) return;
    try {
      const result = await api(`/api/products/${product.id}`, { method: "DELETE" });
      notify(result.offlineQueued
        ? "Archivo guardado en este dispositivo; se sincronizará al volver a estar online."
        : "Producto archivado. El historial de movimientos se conservó.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
  }
  if (action === "logout") {
    try {
      await api("/api/logout", { method: "POST" });
      showAuth({ needsSetup: false, error: "Copia restaurada. Iniciá sesión con una cuenta incluida en ese respaldo." });
    } catch (error) {
      notify(error.message, true);
    }
  }

});

document.addEventListener("input", (event) => {
  if (event.target.id === "label-search") {
    const query = normalizeProductSearch(event.target.value);
    $$("#page-content tbody tr[data-label-search]").forEach((row) => {
      row.hidden = !row.dataset.labelSearch.includes(query);
    });
  }
  if (event.target.closest("#quote-lines") ||
      ["quote-general-discount", "quote-contact"].includes(event.target.id)) updateQuotePreview();
  if (event.target.matches(".quote-cart-price, .quote-cart-quantity, .quote-cart-discount")) {
    const item = state.quoteCart[Number(event.target.dataset.index)];
    if (item) {
      if (event.target.matches(".quote-cart-price")) item.unitPrice = event.target.value;
      if (event.target.matches(".quote-cart-quantity")) item.quantity = event.target.value;
      if (event.target.matches(".quote-cart-discount")) item.discountPercent = event.target.value;
    }
    updateQuotePreview();
  }
  if (["product-price2", "product-price3"].includes(event.target.id)) {
    event.target.dataset.touched = "true";
  }
  if ([
    "product-cost", "product-bonus-percent", "product-discounted-cost",
    "product-price-with-vat", "product-profit-percent", "product-price"
  ].includes(event.target.id)) {
    updateProductPricing(event.target.id);
  }
  if (event.target.id === "product-search") {
    filterProductRows();
  }
  if (event.target.id === "sale-product-search") {
    state.selectedSaleProductId = null;
    $("#sale-product-search").setAttribute("aria-expanded", "true");
    $("#sale-selected-product").innerHTML = "<span>Elegí un producto de la lista de resultados.</span>";
    $("#sale-add-product").disabled = true;
    saleSearchResults(event.target.value);
  }
  if (event.target.id === "order-product-search") {
    state.selectedOrderProductId = null;
    event.target.setAttribute("aria-expanded", "true");
    orderProductSearchResults(event.target.value);
  }
  if (event.target.id === "quote-product-search") {
    state.selectedQuoteProductId = null;
    event.target.setAttribute("aria-expanded", "true");
    updateQuoteSelectedProduct();
    quoteSearchResults(event.target.value);
  }
  if (event.target.matches(".cart-quantity")) {
    const item = state.salesCart[Number(event.target.dataset.index)];
    if (item) item.quantity = event.target.value;
    updateSalesSummary();
  }
  if (event.target.matches(".cart-discount")) {
    const item = state.salesCart[Number(event.target.dataset.index)];
    if (item) item.discountPercent = event.target.value;
    updateSalesSummary();
  }
  if (event.target.matches(".cart-price")) {
    const item = state.salesCart[Number(event.target.dataset.index)];
    if (item) item.unitPrice = event.target.value;
    updateSalesSummary();
  }
  if (event.target.matches(".payment-amount-field input")) {
    const index = Number(event.target.dataset.paymentIndex);
    if (state.salePayments[index]) {
      state.salePayments[index].amount = event.target.value;
      syncPaymentBalance();
      $("#complete-sale").disabled = !state.salesCart.length || !paymentsMatchTotal();
    }
  }
  if (event.target.id === "sale-cash-received") {
    state.cashReceived = event.target.value;
    updateSalesSummary();
  }
  if (event.target.id === "sale-contact") updateSalesSummary();
  if (event.target.id === "sale-mode") {
    state.saleMode = event.target.value;
    if (state.saleMode === "paid") syncPaymentBalance();
    else state.salePayments = [{ method: "cash", amount: "0.00" }];
    renderPaymentRows();
    updateSalesSummary();
  }
  if (event.target.id === "sale-general-discount") {
    state.generalDiscountPercent = event.target.value;
    updateSalesSummary();
  }
  if (event.target.id === "order-general-discount") state.orderGeneralDiscountPercent = event.target.value;
  if (event.target.matches(".item-name, .item-quantity, .item-price")) updateTransactionPreview();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "label-select-all") {
    updateLabelSelection(event.target.checked);
  }
  if (event.target.id === "product-search-mode") {
    const placeholders = {
      product: "Buscar producto",
      category: "Buscar categoría",
      recipe: "Buscar producto o ingrediente"
    };
    $("#product-search").placeholder = placeholders[event.target.value];
    $("#product-search").setAttribute("aria-label", placeholders[event.target.value]);
    filterProductRows();
  }
  if (event.target.matches(".label-select")) {
    const productId = Number(event.target.dataset.id);
    const countField = $(`.label-count[data-id="${productId}"]`);
    if (event.target.checked) {
      if (!state.labelSelection.some((entry) => entry.productId === productId)) state.labelSelection.push({ productId, count: Number(countField.value) || 1 });
      countField.disabled = false;
    } else {
      state.labelSelection = state.labelSelection.filter((entry) => entry.productId !== productId);
      countField.disabled = true;
    }
    const activeProducts = state.products.filter((product) => product.active);
    const allSelected = activeProducts.length > 0 && activeProducts.every((product) =>
      state.labelSelection.some((entry) => entry.productId === product.id)
    );
    const selectAllCheckbox = $("#label-select-all");
    if (selectAllCheckbox) selectAllCheckbox.checked = allSelected;
    const toggleButton = $("#btn-toggle-all-labels");
    if (toggleButton) toggleButton.textContent = allSelected ? "Deseleccionar todo" : "Seleccionar todo";
    state.labelsTouched = true;
  }
  if (event.target.matches(".label-count")) {
    const productId = Number(event.target.dataset.id);
    const count = Math.min(500, Math.max(1, Number(event.target.value) || 1));
    event.target.value = String(count);
    const selection = state.labelSelection.find((entry) => entry.productId === productId);
    if (selection) selection.count = count;
  }
  if (event.target.id === "sale-customer") {
    state.selectedCustomerId = Number(event.target.value) || null;
    const customer = state.customers.find((entry) => entry.id === state.selectedCustomerId);
    $("#sale-contact").value = customer?.name || "Consumidor final";
    $("#sale-contact-tax-id").value = customer?.taxId || "";
    $("#sale-contact-vat").value = customer?.vatCondition || "Consumidor final";
    $("#sale-contact-address").value = customer?.address || "";
    $("#sale-contact-phone").value = customer?.phone || "";
    $("#sale-contact-email").value = customer?.email || "";
    renderSalesCart();
  }
  if (event.target.id === "order-customer") renderPage();
  if (event.target.matches(".order-quantity") || event.target.id === "order-general-discount") renderPage();
  if (event.target.id === "quote-product-tier") updateQuoteSelectedProduct();
  if (event.target.matches(".quote-product")) {
    const line = event.target.closest(".quote-editor-line");
    const custom = event.target.value === "custom";
    $$(".quote-custom-field", line).forEach((field) => {
      field.hidden = !custom;
      const input = $("input", field);
      input.disabled = !custom;
      input.required = custom;
    });
    $(".quote-tier-field", line).hidden = custom;
    $(".quote-tier", line).disabled = custom;
    const selectedProduct = state.products.find((product) => product.id === Number(event.target.value));
    const tier = Number($(".quote-tier", line).value || 1);
    $(".quote-price", line).value = custom ? "0.00" :
      String(selectedProduct?.[`price${tier === 1 ? "" : tier}`] ?? selectedProduct?.price ?? 0);
    updateQuotePreview();
  }
  if (event.target.matches(".quote-tier")) {
    const line = event.target.closest(".quote-editor-line");
    const product = state.products.find((item) => item.id === Number($(".quote-product", line).value));
    $(".quote-price", line).value = String(product?.[`price${event.target.value === "1" ? "" : event.target.value}`] ?? product?.price ?? 0);
    updateQuotePreview();
  }
  if (event.target.matches(".cart-price-tier")) {
    const item = state.salesCart[Number(event.target.dataset.index)];
    const product = item && state.products.find((entry) => entry.id === item.productId);
    if (item) {
      item.priceTier = Number(event.target.value);
      item.unitPrice = String(product?.[`price${item.priceTier === 1 ? "" : item.priceTier}`] ?? product?.price ?? 0);
    }
    renderSalesCart();
  }
  if (event.target.id === "daily-sales-date" && event.target.value) {
    state.dailySalesDate = event.target.value;
    renderPage();
  }
  if (event.target.id === "recipe-product") {
    const components = $$(".recipe-component-line", $("#recipe-components")).map((line) => ({
      productId: Number($(".recipe-ingredient", line).value) || "",
      quantity: $(".recipe-quantity", line).value
    }));
    $("#recipe-components").innerHTML = components.map((component, index) =>
      recipeComponentLine(index, component, event.target.value)
    ).join("");
    const newProductFields = $("#recipe-new-product");
    const creatingProduct = event.target.value === "new";
    if (creatingProduct) $("#recipe-new-sku").value = generateProductSku();
    newProductFields.hidden = !creatingProduct;
    for (const field of $$("#recipe-new-product input")) {
      field.disabled = !creatingProduct;
      field.required = creatingProduct && ["recipe-new-sku", "recipe-new-name", "recipe-new-price"].includes(field.id);
    }
  }
  if (event.target.matches(".payment-method-field select")) {
    const index = Number(event.target.dataset.paymentIndex);
    if (state.salePayments[index]) {
      state.salePayments[index].method = event.target.value;
      renderPaymentRows();
      updateSalesSummary();
    }
  }
  if (event.target.id === "receipt-logo" && event.target.files.length) {
    const file = event.target.files[0];
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 128 * 1024) {
      event.target.value = "";
      notify("Elegí una imagen PNG, JPG o WebP de hasta 128 KB.", true);
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        notify("No se pudo leer el archivo de imagen.", true);
        return;
      }
      state.receiptLogoDataUri = reader.result;
      $("#receipt-logo-preview").src = reader.result;
      $("#receipt-logo-preview").hidden = false;
    });
    reader.addEventListener("error", () => notify("No se pudo leer el archivo de imagen.", true), { once: true });
    reader.readAsDataURL(file);
  }
  if (event.target.id === "stock-import-file" && event.target.files.length) {
    const file = event.target.files[0];
    event.target.value = "";
    if (file.size > 5 * 1024 * 1024) {
      notify("El archivo no puede superar 5 MB.", true);
      return;
    }
    const isExcel = /\.xlsx$/i.test(file.name);
    if (!isExcel && !/\.csv$/i.test(file.name)) {
      notify("Elegí un archivo .csv o Excel .xlsx.", true);
      return;
    }
    (isExcel ? file.arrayBuffer() : file.text()).then(async (fileContent) => {
      try {
        const response = await fetch("/api/stock/import", {
          method: "POST",
          headers: {
            "Content-Type": isExcel
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "text/csv; charset=utf-8"
          },
          credentials: "same-origin",
          body: fileContent
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "No se pudo importar el archivo.");
        const duplicates = result.skippedDuplicates
          ? ` Se omitieron ${result.skippedDuplicates} filas duplicadas.`
          : "";
        notify(`Importadas ${result.imported} filas; ${result.created} productos nuevos.${duplicates}`);
        await renderPage();
      } catch (error) {
        notify(error.message, true);
      }
    }).catch((error) => notify(`No se pudo leer el archivo: ${error.message}`, true));
  }
  if (event.target.id === "backup-restore-file" && event.target.files.length) {
    const file = event.target.files[0];
    event.target.value = "";
    if (file.size > 100 * 1024 * 1024) {
      notify("La copia no puede superar 100 MB.", true);
      return;
    }
    if (!window.confirm("La restauración reemplazará la información actual y cerrará todas las sesiones. Se guardará una copia preventiva. ¿Continuar?")) return;
    file.arrayBuffer().then(async (backup) => {
      try {
        const response = await fetch("/api/admin/backup", {
          method: "POST",
          headers: { "Content-Type": "application/vnd.sqlite3" },
          credentials: "same-origin",
          body: backup
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "No se pudo restaurar la copia.");
        notify(`Copia restaurada. Respaldo preventivo: ${result.automaticBackup}`);
        showAuth({ needsSetup: false });
      } catch (error) {
        notify(error.message, true);
      }
    }).catch((error) => notify(`No se pudo leer la copia: ${error.message}`, true));
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.id === "sale-product-search" && event.key === "Enter") {
    const scannedBarcode = event.target.value.trim();
    const exactBarcode = state.products.find((product) => product.barcode && product.barcode === scannedBarcode);
    if (exactBarcode) {
      event.preventDefault();
      const result = $(`.sale-search-result[data-id="${exactBarcode.id}"]`);
      if (result) {
        result.click();
        $("#sale-add-product").click();
      }
      return;
    }
    const firstResult = $(".sale-search-result");
    if (firstResult) {
      event.preventDefault();
      firstResult.click();
    }
  }
  if (event.target.id === "quote-product-search" && event.key === "Enter") {
    const firstResult = $(".sale-search-result", $("#quote-search-results"));
    if (firstResult) {
      event.preventDefault();
      firstResult.click();
    }
  }
});

$("#modal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = form.dataset.kind;
  const errorElement = $("#modal-error");
  if (errorElement) errorElement.textContent = "";
  const submit = $('button[type="submit"]', form);
  submit.disabled = true;
  let auxiliaryWindow = null;
  try {
    if (kind === "quote") {
      const items = $$(".quote-editor-line", $("#quote-lines")).map((line) => {
        const custom = $(".quote-product", line).value === "custom";
        return custom
          ? {
              custom: true, name: $(".quote-name", line).value,
              unitPrice: $(".quote-price", line).value,
              quantity: $(".quote-quantity", line).value,
              discountPercent: $(".quote-discount", line).value
            }
          : {
              productId: Number($(".quote-product", line).value),
              priceTier: Number($(".quote-tier", line).value),
              unitPrice: $(".quote-price", line).value,
              quantity: $(".quote-quantity", line).value,
              discountPercent: $(".quote-discount", line).value
            };
      });
      const result = await api("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          contact: $("#quote-contact").value,
          validUntil: $("#quote-valid-until").value,
          contactTaxId: $("#quote-tax-id").value,
          contactVatCondition: $("#quote-vat").value,
          contactAddress: $("#quote-address").value,
          contactPhone: $("#quote-phone").value,
          contactEmail: $("#quote-email").value,
          generalDiscountPercent: $("#quote-general-discount").value,
          items
        })
      });
      $("#modal").close();
      if (result.offlineQueued) {
        notify("Presupuesto guardado en este dispositivo; se sincronizará al volver a estar online.");
        await renderPage();
        return;
      }
      notify(`Presupuesto ${result.quote.number} guardado por ${formatMoney(result.quote.total)}.`);
      await renderPage();
      return;
    }
    if (kind === "quote-convert") {
      const quote = state.quotes.find((item) => item.id === Number(form.dataset.quoteId));
      const paymentCents = amountToCents($("#quote-payment-amount").value);
      if (!quote || paymentCents !== Math.round(quote.total * 100)) {
        throw new Error("El importe recibido debe coincidir con el total del presupuesto.");
      }
      auxiliaryWindow = window.open("about:blank", "_blank");
      const result = await api(`/api/quotes/${Number(form.dataset.quoteId)}/convert`, {
        method: "POST",
        body: JSON.stringify({
          payments: [{
            method: $("#quote-payment-method").value,
            amount: $("#quote-payment-amount").value
          }]
        })
      });
      $("#modal").close();
      if (result.offlineQueued) {
        if (auxiliaryWindow) auxiliaryWindow.close();
        notify("Conversión guardada en este dispositivo; se sincronizará al volver a estar online.");
        await renderPage();
        return;
      }
      if (auxiliaryWindow) auxiliaryWindow.location.replace(branchDocumentUrl(`/receipts/${result.transaction.id}`));
      notifyReceiptLink(result.transaction, `Venta ${result.transaction.number} registrada desde el presupuesto.`);
      await renderPage();
      return;
    }
    if (kind === "recipe" || kind === "recipe-edit") {
      const components = $$(".recipe-component-line", $("#recipe-components")).map((line) => ({
        productId: Number($(".recipe-ingredient", line).value),
        quantity: $(".recipe-quantity", line).value
      }));
      const productSelection = $("#recipe-product").value;
      const recipeData = { components };
      if (productSelection === "new") {
        recipeData.product = {
          sku: $("#recipe-new-sku").value,
          name: $("#recipe-new-name").value,
          category: $("#recipe-new-category").value,
          cost: $("#recipe-new-cost").value || "0",
          price: $("#recipe-new-price").value,
          stock: "0"
        };
      } else {
        recipeData.productId = Number(productSelection);
      }
      await api(kind === "recipe-edit" ? `/api/recipes/${form.dataset.recipeId}` : "/api/recipes", {
        method: kind === "recipe-edit" ? "PUT" : "POST",
        body: JSON.stringify(recipeData)
      });
      $("#modal").close();
      notify(kind === "recipe-edit" ? "Receta actualizada correctamente." : productSelection === "new"
        ? "Producto y receta creados. Al venderlo se descontarán sus ingredientes."
        : "Receta creada. Al vender este producto se descontarán sus ingredientes.");
      await renderPage();
      return;
    }
    if (kind === "product" || kind === "product-edit") {
      const values = new FormData(form);
      const editing = kind === "product-edit";
      const productData = {
        sku: values.get("sku"),
        barcode: values.get("barcode"),
        name: values.get("name"),
        category: values.get("category"),
        brand: values.get("brand"),
        cost: values.get("cost") || "0",
        bonusPercent: values.get("bonusPercent") || "0",
        discountedCost: values.get("discountedCost"),
        priceWithVat: values.get("priceWithVat"),
        profitPercent: values.get("profitPercent") || "0",
        guildDiscountPercent: values.get("guildDiscountPercent") || "0",
        price: values.get("price"),
        price2: values.get("price2"),
        price3: values.get("price3"),
        stock: values.get("stock") || "0",
        minimumStock: values.get("minimumStock") || "0"
      };
      const saved = await api(editing ? `/api/products/${form.dataset.productId}` : "/api/products", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          ...productData
        })
      });
      $("#modal").close();
      notify(saved.offlineQueued
        ? "Cambio de stock guardado en este dispositivo; se sincronizará al volver a estar online."
        : editing ? "Producto actualizado correctamente." : "Producto guardado. Ya podés usarlo en tus movimientos.");
      await renderPage();
      return;
    }
    const items = $$(".item-line", $("#modal-body")).map((line) => {
      return {
        custom: true,
        name: $(".item-name", line).value,
        sku: $(".item-sku", line).value,
        unitPrice: $(".item-price", line).value,
        quantity: $(".item-quantity", line).value,
        discountPercent: "0"
      };
    });
    let documentAttachment;
    if (kind === "purchase") {
      const file = $("#purchase-document").files[0];
      if (file) {
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
        if (!allowedTypes.includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) {
          throw new Error("Adjuntá un comprobante PDF, JPG, PNG o WebP de hasta 5 MB.");
        }
        documentAttachment = {
          fileName: file.name,
          mediaType: file.type,
          dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer()))
        };
      }
    }
    const transaction = await api(`/api/${kind === "sale" ? "sales" : "purchases"}`, {
      method: "POST",
      body: JSON.stringify({
        contact: $("#transaction-contact").value,
        place: kind === "purchase" ? $("#purchase-place").value : undefined,
        document: documentAttachment,
        items
      })
    });
    $("#modal").close();
    if (transaction.offlineQueued) {
      notify(`${kind === "sale" ? "Venta" : "Compra"} guardada en este dispositivo; se sincronizará al volver a estar online.`);
      await renderPage();
      return;
    }
    notify(`${kind === "sale" ? "Venta" : "Compra"} ${transaction.transaction.number} registrada correctamente.`);
    await renderPage();
  } catch (error) {
    if (auxiliaryWindow && !auxiliaryWindow.closed && auxiliaryWindow.location.href === "about:blank") {
      auxiliaryWindow.close();
    }
    if (errorElement) errorElement.textContent = error.message;
    else notify(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "branch-create-form") {
    event.preventDefault();
    const form = event.target;
    const error = $("#branch-create-error");
    const button = $('button[type="submit"]', form);
    error.textContent = "";
    button.disabled = true;
    try {
      await api("/api/branches", {
        method: "POST",
        body: JSON.stringify({ name: $("#branch-new-name").value })
      });
      notify("Sucursal creada con stock inicial en cero.");
      await renderPage();
    } catch (submitError) {
      error.textContent = submitError.message;
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (event.target.id === "branch-transfer-form") {
    event.preventDefault();
    const form = event.target;
    const error = $("#branch-transfer-error");
    const button = $('button[type="submit"]', form);
    const values = new FormData(form);
    error.textContent = "";
    button.disabled = true;
    try {
      const result = await api("/api/branches/transfers", {
        method: "POST",
        body: JSON.stringify({
          fromBranchId: Number(values.get("fromBranchId")),
          toBranchId: Number(values.get("toBranchId")),
          items: [{ productId: Number(values.get("productId")), quantity: values.get("quantity") }]
        })
      });
      notify(`Stock transferido de ${result.fromBranch} a ${result.toBranch}.`);
      await renderPage();
    } catch (submitError) {
      error.textContent = submitError.message;
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (["cash-open-form", "cash-movement-form"].includes(event.target.id)) {
    event.preventDefault();
    const values = new FormData(event.target);
    const opening = event.target.id === "cash-open-form";
    try {
      await api(opening ? "/api/cash-register/open" : "/api/cash-register/movements", {
        method: "POST",
        body: JSON.stringify(opening
          ? { openingAmount: values.get("openingAmount"), note: values.get("note") }
          : Object.fromEntries(values))
      });

      notify(opening ? "Caja abierta." : "Movimiento de caja registrado.");
      await renderPage();
    } catch (error) {
      notify(error.message, true);
    }
    return;
  }
  if (event.target.id === "customer-form") {
    event.preventDefault();
    const form = event.target;
    const error = $("#customer-form-error");
    error.textContent = "";
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      await api("/api/customers", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      notify("Cliente guardado correctamente.");
      await renderPage();
    } catch (submitError) {
      error.textContent = submitError.message;
    } finally {
      submit.disabled = false;
    }
    return;
  }
  if (event.target.id === "admin-user-form") {
    event.preventDefault();
    const form = event.target;
    const error = $("#admin-user-error");
    const button = $('button[type="submit"]', form);
    error.textContent = "";
    button.disabled = true;
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: $("#admin-new-email").value,
          password: $("#admin-new-password").value,
          role: $("#admin-new-role").value
        })
      });
      notify("Usuario creado correctamente.");
      await renderPage();
    } catch (submitError) {
      error.textContent = submitError.message;
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (event.target.id !== "receipt-settings-form") return;
  event.preventDefault();
  const form = event.target;
  const button = $('button[type="submit"]', form);
  const error = $("#receipt-settings-error");
  error.textContent = "";
  button.disabled = true;
  try {
    const values = new FormData(form);
    await api("/api/receipt-settings", {
      method: "PUT",
      body: JSON.stringify({
        businessName: values.get("businessName"),
        legalName: values.get("legalName"),
        address: values.get("address"),
        taxId: values.get("taxId"),
        grossIncome: values.get("grossIncome"),
        vatCondition: values.get("vatCondition"),
        email: values.get("email"),
        phone: values.get("phone"),
        activityStart: values.get("activityStart"),
        pointOfSale: values.get("pointOfSale"),
        receiptTitle: values.get("receiptTitle"),
        receiptFormat: values.get("receiptFormat"),
        logoDataUri: state.receiptLogoDataUri
      })
    });
    notify("Los datos personalizados del comprobante se guardaron.");
  } catch (submitError) {
    error.textContent = submitError.message;
  } finally {
    button.disabled = false;
  }
});

$("#branch-selector").addEventListener("change", async (event) => {
  const branchId = Number(event.target.value);
  const branch = state.branches.find((item) => item.id === branchId);
  if (!branch || branchId === state.selectedBranchId) return;
  if ((state.salesCart.length || state.orderCart.length || state.quoteCart.length) &&
      !window.confirm("Cambiar de sucursal descartará los carritos sin guardar. ¿Continuar?")) {
    event.target.value = String(state.selectedBranchId);
    return;
  }
  state.salesCart = [];
  state.orderCart = [];
  state.quoteCart = [];
  state.activeOrderId = null;
  state.selectedBranchId = branchId;
  state.user.branchId = branchId;
  state.user.branchName = branch.name;
  localStorage.setItem(`tonoto-selected-branch:${state.user.companyId}`, String(branchId));
  $("#sidebar-branch").textContent = branch.name;
  await renderPage();
});

$("#modal").addEventListener("click", (event) => {
  if (event.target === $("#modal") && $("#modal").dataset.lockedProductModal !== "true") $("#modal").close();
});

$("#modal").addEventListener("cancel", (event) => {
  if ($("#modal").dataset.lockedProductModal === "true") event.preventDefault();
});

$("#modal").addEventListener("close", () => {
  if ($("#modal").open) return;
  delete $("#modal").dataset.lockedProductModal;
  $(".modal-close").hidden = false;
});

$("#camera-scanner-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  hideCameraScanner();
});

$("#camera-scanner-dialog").addEventListener("click", (event) => {
  if (event.target === $("#camera-scanner-dialog")) hideCameraScanner();
});

window.addEventListener("pagehide", stopCameraScanner);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("#sidebar").classList.remove("is-open");
    $("#sidebar-scrim").classList.remove("is-visible");
  }
});

window.addEventListener("offline", () => {
  state.offlineMode = true;
  updateConnectionStatus();
  notify("Sin conexión. Las ventas, pedidos, compras, presupuestos y cambios de stock quedarán pendientes.");
});
window.addEventListener("online", () => {
  state.offlineMode = false;
  updateConnectionStatus();
  if (state.onlineVerificationLocked && state.user) {
    void verifyOnlineAccess();
    return;
  }
  flushOfflineQueue();
});
setInterval(() => {
  if (navigator.onLine && state.pendingSyncCount > 0) flushOfflineQueue();
}, 15_000);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.error("No se pudo activar el modo de aplicación offline:", error);
  });
}

start();
