const config = window.COMPUTELAB_CONFIG;
const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);

let currentMember = null;
let state = emptyState();

function emptyState() {
  return { settings: { presentationUrl: "" }, projects: [], members: [], resources: [], posts: [] };
}

// ── Utilities ──────────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]);
}
function initials(name) {
  return String(name || "?").split(" ").filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase();
}
function formatTime(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function notify(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}
function showError(error) {
  console.error(error);
  notify(error?.message || "Something went wrong.");
}
function empty(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

// ── PIN Gate ───────────────────────────────────────────────────────────────
const AVATAR_COLORS = ["green", "orange", "blue", "green", "orange", "blue"];

function initPinGate() {
  const members = config.members || [];

  // Populate dropdown
  const select = document.getElementById("member-select");
  select.innerHTML = '<option value="">— Select your name —</option>' +
    members.map(m => `<option value="${escapeHtml(String(m.id))}">${escapeHtml(m.name)}</option>`).join("");

  // PIN digit auto-advance & backspace
  const digits = [...document.querySelectorAll(".pin-digit")];
  digits.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && i < digits.length - 1) digits[i + 1].focus();
      if (input.value && i === digits.length - 1) document.getElementById("pin-enter-btn").focus();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && i > 0) { digits[i - 1].focus(); digits[i - 1].value = ""; }
      if (e.key === "Enter") enterWorkspace();
    });
  });

  document.getElementById("pin-enter-btn").addEventListener("click", enterWorkspace);

  // Restore session
  try {
    const saved = sessionStorage.getItem("cl_session");
    if (saved) {
      const parsed = JSON.parse(saved);
      const valid = members.find(m => String(m.id) === String(parsed.id) && m.name === parsed.name);
      if (valid) { currentMember = valid; openWorkspace(); return; }
    }
  } catch {}

  showPinGate();
}

function showPinGate() {
  document.getElementById("pin-gate").hidden = false;
  document.getElementById("workspace-shell").hidden = true;
}

function enterWorkspace() {
  const errorEl = document.getElementById("pin-error");
  const selectedId = document.getElementById("member-select").value;
  const pin = [...document.querySelectorAll(".pin-digit")].map(d => d.value).join("");
  errorEl.textContent = "";

  if (!selectedId) { errorEl.textContent = "Please select your profile first."; return; }
  if (pin.length < 4) { errorEl.textContent = "Enter all 4 digits of your PIN."; return; }

  const member = (config.members || []).find(m => String(m.id) === selectedId && String(m.pin) === pin);
  if (!member) {
    errorEl.textContent = "Incorrect PIN. Please try again.";
    document.querySelectorAll(".pin-digit").forEach(d => d.value = "");
    document.querySelectorAll(".pin-digit")[0].focus();
    return;
  }

  sessionStorage.setItem("cl_session", JSON.stringify({ id: member.id, name: member.name }));
  currentMember = member;
  openWorkspace();
}

async function openWorkspace() {
  try {
    await loadLiveState();
    document.getElementById("pin-gate").hidden = true;
    document.getElementById("workspace-shell").hidden = false;
    notify(`Welcome, ${currentMember.name.split(" ")[0]}!`);
  } catch (error) {
    showError(new Error("Could not load workspace data. Check your Supabase connection and run the new schema."));
    showPinGate();
  }
}

// ── Data ───────────────────────────────────────────────────────────────────
async function loadLiveState() {
  const [projectsRes, resourcesRes, postsRes, settingsRes] = await Promise.all([
    supabaseClient.from("projects").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("resources").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("posts").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("workspace_settings").select("*").eq("id", true).single()
  ]);

  if (projectsRes.error) throw projectsRes.error;
  if (resourcesRes.error) throw resourcesRes.error;
  if (postsRes.error) throw postsRes.error;
  if (settingsRes.error) throw settingsRes.error;

  state = {
    settings: { presentationUrl: settingsRes.data.presentation_url },
    members: (config.members || []).map((m, i) => ({
      id: m.id, name: m.name, group: m.group || "Research Team",
      role: m.role || "member", color: AVATAR_COLORS[i % AVATAR_COLORS.length]
    })),
    projects: projectsRes.data.map(r => ({ id: r.id, name: r.name, group: r.group_name, description: r.description, status: r.status })),
    resources: resourcesRes.data.map(r => ({ id: r.id, name: r.name, type: r.resource_type, url: r.url })),
    posts: postsRes.data.map(r => ({
      id: r.id, author: r.author_name || "Team member",
      group: r.author_group || "Research Team",
      color: "green", time: formatTime(r.created_at),
      content: r.content, link: r.link_url, linkLabel: r.link_label
    }))
  };
  render();
}

async function addRecord(table, payload) {
  const { error } = await supabaseClient.from(table).insert(payload);
  if (error) throw error;
  await loadLiveState();
}
async function updateRecord(table, id, payload) {
  const { error } = await supabaseClient.from(table).update(payload).eq("id", id);
  if (error) throw error;
  await loadLiveState();
}
async function removeRecord(collection, id) {
  const table = { projects: "projects", resources: "resources", posts: "posts" }[collection];
  const { error } = await supabaseClient.from(table).delete().eq("id", id);
  if (error) throw error;
  await loadLiveState();
}

// ── Render ─────────────────────────────────────────────────────────────────
function postTemplate(post) {
  const attachment = post.link
    ? `<a class="attachment" href="${escapeHtml(post.link)}" target="_blank" rel="noreferrer">
        <div class="file-icon">+</div><div><strong>${escapeHtml(post.linkLabel || "Shared link")}</strong><br><span>Open linked resource</span></div>
      </a>` : "";
  return `<article class="post">
    <div class="post-head">
      <div class="avatar ${escapeHtml(post.color)}">${escapeHtml(initials(post.author))}</div>
      <div><div class="post-author">${escapeHtml(post.author)}</div><div class="post-time">${escapeHtml(post.time)} | ${escapeHtml(post.group)}</div></div>
    </div>
    <p>${escapeHtml(post.content)}</p>${attachment}
  </article>`;
}
function resourceTemplate(resource) {
  return `<a class="resource resource-link" href="${escapeHtml(resource.url)}" target="_blank" rel="noreferrer">
    <div class="file-icon">${escapeHtml(resource.name[0]?.toUpperCase() || "R")}</div>
    <div><strong>${escapeHtml(resource.name)}</strong><span>${escapeHtml(resource.type)}</span></div>
  </a>`;
}

function render() {
  const role = currentMember?.role || "member";
  document.body.dataset.role = role;
  document.querySelectorAll(".admin-only").forEach(el => { el.hidden = role !== "admin"; });

  document.getElementById("sidebar-name").textContent = currentMember?.name || "Team member";
  document.getElementById("sidebar-role").textContent = role === "admin" ? "Administrator" : "Team member";

  const myInitials = initials(currentMember?.name || "");
  const topAv = document.querySelector(".top-actions .avatar");
  if (topAv) topAv.textContent = myInitials;
  const composerAv = document.querySelector(".composer .avatar");
  if (composerAv) composerAv.textContent = myInitials;

  document.getElementById("today").textContent =
    new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date());

  const upcomingCount = (function() { try { return JSON.parse(localStorage.getItem("computelab_upcoming") || "[]").length; } catch { return 0; } })();
  document.getElementById("stats").innerHTML = [
    [state.projects.filter(p => p.status === "Active").length, "Active projects"],
    [state.members.length, "Team members"],
    [state.resources.length, "Shared resources"],
    [upcomingCount, "Upcoming talks"]
  ].map(([n, label]) => `<div class="stat"><strong>${String(n).padStart(2, "0")}</strong><span>${label}</span></div>`).join("");

  document.getElementById("overview-posts").innerHTML = state.posts.slice(0, 2).map(postTemplate).join("") || empty("No updates posted yet.");
  document.getElementById("feed-list").innerHTML = state.posts.map(postTemplate).join("") || empty("No updates posted yet.");
  document.getElementById("overview-resources").innerHTML = state.resources.slice(0, 3).map(resourceTemplate).join("") || empty("No resources added yet.");
  document.getElementById("resources-list").innerHTML = state.resources.map(resourceTemplate).join("") || empty("No resources added yet.");

  document.getElementById("overview-members").innerHTML =
    state.members.slice(0, 4).map(m => `<div class="avatar ${escapeHtml(m.color)}" title="${escapeHtml(m.name)}">${escapeHtml(initials(m.name))}</div>`).join("") +
    (state.members.length > 4 ? `<div class="more">+${state.members.length - 4}</div>` : "");

  document.getElementById("projects-list").innerHTML = state.projects.map(p =>
    `<article class="info-card"><span class="tag">${escapeHtml(p.status)}</span><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p><div class="meta">${escapeHtml(p.group)}</div></article>`
  ).join("") || empty("No projects added yet.");

  document.getElementById("members-list").innerHTML = state.members.map((m, i) =>
    `<article class="info-card"><div class="avatar ${escapeHtml(m.color)}">${escapeHtml(initials(m.name))}</div><h3>${escapeHtml(m.name)}</h3><p>${escapeHtml(m.group)}</p><div class="meta">${escapeHtml(m.role)}</div></article>`
  ).join("") || empty("No members configured yet.");

  renderAdminLists();
  setPresentationLinks();
}

function renderAdminLists() {
  document.getElementById("admin-project-list").innerHTML =
    state.projects.map(item => adminRow(item.id, "projects", item.name, `${item.group} | ${item.status}`)).join("") || empty("No projects yet.");
  document.getElementById("admin-resource-list").innerHTML =
    state.resources.map(item => adminRow(item.id, "resources", item.name, item.type)).join("") || empty("No resources yet.");
  document.getElementById("admin-member-list").innerHTML =
    state.members.map(m => `<div class="admin-row"><div><strong>${escapeHtml(m.name)}</strong><span>${escapeHtml(m.group)} | ${escapeHtml(m.role)}</span></div></div>`).join("") ||
    empty("No members in config.js yet.");
}

function adminRow(id, collection, title, subtitle) {
  return `<div class="admin-row">
    <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>
    <div class="row-actions">
      <button class="edit-btn" data-edit="${escapeHtml(collection)}" data-id="${escapeHtml(id)}">Edit</button>
      <button class="remove-btn" data-remove="${escapeHtml(collection)}" data-id="${escapeHtml(id)}">Remove</button>
    </div>
  </div>`;
}

function setPresentationLinks() {
  const url = state.settings.presentationUrl;
  ["presentation-link", "presentation-page-link"].forEach(id => {
    const link = document.getElementById(id);
    if (!link) return;
    link.href = url || "#";
    link.onclick = url ? null : (e) => { e.preventDefault(); notify("Ask an admin to add the presentation URL in Settings."); };
  });
  const urlInput = document.querySelector("#settings-form [name='presentationUrl']");
  if (urlInput) urlInput.value = url;
}

// ── Views ──────────────────────────────────────────────────────────────────
function switchView(view) {
  if (view === "admin" && currentMember?.role !== "admin") {
    notify("Only an admin can open the management workspace."); view = "overview";
  }
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("active", s.id === `${view}-view`));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openAdmin(tab) {
  if (currentMember?.role !== "admin") return;
  switchView("admin"); switchAdminTab(tab);
}
function switchAdminTab(tab) {
  document.querySelectorAll(".admin-section").forEach(s => s.classList.toggle("active", s.id === `admin-${tab}`));
  document.querySelectorAll("[data-admin-tab]").forEach(b => b.classList.toggle("active", b.dataset.adminTab === tab));
}
function readForm(form) { return Object.fromEntries(new FormData(form).entries()); }
function resetAdminForm(type) {
  const form = document.getElementById(`${type}-form`);
  if (!form) return;
  form.reset();
  const titleEl = document.getElementById(`${type}-form-title`);
  if (titleEl) titleEl.textContent = `Add ${type}`;
  const submitEl = document.getElementById(`${type}-submit`);
  if (submitEl) submitEl.textContent = `Add ${type}`;
  const cancelEl = form.querySelector("[data-cancel-edit]");
  if (cancelEl) cancelEl.classList.remove("visible");
}
function startEdit(collection, id) {
  const type = collection.slice(0, -1);
  const item = state[collection]?.find(c => String(c.id) === String(id));
  if (!item) return;
  const form = document.getElementById(`${type}-form`);
  if (!form) return;
  Object.entries(item).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
  const titleEl = document.getElementById(`${type}-form-title`);
  if (titleEl) titleEl.textContent = `Edit ${type}`;
  const submitEl = document.getElementById(`${type}-submit`);
  if (submitEl) submitEl.textContent = "Save changes";
  const cancelEl = form.querySelector("[data-cancel-edit]");
  if (cancelEl) cancelEl.classList.add("visible");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Event Listeners ────────────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const viewBtn = e.target.closest("[data-view]");       if (viewBtn) switchView(viewBtn.dataset.view);
  const adminBtn = e.target.closest("[data-open-admin]"); if (adminBtn) openAdmin(adminBtn.dataset.openAdmin);
  const tabBtn = e.target.closest("[data-admin-tab]");   if (tabBtn) switchAdminTab(tabBtn.dataset.adminTab);
  const editBtn = e.target.closest("[data-edit]");
  if (editBtn && currentMember?.role === "admin") startEdit(editBtn.dataset.edit, editBtn.dataset.id);
  const cancelBtn = e.target.closest("[data-cancel-edit]");
  if (cancelBtn) resetAdminForm(cancelBtn.dataset.cancelEdit);
  const removeBtn = e.target.closest("[data-remove]");
  if (removeBtn && currentMember?.role === "admin") {
    try { await removeRecord(removeBtn.dataset.remove, removeBtn.dataset.id); notify("Item removed."); }
    catch (error) { showError(error); }
  }
});

document.getElementById("post-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = readForm(e.currentTarget);
  try {
    await addRecord("posts", {
      content: values.content,
      link_url: values.link || null,
      link_label: values.link ? "Shared resource" : null,
      author_name: currentMember?.name || "Team member",
      author_group: currentMember?.group || "Research Team"
    });
    e.currentTarget.reset();
    notify("Update shared with the team.");
  } catch (error) { showError(error); }
});

document.getElementById("project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = readForm(e.currentTarget);
  const payload = { name: values.name, group_name: values.group, description: values.description, status: values.status };
  try {
    if (values.id) await updateRecord("projects", values.id, payload);
    else await addRecord("projects", payload);
    resetAdminForm("project");
    notify(values.id ? "Project updated." : "Project added.");
  } catch (error) { showError(error); }
});

document.getElementById("resource-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = readForm(e.currentTarget);
  const payload = { name: values.name, resource_type: values.type, url: values.url };
  try {
    if (values.id) await updateRecord("resources", values.id, payload);
    else await addRecord("resources", payload);
    resetAdminForm("resource");
    notify(values.id ? "Resource updated." : "Resource added.");
  } catch (error) { showError(error); }
});

document.getElementById("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = readForm(e.currentTarget);
  try {
    const { error } = await supabaseClient.from("workspace_settings")
      .update({ presentation_url: values.presentationUrl, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) throw error;
    await loadLiveState();
    notify("Settings saved.");
  } catch (error) { showError(error); }
});

document.getElementById("auth-button").addEventListener("click", () => {
  sessionStorage.removeItem("cl_session");
  currentMember = null;
  state = emptyState();
  document.getElementById("workspace-shell").hidden = true;
  document.getElementById("member-select").value = "";
  document.querySelectorAll(".pin-digit").forEach(d => d.value = "");
  document.getElementById("pin-error").textContent = "";
  showPinGate();
  notify("Signed out.");
});

document.getElementById("search").addEventListener("input", (e) => {
  const query = e.target.value.trim().toLowerCase();
  if (!query) return;
  const matches = [...state.projects, ...state.resources, ...state.posts]
    .filter(item => JSON.stringify(item).toLowerCase().includes(query)).length;
  notify(`${matches} matching item${matches === 1 ? "" : "s"} found.`);
});

// ── PDF Presentation ───────────────────────────────────────────────────────
(function initPdf() {
  const input = document.getElementById("pdf-input");
  let currentObjectUrl = null;
  function openPdf(file) {
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    document.getElementById("pdf-filename").textContent = file.name;
    document.getElementById("pdf-frame").src = currentObjectUrl;
    document.getElementById("pdf-viewer").hidden = false;
    input.value = "";
  }
  input.addEventListener("change", () => { if (input.files[0]) openPdf(input.files[0]); });
  ["pdf-present-btn", "pdf-present-btn-page"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => input.click());
  });
  document.getElementById("pdf-close").addEventListener("click", () => {
    document.getElementById("pdf-viewer").hidden = true;
    document.getElementById("pdf-frame").src = "";
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
  });
})();

// ── Upcoming Events (localStorage) ────────────────────────────────────────
(function initUpcoming() {
  const STORE_KEY = "computelab_upcoming";
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; } }
  function save(events) {
    localStorage.setItem(STORE_KEY, JSON.stringify(events));
    renderUpcoming();
    const chip = [...document.querySelectorAll("#stats .stat")].find(el => el.querySelector("span")?.textContent === "Upcoming talks");
    if (chip) chip.querySelector("strong").textContent = String(events.length).padStart(2, "0");
  }
  function renderUpcoming() {
    const events = load();
    const list = document.getElementById("upcoming-list");
    if (!list) return;
    list.innerHTML = events.length
      ? events.map((ev, i) => `<div class="upcoming">
          <span class="tag">${escapeHtml(ev.date)}</span>
          <h3>${escapeHtml(ev.title)}</h3>
          <p>${escapeHtml(ev.details)}</p>
          <div class="upcoming-actions">
            <button class="text-btn" data-edit-upcoming="${i}">Edit</button>
            <button class="text-btn remove-upcoming" data-remove-upcoming="${i}">Remove</button>
          </div>
        </div>`).join("")
      : `<div class="upcoming"><p>No upcoming events. Add one above.</p></div>`;
  }
  function showForm(idx) {
    const wrap = document.getElementById("upcoming-form-wrap");
    const form = document.getElementById("upcoming-form");
    const events = load();
    form.reset();
    form.elements.idx.value = idx !== undefined ? idx : "";
    if (idx !== undefined && events[idx]) {
      form.elements.date.value = events[idx].date;
      form.elements.title.value = events[idx].title;
      form.elements.details.value = events[idx].details;
    }
    document.getElementById("upcoming-submit").textContent = idx !== undefined ? "Save changes" : "Save";
    wrap.hidden = false;
    form.elements.date.focus();
  }
  function hideForm() { document.getElementById("upcoming-form-wrap").hidden = true; }
  document.getElementById("upcoming-add-btn").addEventListener("click", () => showForm());
  document.getElementById("upcoming-cancel").addEventListener("click", hideForm);
  document.getElementById("upcoming-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const values = readForm(e.currentTarget);
    const events = load();
    const entry = { date: values.date.trim().toUpperCase(), title: values.title.trim(), details: values.details.trim() };
    if (values.idx !== "") events[Number(values.idx)] = entry;
    else events.push(entry);
    save(events);
    hideForm();
  });
  document.getElementById("upcoming-list").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit-upcoming]");
    if (editBtn) { showForm(Number(editBtn.dataset.editUpcoming)); return; }
    const removeBtn = e.target.closest("[data-remove-upcoming]");
    if (removeBtn) { const events = load(); events.splice(Number(removeBtn.dataset.removeUpcoming), 1); save(events); }
  });
  renderUpcoming();
})();

// ── Init ───────────────────────────────────────────────────────────────────
initPinGate();
