const $ = (selector) => document.querySelector(selector);
let selectedCompanyId = null;
let toastTimeout = null;
const subscriptionLabels = { active: "Activo", suspended: "Suspendido", cancelled: "Cancelado" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    },
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

function showError(selector, message) {
  $(selector).textContent = message || "";
}

function showToast(message) {
  const toast = $("#platform-toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 5000);
}

function showApp(authenticated) {
  $("#platform-login").hidden = authenticated;
  $("#platform-app").hidden = !authenticated;
  if (authenticated) refreshCompanies();
}

async function refreshCompanies() {
  showError("#platform-companies-error", "");
  try {
    const [data, audit] = await Promise.all([
      api("/api/platform/companies"),
      api("/api/platform/audit")
    ]);
    $("#platform-firebase-status").textContent = data.firebase.configured
      ? "Firebase conectado"
      : "Firebase pendiente de credenciales";
    const syncFailures = data.firebase.syncFailures.map((failure) =>
      `${failure.company} (${failure.attempts} intentos): ${failure.error}`
    ).join(" · ");
    $("#platform-firebase-detail").textContent = data.firebase.configured
      ? `Proyecto ${data.firebase.projectId}. Sincronizaciones pendientes: ${data.firebase.queuedSyncs}.`
      : `Proyecto ${data.firebase.projectId}. Configurá las credenciales de servicio en el servidor.`;
    if (syncFailures) $("#platform-firebase-detail").textContent += ` Errores recientes: ${syncFailures}`;
    const activeCount = data.companies.filter((company) => company.status === "active" && !company.expired).length;
    const expiredCount = data.companies.filter((company) => company.expired).length;
    const userCount = data.companies.reduce((total, company) => total + Number(company.userCount), 0);
    $("#platform-overview").innerHTML = `
      <article class="platform-metric"><span>Empresas</span><strong>${data.companies.length}</strong><small>Espacios registrados</small></article>
      <article class="platform-metric is-active"><span>Al día</span><strong>${activeCount}</strong><small>Suscripciones vigentes</small></article>
      <article class="platform-metric ${expiredCount ? "is-warning" : ""}"><span>Vencidas</span><strong>${expiredCount}</strong><small>Requieren renovar</small></article>
      <article class="platform-metric"><span>Usuarios</span><strong>${userCount}</strong><small>En todas las empresas</small></article>`;
    $("#platform-companies").innerHTML = data.companies.length
      ? data.companies.map((company) => `
        <tr>
          <td>${escapeHtml(company.name)}<small class="platform-subline">ID ${company.id}</small></td>
          <td><input class="platform-inline-field" data-plan-for="${company.id}" value="${escapeHtml(company.plan)}" maxlength="40" aria-label="Plan de ${escapeHtml(company.name)}"></td>
          <td>${company.userCount}</td>
          <td><select class="platform-inline-field platform-status-select" data-status-for="${company.id}" aria-label="Estado de suscripción de ${escapeHtml(company.name)}">
            ${Object.entries(subscriptionLabels).map(([value, label]) => `<option value="${value}" ${company.status === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>${company.expired ? '<small class="platform-expired-note">Vencida · acceso bloqueado</small>' : ""}</td>
          <td><input class="platform-inline-field" type="date" data-until-for="${company.id}" value="${escapeHtml(company.subscriptionUntil || "")}" aria-label="Vencimiento de ${escapeHtml(company.name)}"></td>
          <td><span class="table-actions">
            <button class="table-action" type="button" data-action="users" data-id="${company.id}" data-name="${escapeHtml(company.name)}">Usuarios</button>
            <button class="table-action is-edit" type="button" data-action="subscription" data-id="${company.id}">Guardar</button>
            <button class="table-action is-danger" type="button" data-action="company-delete" data-id="${company.id}" data-name="${escapeHtml(company.name)}">Eliminar empresa</button>
          </span></td>
        </tr>`).join("")
      : '<tr><td colspan="6"><div class="empty-state">Todavía no hay empresas. Creá la primera desde el formulario.</div></td></tr>';
    $("#platform-audit").innerHTML = audit.entries.length
      ? audit.entries.map((entry) => `<tr>
          <td>${escapeHtml(entry.createdAt)}</td>
          <td>${escapeHtml(entry.adminEmail)}</td>
          <td>${escapeHtml(entry.action)}</td>
          <td>${entry.companyId ?? "—"}</td>
          <td>${escapeHtml(entry.details || "—")}</td></tr>`).join("")
      : '<tr><td colspan="5">Todavía no hay acciones registradas.</td></tr>';
  } catch (error) {
    showError("#platform-companies-error", error.message);
  }
}

async function loadCompanyUsers(companyId, companyName) {
  selectedCompanyId = companyId;
  $("#platform-users-title").textContent = `Usuarios · ${companyName}`;
  $("#platform-users-section").hidden = false;
  showError("#platform-user-error", "");
  try {
    const data = await api(`/api/platform/companies/${companyId}/users`);
    $("#platform-users").innerHTML = data.users.length
      ? data.users.map((user) => `<tr>
          <td><span class="platform-account-name">${escapeHtml(user.username)}</span>
            <input class="platform-inline-field platform-user-display" data-id="${user.id}" value="${escapeHtml(user.displayName || user.username)}" maxlength="80" aria-label="Nombre visible de ${escapeHtml(user.username)}"></td>
          <td><select class="platform-inline-field platform-user-role" data-id="${user.id}" aria-label="Perfil de ${escapeHtml(user.username)}">
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="manager" ${user.role === "manager" ? "selected" : ""}>Gerente</option>
            <option value="cashier" ${user.role === "cashier" ? "selected" : ""}>Cajero</option>
            <option value="seller" ${user.role === "seller" ? "selected" : ""}>Vendedor</option>
          </select></td>
          <td>${escapeHtml(user.createdAt)}</td>
          <td><span class="table-actions">
            <button class="table-action is-edit" type="button" data-action="user-update" data-id="${user.id}">Guardar cambios</button>
            <button class="table-action" type="button" data-action="user-password" data-id="${user.id}" data-username="${escapeHtml(user.username)}">Restablecer clave</button>
            <button class="table-action is-danger" type="button" data-action="user-delete" data-id="${user.id}" data-username="${escapeHtml(user.username)}">Eliminar</button>
          </span></td></tr>`).join("")
      : '<tr><td colspan="4">No hay usuarios para mostrar.</td></tr>';
  } catch (error) {
    showError("#platform-user-error", error.message);
  }
}

$("#platform-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("#platform-login-error", "");
  const loginForm = event.currentTarget;
  const form = new FormData(loginForm);
  try {
    await api("/api/platform/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    loginForm.reset();
    showApp(true);
  } catch (error) {
    showError("#platform-login-error", error.message);
  }
});

$("#platform-company-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("#platform-company-error", "");
  const companyForm = event.currentTarget;
  const form = new FormData(companyForm);
  const industries = [...companyForm.querySelectorAll('input[name="industry"]:checked')].map((input) => input.value);
  if (!industries.length) {
    showError("#platform-company-error", "Elegí al menos un rubro para la empresa.");
    return;
  }
  try {
    await api("/api/platform/companies", {
      method: "POST",
      body: JSON.stringify({ ...Object.fromEntries(form.entries()), industries })
    });
    companyForm.reset();
    $("#new-company-plan").value = "standard";
    await refreshCompanies();
  } catch (error) {
    showError("#platform-company-error", error.message);
  }
});

$("#platform-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedCompanyId) return;
  showError("#platform-user-error", "");
  const userForm = event.currentTarget;
  const form = new FormData(userForm);
  try {
    await api(`/api/platform/companies/${selectedCompanyId}/users`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    userForm.reset();
    await loadCompanyUsers(selectedCompanyId, $("#platform-users-title").textContent.replace("Usuarios · ", ""));
    await refreshCompanies();
  } catch (error) {
    showError("#platform-user-error", error.message);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "users") {
    await loadCompanyUsers(Number(button.dataset.id), button.dataset.name);
  }
  if (button.dataset.action === "subscription") {
    try {
      const status = $(`[data-status-for="${button.dataset.id}"]`).value;
      if (status === "cancelled" && !window.confirm(
        "¿Cancelar esta suscripción? La empresa perderá el acceso. Al intentar ingresar recibirá un mensaje de agradecimiento y bienvenida para cuando quiera regresar."
      )) return;
      await api(`/api/platform/companies/${button.dataset.id}`, {
        method: "PUT",
        body: JSON.stringify({
          status,
          plan: $(`[data-plan-for="${button.dataset.id}"]`).value,
          subscriptionUntil: $(`[data-until-for="${button.dataset.id}"]`).value
        })
      });
      await refreshCompanies();
      if (status === "cancelled") {
        showToast("Suscripción cancelada. La empresa recibirá un mensaje de agradecimiento si intenta ingresar.");
      }
    } catch (error) {
      showError("#platform-companies-error", error.message);
    }
  }
  if (button.dataset.action === "company-delete") {
    const companyName = button.dataset.name;
    const confirmed = window.confirm(
      `¿Eliminar definitivamente "${companyName}" y todos sus datos, incluidos usuarios, productos, ventas, compras, presupuestos y registros? Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;
    try {
      await api(`/api/platform/companies/${button.dataset.id}`, { method: "DELETE" });
      if (selectedCompanyId === Number(button.dataset.id)) {
        selectedCompanyId = null;
        $("#platform-users-section").hidden = true;
      }
      await refreshCompanies();
      showToast(`Se eliminó la empresa "${companyName}" junto con sus datos.`);
    } catch (error) {
      showError("#platform-companies-error", error.message);
    }
  }
  if (["user-update", "user-password", "user-delete"].includes(button.dataset.action) && selectedCompanyId) {
    const userId = button.dataset.id;
    const endpoint = `/api/platform/companies/${selectedCompanyId}/users/${userId}`;
    try {
      if (button.dataset.action === "user-update") {
        await api(endpoint, {
          method: "PUT",
          body: JSON.stringify({
            role: $(`.platform-user-role[data-id="${userId}"]`).value,
            displayName: $(`.platform-user-display[data-id="${userId}"]`).value
          })
        });
      } else if (button.dataset.action === "user-password") {
        const password = window.prompt(`Nueva contraseña para ${button.dataset.username} (mínimo 8 caracteres):`);
        if (password === null) return;
        await api(`${endpoint}/password`, { method: "POST", body: JSON.stringify({ password }) });
      } else {
        if (!window.confirm(`¿Eliminar la cuenta ${button.dataset.username}?`)) return;
        await api(endpoint, { method: "DELETE" });
      }
      await loadCompanyUsers(selectedCompanyId, $("#platform-users-title").textContent.replace("Usuarios · ", ""));
      await refreshCompanies();
    } catch (error) {
      showError("#platform-user-error", error.message);
    }
  }
});

$("#platform-refresh").addEventListener("click", refreshCompanies);
$("#platform-close-users").addEventListener("click", () => {
  selectedCompanyId = null;
  $("#platform-users-section").hidden = true;
});
$("#platform-logout").addEventListener("click", async () => {
  try {
    await api("/api/platform/logout", { method: "POST" });
    showApp(false);
  } catch (error) {
    showError("#platform-companies-error", error.message);
  }
});

api("/api/platform/session")
  .then((session) => showApp(session.authenticated))
  .catch((error) => showError("#platform-login-error", error.message));
