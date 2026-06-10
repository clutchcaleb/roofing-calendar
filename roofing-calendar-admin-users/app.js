const SUPABASE_URL = "https://tsoltsgajvvvgejvlfdz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzb2x0c2dhanZ2dmdlanZsZmR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNTU4NTMsImV4cCI6MjA5NjYzMTg1M30.nmNWNKG7Vo8BWahDDk69Bf_wddZmuXPfqMdqkOdt4DA";
const PUBLIC_SITE_URL = "https://clutchcaleb.github.io/roofing-calendar/";
const EMAIL_CONFIRMATION_MESSAGE = "Account not found or password is incorrect.";
const APP_SESSION_KEY = "roots_calendar_app_user_id";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const eventTypes = {
  inspection: {
    label: "INSPECTION",
    results: ["no show", "no damage", "claim filed", "contingency", "retail"],
  },
  adjuster: {
    label: "ADJUSTER",
    results: ["no show", "rescheduled", "approved", "denied"],
  },
  followup: {
    label: "FOLLOW UP",
    results: ["contingency", "claim filed", "retail", "no show"],
  },
};

const defaultUsers = [];

const state = {
  page: "calendar",
  viewMode: "month",
  hourHeight: 64,
  viewDate: startOfMonth(new Date()),
  selectedEventId: null,
  previewEventId: null,
  drawerCollapsed: false,
  draftDate: toDateInputValue(new Date()),
  addressSuggestions: [],
  userGroupOpen: {},
  draftEventIds: [],
  users: [],
  currentUserId: "",
  currentUserRole: "rep",
  events: [],
  loading: true,
  reportUserIds: [],
  reportStartDate: toDateInputValue(startOfMonth(new Date())),
  reportEndDate: toDateInputValue(new Date()),
  expandedReportUserIds: [],
  pendingToast: "",
};

function userFromName(name) {
  const parts = name.trim().split(/\s+/);
  return {
    id: crypto.randomUUID(),
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
    phone: "",
    email: "",
  };
}

function userName(user) {
  const firstName = user.firstName?.startsWith("pwd:") ? "" : user.firstName;
  return [firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "User";
}

function userNames(ids) {
  return ids.map((id) => userName(state.users.find((user) => user.id === id) || { email: id })).join(", ");
}

function migrateEvent(event) {
  const startTime = event.startTime || event.time || "09:00";
  return {
    ...event,
    time: startTime,
    startTime,
    endTime: event.endTime || addOneHour(startTime),
    setter: migrateUserValues(event.setter || []),
    salesman: migrateUserValues(event.salesman || []),
  };
}

function migrateUserValues(values) {
  return values.map((value) => {
    const match = state.users.find((user) => user.id === value || userName(user) === value);
    return match ? match.id : value;
  });
}

async function loadAppData() {
  state.currentUserId = localStorage.getItem(APP_SESSION_KEY) || "";
  if (!state.currentUserId) {
    state.loading = false;
    render();
    return;
  }
  const [{ data: profiles, error: profileError }, { data: events, error: eventError }] = await Promise.all([
    db.from("profiles").select("id, first_name, last_name, phone, email, role").order("email"),
    db.from("calendar_events").select("id, payload").order("date"),
  ]);
  if (profileError || eventError) {
    state.pendingToast = "Run supabase-schema.sql in Supabase, then reload.";
  }
  state.users = (profiles || []).map(profileFromRow);
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  state.currentUserRole = currentUser?.role || "rep";
  state.events = (events || []).map((row) => migrateEvent(row.payload || { id: row.id }));
  state.reportUserIds = state.users.map((user) => user.id);
  state.loading = false;
  render();
}

async function ensureProfile(user) {
  const meta = user.user_metadata || {};
  if (!user.email && !meta.email) return;
  const profile = {
    id: user.id,
    first_name: meta.firstName || meta.first_name || "",
    last_name: meta.lastName || meta.last_name || "",
    phone: meta.phone || "",
    email: user.email || meta.email || "",
    role: meta.role || "rep",
  };
  await db.from("profiles").upsert(profile, { onConflict: "id", ignoreDuplicates: true });
}

function profileFromRow(row) {
  return {
    id: row.id,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    phone: row.phone || "",
    email: row.email || "",
    role: row.role || "rep",
  };
}

function currentUser() {
  return state.users.find((user) => user.id === state.currentUserId) || null;
}

function isAdmin() {
  return currentUser()?.role === "admin" || state.currentUserRole === "admin";
}

function eventRow(event) {
  return {
    id: event.id,
    type: event.type,
    date: event.date,
    start_time: eventStart(event),
    end_time: eventEnd(event),
    customer_name: customerName(event),
    address: event.address || "",
    payload: event,
    updated_at: new Date().toISOString(),
  };
}

async function saveEvents() {
  if (!state.currentUserId) return;
  const rows = state.events.filter((event) => !state.draftEventIds.includes(event.id)).map(eventRow);
  if (!rows.length) return;
  const { error } = await db.from("calendar_events").upsert(rows, { onConflict: "id" });
  if (error) toast("Event could not sync.");
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fromDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatMonthDay(date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function formatLongDate(dateKey) {
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(fromDateKey(dateKey));
}

function viewLabel() {
  if (state.viewMode === "month") return formatMonth(state.viewDate);
  if (state.viewMode === "day") return formatMonthDay(state.viewDate);
  const start = startOfWeek(state.viewDate);
  return `${formatMonthDay(start)} - ${formatMonthDay(addDays(start, 6))}`;
}

function viewModeLabel() {
  if (state.viewMode === "month") return "30";
  if (state.viewMode === "week") return "7";
  return "1";
}

function nextViewMode() {
  if (state.viewMode === "month") return "week";
  if (state.viewMode === "week") return "day";
  return "month";
}

function formatTime(value) {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hour, minute || 0, 0, 0);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

function customerName(event) {
  return [event.customerFirstName, event.customerLastName].filter(Boolean).join(" ").trim();
}

function eventTitle(event) {
  const name = customerName(event) || "New Customer";
  return `${eventTypes[event.type].label}: ${name}`;
}

function addOneHour(time) {
  const [hour, minute] = time.split(":").map(Number);
  const endHour = Math.min(hour + 1, 23);
  return `${String(endHour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}`;
}

function eventStart(event) {
  return event.startTime || event.time || "09:00";
}

function eventEnd(event) {
  return event.endTime || addOneHour(eventStart(event));
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

function eventDurationHours(event) {
  const start = timeToMinutes(eventStart(event));
  const end = Math.max(timeToMinutes(eventEnd(event)), start + 15);
  return Math.max((end - start) / 60, 0.25);
}

function emptyEvent(type = "inspection", date = state.draftDate) {
  const startTime = "09:00";
  return {
    id: crypto.randomUUID(),
    type,
    date,
    time: startTime,
    startTime,
    endTime: addOneHour(startTime),
    customerFirstName: "",
    customerLastName: "",
    address: "",
    addressVerified: false,
    email: "",
    phone: "",
    occupancy: "homeowner",
    inspectionResults: [],
    setter: [],
    salesman: [],
    adjusterName: "",
    adjusterPhone: "",
    insuranceCompany: "",
    claimNumber: "",
    adjusterResults: [],
    approvedAmount: "",
    followupResults: [],
    notes: "",
    parentInspectionId: "",
  };
}

function render() {
  document.getElementById("app").innerHTML = state.loading ? loadingHtml() : state.currentUserId ? appHtml() : loginHtml();
  bind();
  centerCurrentTimeSlot();
  if (state.pendingToast) {
    const message = state.pendingToast;
    state.pendingToast = "";
    toast(message);
  }
}

function loadingHtml() {
  return `
    <main class="login-shell">
      <section class="login-panel">
        <h1>calendar</h1>
        <p class="muted">Loading...</p>
      </section>
      <div id="toast" class="toast"></div>
    </main>
  `;
}

function loginHtml() {
  return `
    <main class="login-shell">
      <section class="login-panel">
        <h1>calendar</h1>
        <div class="field">
          <label for="loginEmail">Email</label>
          <input id="loginEmail" name="email" type="email" autocomplete="email" required>
        </div>
        <div class="field">
          <label for="loginPassword">Password</label>
          <input id="loginPassword" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="primary-btn" data-action="login">Login</button>
        <button class="secondary-btn" data-action="show-create-user">Create New User</button>
      </section>
      ${createUserHtml("login")}
      <div id="toast" class="toast"></div>
    </main>
  `;
}

function appHtml() {
  return `
    <main class="shell">
      <header class="topbar">
        <nav class="tabs">
          <button class="tab ${state.page === "calendar" ? "active" : ""}" data-action="page" data-page="calendar" data-short="C">Calendar</button>
          <button class="tab ${state.page === "reports" ? "active" : ""}" data-action="page" data-page="reports" data-short="D">Data</button>
          ${isAdmin() ? `<button class="tab ${state.page === "admin" ? "active" : ""}" data-action="page" data-page="admin" data-short="A">Admin</button>` : ""}
        </nav>
        ${state.page === "calendar" ? calendarToolbarHtml() : ""}
        <div class="toolbar-spacer"></div>
        ${state.page === "reports" && isAdmin() ? `<button class="secondary-btn" data-action="page" data-page="admin">Admin</button>` : ""}
        ${(state.page === "reports" || state.page === "admin") ? `<button class="secondary-btn" data-action="logout">Logout</button>` : ""}
      </header>
      ${state.page === "calendar" ? calendarPageHtml() : state.page === "admin" ? adminPageHtml() : reportsPageHtml()}
      ${state.page === "calendar" ? `<button class="fab" title="Create event" data-action="create" data-date="${toDateInputValue(new Date())}">+</button>` : ""}
      ${state.page === "calendar" && state.viewMode !== "month" ? `<button class="height-fab" title="Adjust hour height" data-action="hour-height">↕</button>` : ""}
    </main>
    ${drawerHtml()}
    ${previewHtml()}
    ${createUserHtml("app")}
    <div id="toast" class="toast"></div>
  `;
}

function calendarToolbarHtml() {
  return `
    <button class="today-btn" data-action="today">Today</button>
    <nav class="nav">
      <button class="icon-btn" title="Previous" data-action="prev">‹</button>
      <button class="icon-btn" title="Next" data-action="next">›</button>
    </nav>
    <div class="current-label">${viewLabel()}</div>
    <div class="view-switch">
      ${[["month", "30"], ["week", "7"], ["day", "1"]].map(([mode, label]) => `
        <button class="seg-btn ${state.viewMode === mode ? "active" : ""}" data-action="view-mode" data-mode="${mode}">${label}</button>
      `).join("")}
    </div>
    <button class="mobile-view-cycle" data-action="cycle-view">${viewModeLabel()}</button>
  `;
}

function calendarPageHtml() {
  return `<section class="calendar-wrap">${calendarHtml()}</section>`;
}

function calendarHtml() {
  if (state.viewMode === "day") return dayViewHtml(state.viewDate);
  if (state.viewMode === "week") return weekViewHtml();
  return monthViewHtml();
}

function monthViewHtml() {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const first = startOfMonth(state.viewDate);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = toDateInputValue(new Date());
  const cells = [];

  weekdays.forEach((day) => cells.push(`<div class="weekday">${day}</div>`));
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    const dateKey = toDateInputValue(date);
    const isOutside = date.getMonth() !== state.viewDate.getMonth();
    const dayEvents = eventsForDate(dateKey);
    cells.push(`
      <div class="day ${isOutside ? "outside" : ""} ${dateKey === today ? "today" : ""}" data-action="open-day" data-date="${dateKey}">
        <div class="day-head">
          <span class="day-number">${date.getDate()}</span>
          <button class="add-mini" title="Create event" data-action="create" data-date="${dateKey}">+</button>
        </div>
        ${monthEventSummaryHtml(dayEvents)}
      </div>
    `);
  }
  return `<div class="calendar">${cells.join("")}</div>`;
}

function monthEventSummaryHtml(events) {
  return `
    <div class="month-counts">
      ${Object.keys(eventTypes).map((type) => {
        const count = events.filter((event) => event.type === type).length;
        return `<div class="month-count ${type} ${count === 0 ? "empty" : ""}" title="${eventTypes[type].label}"><span>${count}</span></div>`;
      }).join("")}
    </div>
  `;
}

function weekViewHtml() {
  const start = startOfWeek(state.viewDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return timeGridHtml(days);
}

function dayViewHtml(date) {
  return timeGridHtml([date]);
}

function timeGridHtml(days) {
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  return `
    <div class="time-grid" style="--hour-height: ${state.hourHeight}px; --day-count: ${days.length};">
      <div class="time-corner"></div>
      ${days.map((date) => `<div class="time-day-head">${formatMonthDay(date)}<button class="add-mini" title="Create event" data-action="create" data-date="${toDateInputValue(date)}">+</button></div>`).join("")}
      ${hours.map((hour) => `
        <div class="time-label">${hourLabel(hour)}</div>
        ${days.map((date) => timeCellHtml(date, hour)).join("")}
      `).join("")}
    </div>
  `;
}

function timeCellHtml(date, hour) {
  const dateKey = toDateInputValue(date);
  const events = eventsForDate(dateKey).filter((event) => Number(eventStart(event).slice(0, 2)) === hour);
  const now = new Date();
  const isCurrentHour = dateKey === toDateInputValue(now) && hour === now.getHours();
  const marker = isCurrentHour ? `<div class="current-time-marker" style="top: ${(now.getMinutes() / 60) * 100}%"><span>${formatTime(toTimeInputValue(now))}</span></div>` : "";
  return `<div class="time-cell ${isCurrentHour ? "has-current-time" : ""}" data-action="set-time-slot" data-date="${dateKey}" data-hour="${hour}" ${isCurrentHour ? "data-current-time-cell=\"true\"" : ""}>${marker}${eventRowsHtml(events, true)}</div>`;
}

function hourLabel(hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat("en", { hour: "numeric" }).format(date);
}

function toTimeInputValue(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function eventsForDate(dateKey) {
  return state.events
    .filter((event) => event.date === dateKey)
    .sort((a, b) => eventStart(a).localeCompare(eventStart(b)));
}

function eventRowsHtml(events, timed = false) {
  if (!timed) {
    return events.map((event) => `
      <div class="event-row vertical">
        ${eventChipHtml(event)}
      </div>
    `).join("");
  }

  const groups = events.reduce((acc, event) => {
    const key = eventStart(event) || "all-day";
    acc[key] = acc[key] || [];
    acc[key].push(event);
    return acc;
  }, {});
  return Object.values(groups).map((group) => `
    <div class="event-row">
      ${group.map((event) => eventChipHtml(event, timed)).join("")}
    </div>
  `).join("");
}

function eventChipHtml(event, timed = false) {
  const style = timed ? ` style="--event-duration: ${eventDurationHours(event)};"` : "";
  return `
    <button class="event-chip ${event.type}" data-action="preview" data-id="${event.id}"${style}>
      ${timed ? chipStatusHtml(event) : ""}
      <span class="chip-title">${escapeHtml(eventTitle(event))}</span>
      <span class="chip-time">${formatTime(eventStart(event))} - ${formatTime(eventEnd(event))}</span>
    </button>
  `;
}

function chipStatusHtml(event) {
  const results = eventResults(event);
  if (!results.length) return "";
  const isNoShow = results.some((result) => result.toLowerCase().includes("no show"));
  const hasOtherResult = results.some((result) => !result.toLowerCase().includes("no show"));
  if (!isNoShow && !hasOtherResult) return "";
  return `<span class="chip-status ${isNoShow ? "bad" : "good"}">${isNoShow ? "×" : "✓"}</span>`;
}

function reportsPageHtml() {
  const selectedUsers = state.users.filter((user) => state.reportUserIds.includes(user.id));
  return `
    <section class="reports">
      <div class="reports-head">
        <div class="report-date-row">
          <div class="field">
            <label for="reportStartDate">Start date</label>
            <input id="reportStartDate" name="reportStartDate" type="date" value="${state.reportStartDate}">
          </div>
          <div class="field">
            <label for="reportEndDate">End date</label>
            <input id="reportEndDate" name="reportEndDate" type="date" value="${state.reportEndDate}">
          </div>
        </div>
        <div class="field full">
          <label>Users</label>
          <div class="segment">
            ${state.users.map((user) => `
              <label class="check-pill">
                <input type="checkbox" name="reportUsers" value="${user.id}" ${state.reportUserIds.includes(user.id) ? "checked" : ""}>
                ${escapeHtml(userName(user))}
              </label>
            `).join("")}
          </div>
        </div>
        <button class="primary-btn" data-action="download-report">Download Data</button>
      </div>
      <div class="report-grid">
        ${selectedUsers.map((user) => reportCardHtml(user)).join("") || `<div class="empty-note">Select users to view data.</div>`}
      </div>
    </section>
  `;
}

function reportCardHtml(user) {
  const rangeEvents = reportEvents();
  const inspectionsSet = rangeEvents.filter((event) => isSetterInspectionForUser(event, user.id));
  const nextWeekEnd = addDays(new Date(), 7);
  const nextWeek = inspectionsSet.filter((event) => {
    const date = fromDateKey(event.date);
    return date >= new Date(new Date().toDateString()) && date <= nextWeekEnd;
  });
  const salesInspections = rangeEvents.filter((event) => event.type === "inspection" && event.salesman.includes(user.id));
  const resultCounts = eventTypes.inspection.results.reduce((acc, result) => {
    acc[result] = salesInspections.filter((event) => event.inspectionResults.includes(result)).length;
    return acc;
  }, {});

  return `
    <article class="report-card">
      <div class="report-summary">
        <h2>${escapeHtml(userName(user))}</h2>
        <div class="metric"><strong>${inspectionsSet.length}</strong><span>setter inspections</span></div>
        <div class="metric"><strong>${nextWeek.length}</strong><span>next 7 days</span></div>
        <div class="metric"><strong>${salesInspections.length}</strong><span>salesman inspections</span></div>
        <button class="secondary-btn" data-action="toggle-report-detail" data-id="${user.id}">Detailed Display</button>
      </div>
      <div class="result-grid">
        ${Object.entries(resultCounts).map(([result, count]) => `<div><strong>${count}</strong><span>${escapeHtml(result)}</span></div>`).join("")}
      </div>
      ${state.expandedReportUserIds.includes(user.id) ? reportDetailHtml(user) : ""}
    </article>
  `;
}

function reportDetailHtml(user) {
  const userEvents = reportEvents().filter((event) => event.setter.includes(user.id) || event.salesman.includes(user.id));
  return `
    <div class="report-detail">
      ${userEvents.map((event) => `
        <button data-action="preview" data-id="${event.id}">
          <strong>${escapeHtml(eventTitle(event))}</strong>
          <span>${event.date} · ${formatTime(eventStart(event))} - ${formatTime(eventEnd(event))} · ${escapeHtml(resultText(event) || "no result")}</span>
          <span>Setter: ${escapeHtml(userNames(event.setter) || "None")} · Salesman: ${escapeHtml(userNames(event.salesman) || "None")}</span>
        </button>
      `).join("") || `<span>No calendar events for this user.</span>`}
    </div>
  `;
}

function adminPageHtml() {
  if (!isAdmin()) {
    return `<section class="admin-page"><div class="admin-card"><h1>Admin</h1><p class="empty-note">You do not have permission to manage users.</p></div></section>`;
  }

  const users = [...state.users].sort((a, b) => userName(a).localeCompare(userName(b)));

  return `
    <section class="admin-page">
      <div class="admin-card">
        <div class="admin-head">
          <div>
            <h1>Admin</h1>
            <p>Manage user permissions and delete users.</p>
          </div>
          <button class="primary-btn" data-action="show-create-user">Create New User</button>
        </div>
        <div class="admin-table">
          <div class="admin-row admin-row-head">
            <span>User</span>
            <span>Email</span>
            <span>Permission</span>
            <span>Actions</span>
          </div>
          ${users.map(adminUserRowHtml).join("") || `<div class="empty-note">No users found.</div>`}
        </div>
      </div>
    </section>
  `;
}

function adminUserRowHtml(user) {
  const isSelf = user.id === state.currentUserId;
  const assignmentCount = state.events.filter((event) => event.setter.includes(user.id) || event.salesman.includes(user.id)).length;
  return `
    <div class="admin-row">
      <span>
        <strong>${escapeHtml(userName(user))}</strong>
        ${isSelf ? `<em>You</em>` : ""}
      </span>
      <span>${escapeHtml(user.email || "No email")}</span>
      <span class="role-badge ${user.role === "admin" ? "admin" : "rep"}">${user.role === "admin" ? "Admin" : "Rep"}</span>
      <span class="admin-actions">
        <button class="secondary-btn" data-action="make-admin" data-id="${user.id}" ${user.role === "admin" ? "disabled" : ""}>Make Admin</button>
        <button class="secondary-btn" data-action="make-rep" data-id="${user.id}" ${user.role === "rep" || isSelf ? "disabled" : ""}>Make Rep</button>
        <button class="secondary-btn danger-btn" data-action="delete-user" data-id="${user.id}" data-count="${assignmentCount}" ${isSelf ? "disabled" : ""}>Delete</button>
      </span>
    </div>
  `;
}

function drawerHtml() {
  const event = state.selectedEventId
    ? state.events.find((item) => item.id === state.selectedEventId)
    : null;
  if (!event) return `<div class="overlay" id="drawer"></div>`;

  return `
    <div class="overlay open drawer-overlay ${state.drawerCollapsed ? "peek" : ""}" id="drawer">
      <aside class="drawer" role="dialog" aria-modal="true">
        <header class="drawer-head">
          <button class="icon-btn" title="Close" data-action="close">×</button>
          <button class="icon-btn" title="Shrink" data-action="toggle-drawer-size">${state.drawerCollapsed ? "▴" : "▾"}</button>
          <div class="drawer-title">${escapeHtml(eventTitle(event))}</div>
        </header>
        <form class="form" id="eventForm">
          <div class="form-grid">
            <div class="field">
              <label for="type">Event type</label>
              <select id="type" name="type">${typeOptions(event.type)}</select>
            </div>
            <div class="field">
              <label for="date">Date</label>
              <input id="date" name="date" type="date" value="${event.date}" required>
            </div>
            <div class="field">
              <label for="startTime">Start time</label>
              <input id="startTime" name="startTime" type="time" value="${eventStart(event)}" required>
            </div>
            <div class="field">
              <label for="endTime">End time</label>
              <input id="endTime" name="endTime" type="time" value="${eventEnd(event)}" required>
            </div>
            ${customerFields(event)}
            ${typeFields(event)}
          </div>
        </form>
        <footer class="footer-actions">${footerButtons(event)}</footer>
      </aside>
    </div>
  `;
}

function previewHtml() {
  const event = state.previewEventId ? state.events.find((item) => item.id === state.previewEventId) : null;
  if (!event) return `<div class="overlay" id="preview"></div>`;
  return `
    <div class="overlay open" id="preview">
      <aside class="preview-card" role="dialog" aria-modal="true">
        <header class="preview-head">
          <button class="icon-btn" title="Close" data-action="close-preview">×</button>
          <div class="drawer-title">${escapeHtml(eventTitle(event))}</div>
          <button class="icon-btn danger" title="Delete event" data-action="delete-event" data-id="${event.id}">&#128465;</button>
        </header>
        <div class="preview-actions">
          <button class="icon-action" title="Navigate" data-action="navigate-preview" data-id="${event.id}">➤</button>
          <a class="icon-action" title="Call" href="tel:${escapeAttr(event.phone)}">☎</a>
          <button class="icon-action" title="Edit" data-action="edit" data-id="${event.id}">✎</button>
        </div>
        <dl class="preview-details">
          <dt>Date</dt><dd>${formatLongDate(event.date)} ${formatTime(eventStart(event))} - ${formatTime(eventEnd(event))}</dd>
          <dt>Customer</dt><dd>${escapeHtml(customerName(event) || "New Customer")}</dd>
          <dt>Address</dt><dd>${escapeHtml(event.address || "No address")}</dd>
          <dt>Phone</dt><dd>${escapeHtml(event.phone || "No phone")}</dd>
          <dt>Email</dt><dd>${escapeHtml(event.email || "No email")}</dd>
          <dt>Result</dt><dd class="preview-results">${resultBadgesHtml(event)}</dd>
          <dt>Notes</dt><dd>${escapeHtml(event.notes || "No notes")}</dd>
        </dl>
      </aside>
    </div>
  `;
}

function resultText(event) {
  if (event.type === "inspection") return event.inspectionResults.join(", ");
  if (event.type === "adjuster") {
    const amount = event.approvedAmount ? ` ($${event.approvedAmount})` : "";
    return `${event.adjusterResults.join(", ")}${amount}`.trim();
  }
  return event.followupResults.join(", ");
}

function eventResults(event) {
  if (event.type === "inspection") return event.inspectionResults;
  if (event.type === "adjuster") return event.adjusterResults.map((result) => result === "approved" && event.approvedAmount ? `${result} ($${event.approvedAmount})` : result);
  return event.followupResults;
}

function resultBadgesHtml(event) {
  const results = eventResults(event);
  if (!results.length) return `<strong>No result</strong>`;
  return results.map((result) => `<strong class="result-badge ${resultBadgeClass(result)}">${escapeHtml(result)}</strong>`).join("");
}

function resultBadgeClass(result) {
  const clean = result.toLowerCase();
  if (clean.includes("contingency") || clean.includes("retail") || clean.includes("claim filed")) return "good";
  if (clean.includes("no show") || clean.includes("no damage")) return "bad";
  return "neutral";
}

function typeOptions(selected) {
  return Object.entries(eventTypes)
    .map(([value, config]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${config.label}</option>`)
    .join("");
}

function addressSuggestionsHtml() {
  if (!state.addressSuggestions.length) return "";
  return state.addressSuggestions.map((item, index) => `
    <button type="button" data-action="select-address" data-index="${index}">${escapeHtml(item.display_name)}</button>
  `).join("");
}

function customerFields(event) {
  return `
    <div class="form-row name-row">
      <div class="field">
        <label for="customerFirstName">Customer first name</label>
        <input id="customerFirstName" name="customerFirstName" value="${escapeAttr(event.customerFirstName)}" required>
      </div>
      <div class="field">
        <label for="customerLastName">Customer last name</label>
        <input id="customerLastName" name="customerLastName" value="${escapeAttr(event.customerLastName)}" required>
      </div>
    </div>
    <div class="field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeAttr(event.email)}" ${event.type === "inspection" ? "required" : ""}>
    </div>
    <div class="field">
      <label for="phone">Phone</label>
      <input id="phone" name="phone" type="tel" value="${escapeAttr(event.phone)}" ${event.type === "inspection" ? "required" : ""}>
    </div>
    <div class="field">
      <label for="occupancy">Homeowner or renter</label>
      <select id="occupancy" name="occupancy">
        <option value="homeowner" ${event.occupancy === "homeowner" ? "selected" : ""}>Homeowner</option>
        <option value="renter" ${event.occupancy === "renter" ? "selected" : ""}>Renter</option>
      </select>
    </div>
    <div class="field full">
      <label for="address">Address</label>
      <div class="map-row">
        <input id="address" name="address" autocomplete="street-address" value="${escapeAttr(event.address)}" required>
      </div>
      <div id="addressSuggestions" class="address-suggestions">${addressSuggestionsHtml()}</div>
    </div>
  `;
}

function typeFields(event) {
  if (event.type === "inspection") {
    return `
      ${checkGroup("Inspection results", "inspectionResults", eventTypes.inspection.results, event.inspectionResults)}
      ${userGroup("Setter", "setter", event.setter)}
      ${userGroup("Salesman", "salesman", event.salesman)}
      <div class="field full">
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes">${escapeHtml(event.notes)}</textarea>
      </div>
    `;
  }

  if (event.type === "adjuster") {
    return `
      <div class="field">
        <label for="adjusterName">Adjuster name</label>
        <input id="adjusterName" name="adjusterName" value="${escapeAttr(event.adjusterName)}">
      </div>
      <div class="field">
        <label for="adjusterPhone">Adjuster phone</label>
        <input id="adjusterPhone" name="adjusterPhone" type="tel" value="${escapeAttr(event.adjusterPhone)}">
      </div>
      <div class="field">
        <label for="insuranceCompany">Insurance company</label>
        <input id="insuranceCompany" name="insuranceCompany" value="${escapeAttr(event.insuranceCompany)}">
      </div>
      <div class="field">
        <label for="claimNumber">Claim number</label>
        <input id="claimNumber" name="claimNumber" value="${escapeAttr(event.claimNumber)}">
      </div>
      ${checkGroup("Adjuster result", "adjusterResults", eventTypes.adjuster.results, event.adjusterResults)}
      <div class="field">
        <label for="approvedAmount">Approved amount</label>
        <input id="approvedAmount" name="approvedAmount" inputmode="decimal" value="${escapeAttr(event.approvedAmount)}" placeholder="$">
      </div>
      ${userGroup("Salesman", "salesman", event.salesman)}
      <div class="field full">
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes">${escapeHtml(event.notes)}</textarea>
      </div>
    `;
  }

  return `
    ${checkGroup("Follow up result", "followupResults", eventTypes.followup.results, event.followupResults)}
    <div class="field full">
      <label for="notes">Notes</label>
      <textarea id="notes" name="notes">${escapeHtml(event.notes)}</textarea>
    </div>
  `;
}

function checkGroup(label, name, options, selected) {
  return `
    <div class="field full">
      <label>${label}</label>
      <div class="segment">
        ${options.map((option) => `
          <label class="check-pill">
            <input type="checkbox" name="${name}" value="${escapeAttr(option)}" ${selected.includes(option) ? "checked" : ""}>
            ${escapeHtml(option)}
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function userGroup(label, name, selected) {
  const isOpen = Boolean(state.userGroupOpen[name]);
  const selectedCount = selected.length;
  return `
    <div class="field full" data-user-group="${name}">
      <button type="button" class="collapse-btn" data-action="toggle-user-group" data-group="${name}" aria-expanded="${isOpen}">
        <span>${escapeHtml(label)}</span>
        <strong class="${selectedCount > 0 ? "selected" : "empty"}">${selectedCount}</strong>
        <span data-collapse-text>${isOpen ? "Collapse" : "Expand"}</span>
      </button>
      <div class="segment collapsible ${isOpen ? "open" : ""}">
        ${state.users.map((user) => `
          <label class="check-pill">
            <input type="checkbox" name="${name}" value="${user.id}" ${selected.includes(user.id) ? "checked" : ""}>
            ${escapeHtml(userName(user))}
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function footerButtons(event) {
  const buttons = [];
  if (event.type === "inspection") {
    buttons.push(`<button class="secondary-btn" data-action="spawn-adjuster">+ Adjuster</button>`);
    buttons.push(`<button class="secondary-btn" data-action="spawn-followup">+ Follow up</button>`);
  }
  if (event.type === "adjuster") {
    buttons.push(`<button class="secondary-btn" data-action="spawn-followup">+ Follow up</button>`);
  }
  buttons.push(`<button class="primary-btn" data-action="save">Save Event</button>`);
  return buttons.join("");
}

function createUserHtml(context) {
  return `
    <div class="overlay" id="userOverlay" data-context="${context}">
      <aside class="drawer compact" role="dialog" aria-modal="true">
        <header class="drawer-head">
          <button class="icon-btn" title="Close" data-action="close-user">×</button>
          <div class="drawer-title">Create New User</div>
          <button class="primary-btn" data-action="create-user">Save</button>
        </header>
        <form class="form" id="userForm">
          <div class="form-grid">
            <div class="field">
              <label for="newEmail">Email</label>
              <input id="newEmail" name="email" type="email" autocomplete="email" required>
            </div>
            <div class="field">
              <label for="newConfirmEmail">Confirm email</label>
              <input id="newConfirmEmail" name="confirmEmail" type="email" autocomplete="email" required>
            </div>
            <div class="field">
              <label for="newPassword">Password</label>
              <input id="newPassword" name="password" type="password" autocomplete="new-password" minlength="6" required>
            </div>
            <div class="field">
              <label for="newPhone">Phone</label>
              <input id="newPhone" name="phone" type="tel" required>
            </div>
          </div>
        </form>
      </aside>
    </div>
  `;
}

function bind() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", handleAction);
  });
  document.getElementById("addressSuggestions")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='select-address']");
    if (!button) return;
    selectAddress(Number(button.dataset.index));
  });
  const form = document.getElementById("eventForm");
  if (form) {
    form.addEventListener("input", handleFormInput);
    form.addEventListener("change", handleFormInput);
    form.addEventListener("submit", (event) => event.preventDefault());
  }
  const address = document.getElementById("address");
  if (address) {
    address.addEventListener("input", debounce(searchAddress, 350));
  }
  document.querySelectorAll('input[name="reportUsers"]').forEach((input) => {
    input.addEventListener("change", handleReportUserChange);
  });
  document.querySelectorAll("#reportStartDate, #reportEndDate").forEach((input) => {
    input.addEventListener("change", handleReportDateChange);
  });
}

function centerCurrentTimeSlot() {
  if (state.page !== "calendar" || state.viewMode === "month") return;
  window.requestAnimationFrame(() => {
    const cell = document.querySelector("[data-current-time-cell='true']");
    if (!cell) return;
    cell.scrollIntoView({ block: "center", inline: "nearest" });
  });
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "login") return login();
  if (action === "logout") return logout();
  if (action === "show-create-user") return showCreateUser();
  if (action === "close-user") return closeCreateUser();
  if (action === "create-user") return createUser();
  if (action === "page") return setPage(event.currentTarget.dataset.page);
  if (action === "view-mode") return setViewMode(event.currentTarget.dataset.mode);
  if (action === "cycle-view") return setViewMode(nextViewMode());
  if (action === "today") return goToday();
  if (action === "prev" || action === "next") return moveDate(action);
  if (action === "create") return openEvent(emptyEvent("inspection", event.currentTarget.dataset.date));
  if (action === "open-day") return openDay(event);
  if (action === "preview") return previewEvent(event.currentTarget.dataset.id);
  if (action === "edit") return editEvent(event.currentTarget.dataset.id);
  if (action === "close-preview") return closePreview();
  if (action === "close") return closeEvent();
  if (action === "toggle-drawer-size") return toggleDrawerSize();
  if (action === "save") return saveCurrentEvent();
  if (action === "delete-event") return deleteEvent(event.currentTarget.dataset.id);
  if (action === "navigate") return navigateToCurrentAddress();
  if (action === "select-address") return selectAddress(Number(event.currentTarget.dataset.index));
  if (action === "navigate-preview") return navigateEvent(event.currentTarget.dataset.id);
  if (action === "spawn-adjuster") return spawnEvent("adjuster");
  if (action === "spawn-followup") return spawnEvent("followup");
  if (action === "hour-height") return toggleHourHeight();
  if (action === "toggle-user-group") return toggleUserGroup(event.currentTarget.dataset.group);
  if (action === "toggle-report-detail") return toggleReportDetail(event.currentTarget.dataset.id);
  if (action === "download-report") return downloadReport();
  if (action === "make-admin") return updateUserRole(event.currentTarget.dataset.id, "admin");
  if (action === "make-rep") return updateUserRole(event.currentTarget.dataset.id, "rep");
  if (action === "delete-user") return deleteUser(event.currentTarget.dataset.id);
  if (action === "set-time-slot") return setTimeSlot(event);
}

async function login() {
  const input = document.getElementById("loginEmail");
  const password = document.getElementById("loginPassword");
  if (!input?.reportValidity() || !password?.reportValidity()) return;
  const email = input.value.trim().toLowerCase();
  const passwordHash = await hashPassword(email, password.value);
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, first_name, role")
    .eq("email", email)
    .maybeSingle();
  if (profileError || !profile || profile.first_name !== passwordStorageValue(passwordHash)) {
    toast(EMAIL_CONFIRMATION_MESSAGE);
    return;
  }
  localStorage.setItem(APP_SESSION_KEY, profile.id);
  state.currentUserId = profile.id;
  state.currentUserRole = profile.role || "rep";
  state.pendingToast = "Logged in.";
  await loadAppData();
}

async function logout() {
  localStorage.removeItem(APP_SESSION_KEY);
  state.currentUserId = "";
  state.currentUserRole = "rep";
  state.events = [];
  state.users = [];
  render();
}

function showCreateUser() {
  document.getElementById("userOverlay")?.classList.add("open");
}

function closeCreateUser() {
  document.getElementById("userOverlay")?.classList.remove("open");
}

async function createUser() {
  const form = document.getElementById("userForm");
  if (!form || !form.reportValidity()) return;
  const data = new FormData(form);
  const email = data.get("email").trim().toLowerCase();
  const confirmedEmail = data.get("confirmEmail").trim().toLowerCase();
  const password = data.get("password");
  const phone = data.get("phone").trim();
  if (email !== confirmedEmail) {
    toast("Email fields must match.");
    return;
  }
  const passwordHash = await hashPassword(email, password);
  const { data: existing, error: existingError } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existingError) {
    toast(existingError.message);
    return;
  }
  if (existing) {
    toast("An account with this email already exists.");
    return;
  }
  const profile = {
    id: crypto.randomUUID(),
    first_name: passwordStorageValue(passwordHash),
    last_name: "",
    phone,
    email,
    role: "rep",
  };
  const { error: profileError } = await db.from("profiles").upsert(profile, { onConflict: "id" });
  if (profileError) {
    toast(profileError.message);
    return;
  }
  if (state.currentUserId) {
    const newUser = profileFromRow(profile);
    state.users.push(newUser);
    state.reportUserIds.push(newUser.id);
    closeCreateUser();
    form.reset();
    state.pendingToast = "User created.";
    render();
    return;
  }

  state.currentUserId = "";
  state.currentUserRole = "rep";
  state.events = [];
  state.users = [];
  closeCreateUser();
  state.pendingToast = "Account created. Log in with the new password.";
  render();
}

async function hashPassword(email, password) {
  const bytes = new TextEncoder().encode(`${email}:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function passwordStorageValue(hash) {
  return `pwd:${hash}`;
}

function setPage(page) {
  if (page === "admin" && !isAdmin()) {
    toast("Admin permission required.");
    return;
  }
  state.page = page;
  state.selectedEventId = null;
  state.previewEventId = null;
  render();
}

function setViewMode(mode) {
  const previousMode = state.viewMode;
  state.viewMode = mode;
  if (mode === "month") state.viewDate = startOfMonth(state.viewDate);
  if (previousMode === "month" && mode !== "month") state.viewDate = new Date();
  render();
}

function openDay(event) {
  if (event.target.closest(".add-mini")) return;
  state.viewDate = fromDateKey(event.currentTarget.dataset.date);
  state.viewMode = "day";
  render();
}

function goToday() {
  const today = new Date();
  state.viewDate = state.viewMode === "month" ? startOfMonth(today) : today;
  render();
}

function moveDate(action) {
  const direction = action === "next" ? 1 : -1;
  if (state.viewMode === "month") state.viewDate.setMonth(state.viewDate.getMonth() + direction);
  if (state.viewMode === "week") state.viewDate = addDays(state.viewDate, direction * 7);
  if (state.viewMode === "day") state.viewDate = addDays(state.viewDate, direction);
  if (state.viewMode === "month") state.viewDate = startOfMonth(state.viewDate);
  render();
}

function openEvent(event) {
  state.events.push(event);
  state.selectedEventId = event.id;
  state.previewEventId = null;
  state.drawerCollapsed = false;
  saveEvents();
  render();
}

function previewEvent(id) {
  state.previewEventId = id;
  state.selectedEventId = null;
  render();
}

function editEvent(id) {
  state.selectedEventId = id;
  state.previewEventId = null;
  state.drawerCollapsed = false;
  state.page = "calendar";
  render();
}

function closeEvent() {
  state.selectedEventId = null;
  state.drawerCollapsed = false;
  render();
}

function closePreview() {
  state.previewEventId = null;
  render();
}

function toggleDrawerSize() {
  state.drawerCollapsed = !state.drawerCollapsed;
  render();
}

async function deleteEvent(id) {
  const event = state.events.find((item) => item.id === id);
  if (!event) return;
  if (!window.confirm(`Delete ${eventTitle(event)}?`)) return;
  state.events = state.events.filter((item) => item.id !== id);
  state.previewEventId = null;
  state.selectedEventId = state.selectedEventId === id ? null : state.selectedEventId;
  if (state.currentUserId) {
    const { error } = await db.from("calendar_events").delete().eq("id", id);
    if (error) {
      toast("Event could not be deleted.");
      return;
    }
  }
  state.pendingToast = "Event deleted.";
  render();
}

function setTimeSlot(event) {
  if (event.target.closest(".event-chip")) return;
  const model = currentEvent();
  if (!model) return;
  const hour = Number(event.currentTarget.dataset.hour);
  const startTime = `${String(hour).padStart(2, "0")}:00`;
  model.date = event.currentTarget.dataset.date;
  model.startTime = startTime;
  model.time = startTime;
  model.endTime = addOneHour(startTime);
  saveEvents();
  state.pendingToast = "Event time updated.";
  render();
}

function toggleUserGroup(group) {
  state.userGroupOpen[group] = !state.userGroupOpen[group];
  const section = document.querySelector(`[data-user-group="${group}"]`);
  const button = section?.querySelector(".collapse-btn");
  const list = section?.querySelector(".collapsible");
  const text = button?.querySelector("[data-collapse-text]");
  const isOpen = Boolean(state.userGroupOpen[group]);
  if (button) button.setAttribute("aria-expanded", String(isOpen));
  if (list) list.classList.toggle("open", isOpen);
  if (text) text.textContent = isOpen ? "Collapse" : "Expand";
}

function currentEvent() {
  return state.events.find((event) => event.id === state.selectedEventId);
}

function handleFormInput(event) {
  const eventModel = currentEvent();
  if (!eventModel) return;
  const target = event.target;

  if (target.name === "type") {
    eventModel.type = target.value;
    saveEvents();
    render();
    return;
  }

  if (target.type === "checkbox") {
    const values = exclusiveNoShowValues(target);
    eventModel[target.name] = values;
  } else if (target.name) {
    eventModel[target.name] = target.value;
    if (target.name === "startTime") {
      eventModel.time = target.value;
      eventModel.endTime = addOneHour(target.value);
      const endInput = document.getElementById("endTime");
      if (endInput) endInput.value = eventModel.endTime;
    }
    if (target.name === "address") eventModel.addressVerified = false;
  }

  if (eventModel.type === "followup" && target.name === "followupResults") maybeUpdateInspection(eventModel);
  saveEvents();
  renderHeaderOnly();
}

function exclusiveNoShowValues(target) {
  const checked = [...document.querySelectorAll(`input[name="${target.name}"]:checked`)];
  if (target.value === "no show" && target.checked) {
    checked.forEach((item) => {
      if (item !== target) item.checked = false;
    });
    return ["no show"];
  }
  if (target.value !== "no show" && target.checked) {
    const noShow = checked.find((item) => item.value === "no show");
    if (noShow) noShow.checked = false;
  }
  return [...document.querySelectorAll(`input[name="${target.name}"]:checked`)].map((item) => item.value);
}

function renderHeaderOnly() {
  const title = document.querySelector(".drawer-title");
  const event = currentEvent();
  if (title && event) title.textContent = eventTitle(event);
}

function validateCurrentEvent() {
  const form = document.getElementById("eventForm");
  const event = currentEvent();
  if (!form || !event) return null;
  if (!form.reportValidity()) return null;
  if (!event.addressVerified) {
    toast("Select a real address from the dropdown before saving.");
    return null;
  }
  saveEvents();
  return event;
}

function saveCurrentEvent() {
  const event = validateCurrentEvent();
  if (!event) return;
  state.draftEventIds = state.draftEventIds.filter((id) => id !== event.id);
  saveEvents();
  state.selectedEventId = null;
  state.pendingToast = "Event saved.";
  render();
}

function spawnEvent(type) {
  const source = validateCurrentEvent();
  if (!source) return;
  const child = emptyEvent(type, source.date);
  Object.assign(child, {
    customerFirstName: source.customerFirstName,
    customerLastName: source.customerLastName,
    address: source.address,
    addressVerified: source.addressVerified,
    email: source.email,
    phone: source.phone,
    occupancy: source.occupancy,
    salesman: source.salesman,
    setter: source.setter,
    parentInspectionId: source.type === "inspection" ? source.id : source.parentInspectionId,
  });
  state.events.push(child);
  state.draftEventIds.push(child.id);
  state.selectedEventId = child.id;
  state.pendingToast = `${eventTypes[type].label} ready to review.`;
  render();
}

function maybeUpdateInspection(followup) {
  const shouldUpdate = followup.followupResults.some((result) => result === "contingency" || result === "claim filed");
  if (!shouldUpdate || !followup.parentInspectionId) return;
  const inspection = state.events.find((event) => event.id === followup.parentInspectionId);
  if (!inspection) return;
  const confirmed = window.confirm("Update event with this follow up result?");
  if (!confirmed) return;
  followup.followupResults.forEach((result) => {
    if ((result === "contingency" || result === "claim filed") && !inspection.inspectionResults.includes(result)) {
      inspection.inspectionResults.push(result);
    }
  });
  saveEvents();
  toast("Inspection event updated.");
}

function navigateToCurrentAddress() {
  const event = currentEvent();
  navigateAddress(event);
}

function navigateEvent(id) {
  navigateAddress(state.events.find((event) => event.id === id));
}

function navigateAddress(event) {
  if (!event || !event.address.trim()) {
    toast("Enter an address first.");
    return;
  }
  window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.address)}`;
}

function toggleHourHeight() {
  state.hourHeight = state.hourHeight === 64 ? 96 : state.hourHeight === 96 ? 128 : 64;
  render();
}

async function searchAddress(event) {
  const query = event.target.value.trim();
  if (query.length < 5) return;
  try {
    state.addressSuggestions = await lookupAddresses(query, 5);
    const suggestionList = document.getElementById("addressSuggestions");
    if (suggestionList) {
      suggestionList.innerHTML = addressSuggestionsHtml();
    }
  } catch {
    toast("Address search is unavailable right now.");
  }
}

function selectAddress(index) {
  const model = currentEvent();
  const match = state.addressSuggestions[index];
  if (!model || !match) return;
  model.address = match.display_name;
  model.addressVerified = true;
  state.addressSuggestions = [];
  const input = document.getElementById("address");
  if (input) input.value = match.display_name;
  const suggestionList = document.getElementById("addressSuggestions");
  if (suggestionList) suggestionList.innerHTML = "";
  saveEvents();
  state.pendingToast = "Address selected.";
  render();
}

async function lookupAddresses(query, limit) {
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=${limit}&countrycodes=us&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(nominatimUrl, { headers: { Accept: "application/json" } });
    const results = await response.json();
    if (Array.isArray(results) && results.length) return results;
  } catch {
    // Fall through to the Census geocoder.
  }

  const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`;
  const response = await fetch(censusUrl, { headers: { Accept: "application/json" } });
  const data = await response.json();
  return (data.result?.addressMatches || []).slice(0, limit).map((match) => ({
    display_name: match.matchedAddress,
  }));
}

async function updateUserRole(id, role) {
  if (!isAdmin()) {
    toast("Admin permission required.");
    return;
  }

  const user = state.users.find((item) => item.id === id);
  if (!user) return;

  if (id === state.currentUserId && role !== "admin") {
    toast("You cannot remove your own admin permission.");
    return;
  }

  const { error } = await db.from("profiles").update({ role }).eq("id", id);
  if (error) {
    toast("User permission could not be updated.");
    return;
  }

  user.role = role;
  if (id === state.currentUserId) state.currentUserRole = role;
  state.pendingToast = `${userName(user)} is now ${role === "admin" ? "an admin" : "a rep"}.`;
  render();
}

async function deleteUser(id) {
  if (!isAdmin()) {
    toast("Admin permission required.");
    return;
  }

  const user = state.users.find((item) => item.id === id);
  if (!user) return;

  if (id === state.currentUserId) {
    toast("You cannot delete your own account.");
    return;
  }

  const assignedEvents = state.events.filter((event) => event.setter.includes(id) || event.salesman.includes(id));
  const confirmed = window.confirm(`Delete ${userName(user)}? This also removes them from ${assignedEvents.length} assigned event(s).`);
  if (!confirmed) return;

  const changedEvents = assignedEvents.map((event) => ({
    ...event,
    setter: event.setter.filter((userId) => userId !== id),
    salesman: event.salesman.filter((userId) => userId !== id),
  }));

  if (changedEvents.length) {
    const { error: eventError } = await db.from("calendar_events").upsert(changedEvents.map(eventRow), { onConflict: "id" });
    if (eventError) {
      toast("User assignments could not be updated.");
      return;
    }
    const changedById = new Map(changedEvents.map((event) => [event.id, event]));
    state.events = state.events.map((event) => changedById.get(event.id) || event);
  }

  const { error } = await db.from("profiles").delete().eq("id", id);
  if (error) {
    toast("User could not be deleted.");
    return;
  }

  state.users = state.users.filter((item) => item.id !== id);
  state.reportUserIds = state.reportUserIds.filter((userId) => userId !== id);
  state.pendingToast = "User deleted.";
  render();
}

function handleReportUserChange() {
  state.reportUserIds = [...document.querySelectorAll('input[name="reportUsers"]:checked')].map((input) => input.value);
  render();
}

function handleReportDateChange(event) {
  state[event.target.name] = event.target.value;
  render();
}

function eventInReportRange(event) {
  if (state.reportStartDate && event.date < state.reportStartDate) return false;
  if (state.reportEndDate && event.date > state.reportEndDate) return false;
  return true;
}

function reportEvents() {
  return state.events.filter((event) => !state.draftEventIds.includes(event.id)).filter(eventInReportRange);
}

function isSetterInspectionForUser(event, userId) {
  return event.type === "inspection" && event.setter.includes(userId) && !event.inspectionResults.includes("no show");
}

function toggleReportDetail(userId) {
  if (state.expandedReportUserIds.includes(userId)) {
    state.expandedReportUserIds = state.expandedReportUserIds.filter((id) => id !== userId);
  } else {
    state.expandedReportUserIds.push(userId);
  }
  render();
}

function downloadReport() {
  const rows = [
    ["Date Range", state.reportStartDate || "Any", state.reportEndDate || "Any"],
    [],
    ["User", "Setter Inspections", "Next 7 Days", "Salesman Inspections", ...eventTypes.inspection.results],
  ];
  const filteredEvents = reportEvents();
  state.users.filter((user) => state.reportUserIds.includes(user.id)).forEach((user) => {
    const inspectionsSet = filteredEvents.filter((event) => isSetterInspectionForUser(event, user.id));
    const nextWeekEnd = addDays(new Date(), 7);
    const nextWeek = inspectionsSet.filter((event) => {
      const date = fromDateKey(event.date);
      return date >= new Date(new Date().toDateString()) && date <= nextWeekEnd;
    });
    const salesInspections = filteredEvents.filter((event) => event.type === "inspection" && event.salesman.includes(user.id));
    rows.push([
      userName(user),
      inspectionsSet.length,
      nextWeek.length,
      salesInspections.length,
      ...eventTypes.inspection.results.map((result) => salesInspections.filter((event) => event.inspectionResults.includes(result)).length),
    ]);
  });
  rows.push([]);
  rows.push(["User", "Appointment Date", "Start", "End", "Appointment Type", "Customer", "Setter", "Salesman", "Results", "Address", "Notes"]);
  state.users.filter((user) => state.reportUserIds.includes(user.id)).forEach((user) => {
    filteredEvents
      .filter((event) => event.setter.includes(user.id) || event.salesman.includes(user.id))
      .forEach((event) => {
        rows.push([
          userName(user),
          event.date,
          formatTime(eventStart(event)),
          formatTime(eventEnd(event)),
          eventTypes[event.type].label,
          customerName(event),
          userNames(event.setter),
          userNames(event.salesman),
          resultText(event),
          event.address,
          event.notes,
        ]);
      });
  });
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "calendar-user-data.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function debounce(callback, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

function toast(message) {
  const element = document.getElementById("toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => {
    element.classList.remove("show");
  }, 2600);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

loadAppData();
