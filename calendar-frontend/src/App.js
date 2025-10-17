import React, { useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";

import VoiceRecorder from "./components/VoiceRecorder";
import ProfilePanel from "./components/ProfilePanel";
import "./App.css";

function App() {
  // ====== ВАЖНО: базовые URL теперь через прокси Nginx ======
  // по умолчанию фронт шлёт на http://localhost:8080/api/* и http://localhost:8080/whisper/*
  const API_URL = process.env.REACT_APP_API_URL || "/api";
  const WHISPER_URL = process.env.REACT_APP_WHISPER_URL || "/whisper";

  // ===== THEME =====
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // ===== VIEW =====
  const [calendarView, setCalendarView] = useState(
    localStorage.getItem("calendarView") || "dayGridMonth"
  );

  // ===== AUTH / DATA =====
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [events, setEvents] = useState([]);
  const [hideDone, setHideDone] = useState(false);
  const [error, setError] = useState("");

  // Profile panel
  const [profileOpen, setProfileOpen] = useState(false);

  // form + modals
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    color: "#3788d8",
    start_time: "",
    end_time: "",
  });

  const [auth, setAuth] = useState({ username: "", password: "" });

  // fetch events
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/events`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Failed to fetch events");
        }
        const data = await res.json();
        setEvents(data);
        setError("");
      } catch (e) {
        setError(String(e.message || e));
      }
    })();
  }, [token, API_URL]);

  // ===== AUTH =====
  const handleRegister = async () => {
    try {
      const res = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(auth),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Registration failed");
      }
      alert("Регистрация успешна! Теперь войдите.");
      setAuth({ username: "", password: "" });
      setError("");
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  const handleLogin = async () => {
    try {
      const body = new URLSearchParams();
      body.append("username", auth.username);
      body.append("password", auth.password);
      const res = await fetch(`${API_URL}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Login failed");
      }
      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      setToken(data.access_token);
      setAuth({ username: "", password: "" });
      setError("");

      // подтянем профиль, чтобы применить тему и hideDone
      try {
        const pr = await fetch(`${API_URL}/profile`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        if (pr.ok) {
          const p = await pr.json();
          setTheme(p.theme || "dark");
          setHideDone(!!p.hide_done);
        }
      } catch { /* ignore */ }
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  // ===== EVENTS =====
  const resetForm = () => {
    setForm({
      title: "",
      description: "",
      color: "#3788d8",
      start_time: "",
      end_time: "",
    });
    setEditingEvent(null);
    setShowForm(false);
  };

  const handleAddEvent = async () => {
    try {
      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to add event");
      }
      const newEvent = await res.json();
      setEvents((prev) => [...prev, newEvent]);
      resetForm();
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  const handleUpdateEvent = async () => {
    try {
      const res = await fetch(`${API_URL}/events/${editingEvent.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to update event");
      const updated = await res.json();
      setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)));
      resetForm();
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  const handleDeleteEvent = async (eventId) => {
    try {
      const res = await fetch(`${API_URL}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to delete event");
      }
      setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
      setActionModalOpen(false);
      setSelectedEvent(null);
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  const handleMarkDone = async (eventId) => {
    try {
      const res = await fetch(`${API_URL}/events/${eventId}/done`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to mark event as done");
      const updated = await res.json();
      setEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)));
      setActionModalOpen(false);
      setSelectedEvent(null);
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  const handleEventClick = (clickInfo) => {
    const ev = events.find((e) => e.id === Number(clickInfo.event.id));
    if (!ev) return;
    setSelectedEvent(ev);
    setActionModalOpen(true);
  };

  // ===== Группировка точных дублей =====
  function decorateOverlaps(raw) {
    const filtered = raw.filter((e) => (hideDone ? e.status !== "done" : true));
    const groups = new Map();
    for (const ev of filtered) {
      const key = `${ev.start_time}__${ev.end_time}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    const enhanced = [];
    for (const list of groups.values()) {
      list.sort((a, b) => Number(a.id) - Number(b.id));
      const count = list.length;
      list.forEach((ev, idx) => {
        enhanced.push({ ...ev, __dupIndex: idx, __dupCount: count });
      });
    }
    return enhanced;
  }

  const enhanced = decorateOverlaps(events);

  const calendarEvents = enhanced.map((e) => ({
    id: e.id,
    title: e.title + (e.status === "done" ? " ✅" : ""),
    start: e.start_time,
    end: e.end_time,
    backgroundColor: e.color,
    extendedProps: {
      status: e.status,
      description: e.description,
      dupIndex: e.__dupIndex,
      dupCount: e.__dupCount,
    },
  }));

  const renderEventContent = (arg) => {
    const { event } = arg;
    const { dupCount, status } = event.extendedProps || {};
    return (
      <div className={`evt-wrap ${status === "done" ? "evt-done" : ""}`}>
        <div className="evt-title">
          {event.title}
          {dupCount && dupCount > 1 && <span className="evt-badge">×{dupCount}</span>}
        </div>
      </div>
    );
  };

  // ===== AUTH SCREEN =====
  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="brand">
          <span className="dot" /> Planner
        </div>

        <div className="panel">
          <h2>Вход / Регистрация</h2>
          {error && <div className="alert">{error}</div>}
          <input
            className="input"
            type="text"
            placeholder="Username"
            value={auth.username}
            onChange={(e) => setAuth({ ...auth, username: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={auth.password}
            onChange={(e) => setAuth({ ...auth, password: e.target.value })}
          />
          <div className="row-buttons">
            <button className="btn primary" onClick={handleLogin}>Войти</button>
            <button className="btn ghost" onClick={handleRegister}>Регистрация</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== APP =====
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> Календарь
        </div>

        <div className="actions">
          <button className="btn" onClick={() => setProfileOpen(true)}>Профиль</button>
          <button className="btn" onClick={() => setShowForm(true)}>Новое событие</button>
          <button
            className="btn ghost"
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setEvents([]);
            }}
          >
            Выйти
          </button>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      {/* Профиль */}
      <ProfilePanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        token={token}
        apiUrl={API_URL}
        theme={theme}
        setTheme={(t) => {
          setTheme(t);
          document.documentElement.setAttribute("data-theme", t);
          localStorage.setItem("theme", t);
        }}
        hideDone={hideDone}
        setHideDone={setHideDone}
      />

      {/* Голосовая заметка */}
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Голосовая заметка</h3>
        <VoiceRecorder
          whisperUrl={WHISPER_URL}
          token={token}
          onTranscript={(text) => {
            if (!text) return;
            setForm((f) => ({
              ...f,
              title: text.length > 60 ? text.slice(0, 60) + "…" : text,
              description: text,
            }));
            setShowForm(true);
          }}
        />
      </div>

      {/* Календарь */}
      <div className="card">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView={calendarView}
          height="68vh"
          events={calendarEvents}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
          headerToolbar={{
            left: "title",
            center: "today prev,next",
            right: "timeGridDay,timeGridWeek,dayGridMonth,listYear",
          }}
          datesSet={(info) => {
            if (info.view.type !== calendarView) {
              setCalendarView(info.view.type);
              localStorage.setItem("calendarView", info.view.type);
            }
          }}
          eventDidMount={(info) => {
            info.el.classList.add("evt-base");
            const { dupCount, dupIndex, status } = info.event.extendedProps || {};
            if (dupCount > 1) {
              info.el.classList.add("evt-dup");
              const jitter = (dupIndex % 3) - 1;
              info.el.style.transform = `translateY(${jitter * 1.5}px)`;
            }
            if (status === "done") {
              const t = info.el.querySelector(".fc-event-title");
              if (t) t.style.textDecoration = "line-through";
              info.el.style.opacity = "0.9";
            }
          }}
        />
      </div>

      {/* MODAL: create/edit */}
      {showForm && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm();
          }}
        >
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
            <div className="modal-header">
              <h3 id="dialogTitle">{editingEvent ? "Редактировать событие" : "Новое событие"}</h3>
              <button className="icon-btn" aria-label="Закрыть" onClick={resetForm}>×</button>
            </div>

            <div className="modal-body">
              <label className="field">
                <span className="label">Заголовок</span>
                <input
                  className="input"
                  type="text"
                  placeholder="Например: Встреча с командой"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>

              <label className="field">
                <span className="label">Описание</span>
                <textarea
                  className="input textarea"
                  rows={3}
                  placeholder="Коротко о задаче..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>

              <div className="row">
                <div className="field">
                  <span className="label">Цвет</span>
                  <div className="color-row">
                    {["#3788d8", "#2ecc71", "#f1c40f", "#e67e22", "#e74c3c", "#9b59b6", "#95a5a6"].map(
                      (c) => (
                        <button
                          key={c}
                          type="button"
                          className={`color-dot ${form.color === c ? "active" : ""}`}
                          style={{ backgroundColor: c }}
                          onClick={() => setForm({ ...form, color: c })}
                          aria-label={`Выбрать цвет ${c}`}
                        />
                      )
                    )}
                    <label className="color-picker">
                      <input
                        type="color"
                        value={form.color}
                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                      />
                      <span className="chip">{form.color}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="row">
                <label className="field">
                  <span className="label">Начало</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  />
                </label>

                <label className="field">
                  <span className="label">Окончание</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  />
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn primary"
                onClick={editingEvent ? handleUpdateEvent : handleAddEvent}
              >
                {editingEvent ? "Сохранить" : "Добавить"}
              </button>
              <button className="btn ghost" onClick={resetForm}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: actions */}
      {actionModalOpen && selectedEvent && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActionModalOpen(false);
          }}
        >
          <div className="modal-card small">
            <div className="modal-header">
              <h3>Событие: {selectedEvent.title}</h3>
              <button className="icon-btn" aria-label="Закрыть" onClick={() => setActionModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {selectedEvent.description && <p className="muted">{selectedEvent.description}</p>}
              <div className="row-buttons">
                <button
                  className="btn"
                  onClick={() => {
                    setEditingEvent(selectedEvent);
                    setForm({
                      title: selectedEvent.title,
                      description: selectedEvent.description || "",
                      color: selectedEvent.color || "#3788d8",
                      start_time: selectedEvent.start_time,
                      end_time: selectedEvent.end_time,
                    });
                    setActionModalOpen(false);
                    setShowForm(true);
                  }}
                >
                  ✏ Редактировать
                </button>
                <button className="btn" onClick={() => handleMarkDone(selectedEvent.id)}>✅ Выполнено</button>
                <button className="btn danger" onClick={() => handleDeleteEvent(selectedEvent.id)}>🗑 Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
