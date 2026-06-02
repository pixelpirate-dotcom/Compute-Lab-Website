const config = window.COMPUTELAB_CONFIG;
const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);

let currentUser = null;
let currentProfile = null;
let state = emptyState();

function emptyState() {
  return {
    role: "member",
    settings: { presentationUrl: "" },
    projects: [],
    members: [],
    resources: [],
    posts: []
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function initials(name) {
  return String(name || "?").split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
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
  notify(error.message || "Something went wrong.");
}

function setAuthStatus(message, isError = false) {
  const status = document.getElementById("auth-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function handleAuthError(error) {
  const message = error.message || "Authentication failed.";
  if (/rate limit|security purposes/i.test(message)) {
    setAuthStatus("Supabase blocked another email. Try signing in if your account already exists, or wait before requesting another email.", true);
    return;
  }
  setAuthStatus(message, true);
}

function setSignupPending(isPending) {
  const button = document.getElementById("signup-button");
  button.disabled = isPending;
  button.textContent = isPending ? "Creating..." : "Create account";
}

function empty(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

async function loadLiveState() {
  const [profileResult, projectsResult, membersResult, resourcesResult, postsResult, settingsResult] = await Promise.all([
    supabaseClient.from("profiles").select("*").eq("id", currentUser.id).single(),
    supabaseClient.from("projects").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("team_members").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("resources").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("posts").select("*, profiles(full_name, group_name)").order("created_at", { ascending: false }),
    supabaseClient.from("workspace_settings").select("*").eq("id", true).single()
  ]);
  const failed = [profileResult, projectsResult, membersResult, resourcesResult, postsResult, settingsResult].find((result) => result.error);
  if (failed) throw failed.error;

  currentProfile = profileResult.data;
  state = {
    role: currentProfile.role,
    settings: { presentationUrl: settingsResult.data.presentation_url },
    projects: projectsResult.data.map((item) => ({ id: item.id, name: item.name, group: item.group_name, description: item.description, status: item.status })),
    members: membersResult.data.map((item) => ({ id: item.id, name: item.full_name, email: item.email, group: item.group_name, role: item.directory_role, color: "green" })),
    resources: resourcesResult.data.map((item) => ({ id: item.id, name: item.name, type: item.resource_type, url: item.url })),
    posts: postsResult.data.map((item) => ({
      id: item.id,
      author: item.profiles?.full_name || "Team member",
      group: item.profiles?.group_name || "Research Team",
      color: "green",
      time: formatTime(item.created_at),
      content: item.content,
      link: item.link_url,
      linkLabel: item.link_label
    }))
  };
  render();
}

async function useSession(user) {
  currentUser = user;
  if (!user) {
    currentProfile = null;
    state = emptyState();
    document.getElementById("workspace-shell").hidden = true;
    document.getElementById("auth-close").hidden = true;
    document.getElementById("auth-modal").hidden = false;
    document.getElementById("auth-form").hidden = false;
    document.getElementById("password-update-form").hidden = true;
    setAuthStatus("Sign in to open the workspace.");
    return;
  }

  try {
    await loadLiveState();
    document.getElementById("workspace-shell").hidden = false;
    document.getElementById("auth-modal").hidden = true;
    document.getElementById("auth-close").hidden = false;
    notify("Connected to the shared workspace.");
  } catch (error) {
    await supabaseClient.auth.signOut();
    currentUser = null;
    showError(new Error("Could not load the workspace. Run the latest supabase-schema.sql file in Supabase, then sign in again."));
    await useSession(null);
  }
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
  const table = { projects: "projects", members: "team_members", resources: "resources" }[collection];
  const { error } = await supabaseClient.from(table).delete().eq("id", id);
  if (error) throw error;
  await loadLiveState();
}

function postTemplate(post) {
  const attachment = post.link
    ? `<a class="attachment" href="${escapeHtml(post.link)}" target="_blank" rel="noreferrer">
        <div class="file-icon">+</div><div><strong>${escapeHtml(post.linkLabel || "Shared link")}</strong><br><span>Open linked resource</span></div>
      </a>`
    : "";
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
  const role = state.role;
  document.body.dataset.role = role;
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.hidden = role !== "admin";
  });
  document.getElementById("sidebar-name").textContent = currentProfile?.full_name || currentUser?.email || "Team member";
  document.getElementById("sidebar-role").textContent = role === "admin" ? "Administrator" : "Team member";

  const upcomingCount = (function() { try { return JSON.parse(localStorage.getItem("computelab_upcoming") || "[]").length; } catch { return 0; } })();
  document.getElementById("stats").innerHTML = [
    [state.projects.filter((project) => project.status === "Active").length, "Active projects"],
    [state.members.length, "Team members"],
    [state.resources.length, "Shared resources"],
    [upcomingCount, "Upcoming talks"]
  ].map(([number, label]) => `<div class="stat"><strong>${String(number).padStart(2, "0")}</strong><span>${label}</span></div>`).join("");

  document.getElementById("overview-posts").innerHTML = state.posts.slice(0, 2).map(postTemplate).join("") || empty("No updates have been posted yet.");
  document.getElementById("feed-list").innerHTML = state.posts.map(postTemplate).join("") || empty("No updates have been posted yet.");
  document.getElementById("overview-resources").innerHTML = state.resources.slice(0, 3).map(resourceTemplate).join("") || empty("No resources have been added yet.");
  document.getElementById("resources-list").innerHTML = state.resources.map(resourceTemplate).join("") || empty("No resources have been added yet.");
  document.getElementById("overview-members").innerHTML = state.members.slice(0, 4).map((member) =>
    `<div class="avatar ${escapeHtml(member.color)}" title="${escapeHtml(member.name)}">${escapeHtml(initials(member.name))}</div>`
  ).join("") + (state.members.length > 4 ? `<div class="more">+${state.members.length - 4}</div>` : "");
  document.getElementById("projects-list").innerHTML = state.projects.map((project) =>
    `<article class="info-card"><span class="tag">${escapeHtml(project.status)}</span><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.description)}</p><div class="meta">${escapeHtml(project.group)}</div></article>`
  ).join("") || empty("No projects have been added yet.");
  document.getElementById("members-list").innerHTML = state.members.map((member) =>
    `<article class="info-card"><div class="avatar ${escapeHtml(member.color)}">${escapeHtml(initials(member.name))}</div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.email)}</p><div class="meta">${escapeHtml(member.group)} | ${escapeHtml(member.role)}</div></article>`
  ).join("") || empty("No team members have been added yet.");

  renderAdminLists();
  setPresentationLinks();
}

function renderAdminLists() {
  document.getElementById("admin-project-list").innerHTML = state.projects.map((item) =>
    adminRow(item.id, "projects", item.name, `${item.group} | ${item.status}`)
  ).join("") || empty("No projects yet.");
  document.getElementById("admin-member-list").innerHTML = state.members.map((item) =>
    adminRow(item.id, "members", item.name, `${item.group} | ${item.role}`)
  ).join("") || empty("No members yet.");
  document.getElementById("admin-resource-list").innerHTML = state.resources.map((item) =>
    adminRow(item.id, "resources", item.name, item.type)
  ).join("") || empty("No resources yet.");
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
  ["presentation-link", "presentation-page-link"].forEach((id) => {
    const link = document.getElementById(id);
    link.href = url || "#";
    link.onclick = url ? null : (event) => {
      event.preventDefault();
      notify("Ask an admin to add the presentation app URL in Settings.");
    };
  });
  document.querySelector("#settings-form [name='presentationUrl']").value = url;
}

function switchView(view) {
  if (view === "admin" && state.role !== "admin") {
    notify("Only an admin can open the management workspace.");
    view = "overview";
  }
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}-view`));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAdmin(tab) {
  if (state.role !== "admin") return;
  switchView("admin");
  switchAdminTab(tab);
}

function switchAdminTab(tab) {
  document.querySelectorAll(".admin-section").forEach((section) => section.classList.toggle("active", section.id === `admin-${tab}`));
  document.querySelectorAll("[data-admin-tab]").forEach((button) => button.classList.toggle("active", button.dataset.adminTab === tab));
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function resetAdminForm(type) {
  const form = document.getElementById(`${type}-form`);
  form.reset();
  document.getElementById(`${type}-form-title`).textContent = type === "member" ? "Add team member" : `Add ${type}`;
  document.getElementById(`${type}-submit`).textContent = type === "member" ? "Add member" : `Add ${type}`;
  form.querySelector("[data-cancel-edit]").classList.remove("visible");
}

function startEdit(collection, id) {
  const type = collection === "members" ? "member" : collection.slice(0, -1);
  const item = state[collection].find((candidate) => candidate.id === id);
  if (!item) return;
  const form = document.getElementById(`${type}-form`);
  Object.entries(item).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
  document.getElementById(`${type}-form-title`).textContent = type === "member" ? "Edit team member" : `Edit ${type}`;
  document.getElementById(`${type}-submit`).textContent = "Save changes";
  form.querySelector("[data-cancel-edit]").classList.add("visible");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) switchView(viewButton.dataset.view);
  const adminButton = event.target.closest("[data-open-admin]");
  if (adminButton) openAdmin(adminButton.dataset.openAdmin);
  const tabButton = event.target.closest("[data-admin-tab]");
  if (tabButton) switchAdminTab(tabButton.dataset.adminTab);
  const editButton = event.target.closest("[data-edit]");
  if (editButton && state.role === "admin") startEdit(editButton.dataset.edit, editButton.dataset.id);
  const cancelButton = event.target.closest("[data-cancel-edit]");
  if (cancelButton) resetAdminForm(cancelButton.dataset.cancelEdit);
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton && state.role === "admin") {
    try {
      await removeRecord(removeButton.dataset.remove, removeButton.dataset.id);
      notify("Item removed.");
    } catch (error) {
      showError(error);
    }
  }
});

document.getElementById("post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = readForm(event.currentTarget);
  try {
    await addRecord("posts", { content: values.content, link_url: values.link || null, link_label: values.link ? "Shared resource" : null, author_id: currentUser.id });
    event.currentTarget.reset();
    notify("Update shared with the team.");
  } catch (error) {
    showError(error);
  }
});

document.getElementById("project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = readForm(event.currentTarget);
  const payload = { name: values.name, group_name: values.group, description: values.description, status: values.status, created_by: currentUser.id };
  try {
    if (values.id) await updateRecord("projects", values.id, payload);
    else await addRecord("projects", payload);
    resetAdminForm("project");
    notify(values.id ? "Project updated." : "Project added.");
  } catch (error) {
    showError(error);
  }
});

document.getElementById("member-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = readForm(event.currentTarget);
  const payload = { full_name: values.name, email: values.email, group_name: values.group, directory_role: values.role, created_by: currentUser.id };
  try {
    if (values.id) await updateRecord("team_members", values.id, payload);
    else await addRecord("team_members", payload);
    resetAdminForm("member");
    notify(values.id ? "Team member updated." : "Team member added.");
  } catch (error) {
    showError(error);
  }
});

document.getElementById("resource-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = readForm(event.currentTarget);
  const payload = { name: values.name, resource_type: values.type, url: values.url, created_by: currentUser.id };
  try {
    if (values.id) await updateRecord("resources", values.id, payload);
    else await addRecord("resources", payload);
    resetAdminForm("resource");
    notify(values.id ? "Resource updated." : "Resource added.");
  } catch (error) {
    showError(error);
  }
});

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = readForm(event.currentTarget);
  try {
    const { error } = await supabaseClient.from("workspace_settings").update({ presentation_url: values.presentationUrl, updated_by: currentUser.id, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) throw error;
    await loadLiveState();
    notify("Workspace settings saved.");
  } catch (error) {
    showError(error);
  }
});

document.getElementById("auth-button").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

document.getElementById("auth-close").addEventListener("click", () => {
  if (currentUser) document.getElementById("auth-modal").hidden = true;
});

document.getElementById("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = readForm(event.currentTarget);
  setAuthStatus("Signing in...");
  const { error } = await supabaseClient.auth.signInWithPassword({ email: values.email, password: values.password });
  if (error) handleAuthError(error);
});

document.getElementById("signup-button").addEventListener("click", async () => {
  const values = readForm(document.getElementById("auth-form"));
  if (!values.email || !values.password || !values.name) return setAuthStatus("Enter your name, email, and password first.", true);
  setSignupPending(true);
  setAuthStatus("Creating your account...");
  const { data, error } = await supabaseClient.auth.signUp({ email: values.email, password: values.password, options: { data: { full_name: values.name } } });
  setSignupPending(false);
  if (error) return handleAuthError(error);
  if (!data.session) setAuthStatus("Account created. Confirm your email if required, then sign in.");
});

document.getElementById("forgot-password").addEventListener("click", async () => {
  const email = document.querySelector("#auth-form [name='email']").value;
  if (!email) return setAuthStatus("Enter your email address first.", true);
  setAuthStatus("Sending a password recovery email...");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split("#")[0] });
  if (error) return handleAuthError(error);
  setAuthStatus("Password recovery email sent. Open the link in that email.");
});

document.getElementById("password-update-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = readForm(event.currentTarget);
  const { error } = await supabaseClient.auth.updateUser({ password: values.password });
  if (error) return handleAuthError(error);
  document.getElementById("password-update-form").hidden = true;
  document.getElementById("auth-form").hidden = false;
  setAuthStatus("Password updated. You can continue into the workspace.");
});

document.getElementById("search").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  if (!query) return;
  const matches = [...state.projects, ...state.resources, ...state.posts].filter((item) =>
    JSON.stringify(item).toLowerCase().includes(query)
  ).length;
  notify(`${matches} matching item${matches === 1 ? "" : "s"} found.`);
});

// --- PDF presentation ---
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
  ["pdf-present-btn", "pdf-present-btn-page"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => input.click());
  });
  document.getElementById("pdf-close").addEventListener("click", () => {
    document.getElementById("pdf-viewer").hidden = true;
    document.getElementById("pdf-frame").src = "";
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
  });
})();

// --- Upcoming events (localStorage) ---
(function initUpcoming() {
  const STORE_KEY = "computelab_upcoming";

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
  }
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
      ? events.map((ev, i) =>
          `<div class="upcoming">
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

  document.getElementById("upcoming-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    const events = load();
    const entry = { date: values.date.trim().toUpperCase(), title: values.title.trim(), details: values.details.trim() };
    if (values.idx !== "") events[Number(values.idx)] = entry;
    else events.push(entry);
    save(events);
    hideForm();
  });

  document.getElementById("upcoming-list").addEventListener("click", (event) => {
    const editBtn = event.target.closest("[data-edit-upcoming]");
    if (editBtn) { showForm(Number(editBtn.dataset.editUpcoming)); return; }
    const removeBtn = event.target.closest("[data-remove-upcoming]");
    if (removeBtn) {
      const events = load();
      events.splice(Number(removeBtn.dataset.removeUpcoming), 1);
      save(events);
    }
  });

  renderUpcoming();
})();

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") {
    document.getElementById("auth-modal").hidden = false;
    document.getElementById("auth-form").hidden = true;
    document.getElementById("password-update-form").hidden = false;
    setAuthStatus("Enter a new password for your account.");
    return;
  }
  if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
    window.setTimeout(() => useSession(session?.user || null), 0);
  }
  if (event === "SIGNED_OUT") {
    window.setTimeout(() => useSession(null), 0);
    notify("Signed out.");
  }
});

document.getElementById("today").textContent = new Intl.DateTimeFormat("en", { weekday: "long", day: "2-digit", month: "short" }).format(new Date());
