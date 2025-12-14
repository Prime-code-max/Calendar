import React, { useState, useEffect, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";

import AgentChat from "./components/AgentChat";
import ProfilePanel from "./components/ProfilePanel";
<<<<<<< HEAD
import { 
  isTelegramWebApp, 
  isInTelegramContext,
  initTelegramWebApp, 
  applyTelegramTheme, 
  loginWithTelegram 
} from "./utils/telegram";
=======
>>>>>>> c01622961fe5d5c6e75acd11a66950f1da623435
import "./App.css";

function App() {
  // Базовые URL идут через Nginx-гейтвей
  const API_URL = "/api";
  const WHISPER_URL = "/whisper";
  const AGENT_URL = "/api/agent";

  // ===== MOBILE DETECTION =====
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

<<<<<<< HEAD
  // ===== TELEGRAM WEBAPP =====
  const [isTelegram, setIsTelegram] = useState(false);
  
  useEffect(() => {
    // Only set isTelegram if we're actually in a valid Telegram context with initData
    if (isInTelegramContext()) {
      const tg = initTelegramWebApp();
      if (tg) {
        setIsTelegram(true);
        applyTelegramTheme();
      }
    }
  }, []);

=======
>>>>>>> c01622961fe5d5c6e75acd11a66950f1da623435
  // ===== THEME =====
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // ===== VIEW =====
  // На мобильных — стартуем с listWeek, на десктопе — сохраняем предыдущее (или month)
  const defaultView = isMobile
    ? "listWeek"
    : localStorage.getItem("calendarView") || "dayGridMonth";
  const [calendarView, setCalendarView] = useState(defaultView);

  useEffect(() => {
    // если пользователь меняет размер, мягко переключаем на мобильный дефолт
    if (isMobile && !calendarView.startsWith("list")) {
      setCalendarView("listWeek");
    }
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== AUTH / DATA =====
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [events, setEvents] = useState([]);
  const [hideDone, setHideDone] = useState(false);
  const [error, setError] = useState("");

  // Profile panel
  const [profileOpen, setProfileOpen] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState(() => {
    // Try to restore from localStorage, default to 'calendar'
    return localStorage.getItem("activeTab") || "calendar";
  });

  // form + modals
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // ===== MODAL SCROLL LOCK =====
  useEffect(() => {
    const isModalOpen = showForm || actionModalOpen || profileOpen;
    if (isModalOpen) {
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = '0px'; // Prevent layout shift
    } else {
      // Restore body scroll when modal is closed
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }
    
    // Cleanup on unmount
    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [showForm, actionModalOpen, profileOpen]);

<<<<<<< HEAD
  // Telegram auto-login - only attempt if we're actually in Telegram with valid initData
  useEffect(() => {
    // Only attempt Telegram login if:
    // 1. We're in Telegram context (with initData)
    // 2. We don't have a token yet
    // 3. We haven't already attempted login
    if (isTelegram && !token && !telegramLoginAttempted) {
      // Double-check we have valid initData before attempting
      if (!isInTelegramContext()) {
        console.log("[DEBUG] Telegram WebApp detected but no initData - skipping auto-login");
        return;
      }
      
      setTelegramLoginAttempted(true);
      (async () => {
        try {
          console.log("[DEBUG] Attempting Telegram auto-login...");
          const result = await loginWithTelegram(API_URL);
          localStorage.setItem("token", result.access_token);
          setToken(result.access_token);
          setError("");
          console.log("[DEBUG] Telegram login successful");
        } catch (e) {
          console.error("Telegram login failed:", e);
          // Only show error if we're actually in Telegram context
          // If initData is missing, it means we're not in a real Telegram context,
          // so don't show an error to regular web users
          if (isInTelegramContext()) {
            setError(`Telegram login failed: ${e.message}. Please use regular login below.`);
          } else {
            // Silently fail - user can use regular login
            console.log("[DEBUG] Not in Telegram context - Telegram login skipped");
            setTelegramLoginAttempted(false); // Allow fallback to regular login
          }
        }
      })();
    }
  }, [isTelegram, token, telegramLoginAttempted, API_URL]);

=======
>>>>>>> c01622961fe5d5c6e75acd11a66950f1da623435
  const [form, setForm] = useState({
    title: "",
    description: "",
    color: "#3788d8",
    start_time: "",
    end_time: "",
  });

  const [auth, setAuth] = useState({ username: "", password: "" });
  const [authErrors, setAuthErrors] = useState({ username: "", password: "" });
  const [formErrors, setFormErrors] = useState({ title: "", start_time: "", end_time: "" });

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

  // ===== VALIDATION =====
  const validateAuth = () => {
    const errors = { username: "", password: "" };
    
    if (!auth.username || !auth.username.trim()) {
      errors.username = "Username is required";
    } else if (auth.username.trim().length > 150) {
      errors.username = "Username too long (max 150 characters)";
    }
    
    if (!auth.password || !auth.password.trim()) {
      errors.password = "Password is required";
    } else if (auth.password.trim().length > 72) {
      errors.password = "Password too long (max 72 characters)";
    }
    
    setAuthErrors(errors);
    return !errors.username && !errors.password;
  };

  const validateForm = () => {
    const errors = { title: "", start_time: "", end_time: "" };
    
    if (!form.title || !form.title.trim()) {
      errors.title = "Title is required";
    }
    
    setFormErrors(errors);
    return !errors.title;
  };

  // ===== AUTH =====
  const handleRegister = async () => {
    if (!validateAuth()) return;
    
    try {
      const res = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: auth.username.trim(),
          password: auth.password.trim()
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Registration failed");
      }
      alert("Регистрация успешна! Теперь войдите.");
      setAuth({ username: "", password: "" });
      setAuthErrors({ username: "", password: "" });
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
    setFormErrors({ title: "", start_time: "", end_time: "" });
    setEditingEvent(null);
    setShowForm(false);
  };

  const handleAddEvent = async () => {
    if (!validateForm()) return;
    
    try {
      // Set defaults for missing times
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      const eventData = {
        ...form,
        start_time: form.start_time || now.toISOString().slice(0, 16),
        end_time: form.end_time || tomorrow.toISOString().slice(0, 16)
      };
      
      const res = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(eventData),
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
  const enhanced = useMemo(() => {
    const filtered = events.filter((e) => (hideDone ? e.status !== "done" : true));
    const groups = new Map();
    for (const ev of filtered) {
      const key = `${ev.start_time}__${ev.end_time}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    const result = [];
    for (const list of groups.values()) {
      list.sort((a, b) => Number(a.id) - Number(b.id));
      const count = list.length;
      list.forEach((ev, idx) => {
        result.push({ ...ev, __dupIndex: idx, __dupCount: count });
      });
    }
    return result;
  }, [events, hideDone]);

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
    // на мобильных делаем лаконичнее
    const title =
      isMobile && event.title.length > 30 ? event.title.slice(0, 30) + "…" : event.title;

    return (
      <div className={`evt-wrap ${status === "done" ? "evt-done" : ""}`}>
        <div className="evt-title">
          {title}
          {!isMobile && dupCount && dupCount > 1 && (
            <span className="evt-badge">×{dupCount}</span>
          )}
        </div>
      </div>
    );
  };

  // toolbar под мобильный
  const headerToolbar = useMemo(() => {
    if (isMobile) {
      return {
        left: "prev,next today",
        center: "title",
        right: "listDay,listWeek,dayGridMonth",
      };
    }
    return {
      left: "title",
      center: "today prev,next",
      right: "timeGridDay,timeGridWeek,dayGridMonth,listWeek",
    };
  }, [isMobile]);

  // ===== AUTH SCREEN =====
  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="brand">
          <span className="dot" /> Planner
        </div>

        <div className="panel">
<<<<<<< HEAD
          {isTelegram ? (
            <>
              <h2>Telegram Mini App</h2>
              {/* Show loading state while attempting login */}
              {telegramLoginAttempted && !error && (
                <div className="alert">Авторизация через Telegram...</div>
              )}
              {/* Show error only if login was attempted and failed */}
              {error && error.includes("Telegram") && (
                <div className="alert">{error}</div>
              )}
              
              {/* Show fallback login form if Telegram login failed */}
              {error && error.includes("Telegram") && (
                <>
                  <hr style={{ margin: "20px 0", border: "1px solid var(--border, #333)" }} />
                  <h3>Альтернативный вход</h3>
                  <input
                    className={`input ${authErrors.username ? 'error' : ''}`}
                    type="text"
                    placeholder="Username"
                    value={auth.username}
                    onChange={(e) => {
                      setAuth({ ...auth, username: e.target.value });
                      if (authErrors.username) {
                        setAuthErrors({ ...authErrors, username: "" });
                      }
                    }}
                  />
                  {authErrors.username && <div className="field-error">{authErrors.username}</div>}
                  <input
                    className={`input ${authErrors.password ? 'error' : ''}`}
                    type="password"
                    placeholder="Password"
                    value={auth.password}
                    onChange={(e) => {
                      setAuth({ ...auth, password: e.target.value });
                      if (authErrors.password) {
                        setAuthErrors({ ...authErrors, password: "" });
                      }
                    }}
                  />
                  {authErrors.password && <div className="field-error">{authErrors.password}</div>}
                  <div className="row-buttons">
                    <button className="btn primary" onClick={handleLogin}>Войти</button>
                    <button className="btn ghost" onClick={handleRegister}>Регистрация</button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h2>Вход / Регистрация</h2>
              {error && <div className="alert">{error}</div>}
              <input
                className={`input ${authErrors.username ? 'error' : ''}`}
                type="text"
                placeholder="Username"
                value={auth.username}
                onChange={(e) => {
                  setAuth({ ...auth, username: e.target.value });
                  if (authErrors.username) {
                    setAuthErrors({ ...authErrors, username: "" });
                  }
                }}
              />
              {authErrors.username && <div className="field-error">{authErrors.username}</div>}
              <input
                className={`input ${authErrors.password ? 'error' : ''}`}
                type="password"
                placeholder="Password"
                value={auth.password}
                onChange={(e) => {
                  setAuth({ ...auth, password: e.target.value });
                  if (authErrors.password) {
                    setAuthErrors({ ...authErrors, password: "" });
                  }
                }}
              />
              {authErrors.password && <div className="field-error">{authErrors.password}</div>}
              <div className="row-buttons">
                <button className="btn primary" onClick={handleLogin}>Войти</button>
                <button className="btn ghost" onClick={handleRegister}>Регистрация</button>
              </div>
            </>
          )}
=======
          <h2>Вход / Регистрация</h2>
          {error && <div className="alert">{error}</div>}
          <input
            className={`input ${authErrors.username ? 'error' : ''}`}
            type="text"
            placeholder="Username"
            value={auth.username}
            onChange={(e) => {
              setAuth({ ...auth, username: e.target.value });
              if (authErrors.username) {
                setAuthErrors({ ...authErrors, username: "" });
              }
            }}
          />
          {authErrors.username && <div className="field-error">{authErrors.username}</div>}
          <input
            className={`input ${authErrors.password ? 'error' : ''}`}
            type="password"
            placeholder="Password"
            value={auth.password}
            onChange={(e) => {
              setAuth({ ...auth, password: e.target.value });
              if (authErrors.password) {
                setAuthErrors({ ...authErrors, password: "" });
              }
            }}
          />
          {authErrors.password && <div className="field-error">{authErrors.password}</div>}
          <div className="row-buttons">
            <button className="btn primary" onClick={handleLogin}>Войти</button>
            <button className="btn ghost" onClick={handleRegister}>Регистрация</button>
          </div>
>>>>>>> c01622961fe5d5c6e75acd11a66950f1da623435
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

        {/* на мобильных прячем часть кнопок в «плавающую» + оставляем только профиль */}
        <div className="actions">
          <button className="btn" onClick={() => setProfileOpen(true)}>Профиль</button>
          {!isMobile && (
            <>
              {activeTab === "calendar" && (
                <button className="btn" onClick={() => setShowForm(true)}>Новое событие</button>
              )}
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
            </>
          )}
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
        isTelegram={false}
      />

<<<<<<< HEAD
      {/* Tab Bar */}
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("calendar");
            localStorage.setItem("activeTab", "calendar");
          }}
          aria-label="Calendar tab"
        >
          Календарь
        </button>
        <button
          className={`tab-btn ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("chat");
            localStorage.setItem("activeTab", "chat");
          }}
          aria-label="AI Assistant tab"
        >
          AI Ассистент
        </button>
=======
      {/* AI Assistant Chat */}
      <div className="card">
        <h3 style={{ margin: "0 0 16px 0", fontSize: "18px" }}>AI Ассистент</h3>
        <AgentChat
          whisperUrl={WHISPER_URL}
          agentUrl={AGENT_URL}
          token={token}
        />
>>>>>>> c01622961fe5d5c6e75acd11a66950f1da623435
      </div>

      {/* Tab Content */}
      {activeTab === "calendar" && (
        <div className="card calendar-tab-content" style={isMobile ? { padding: 0 } : undefined}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView={calendarView}
          // Мобильная высота — авто; десктоп — ранее было фикс. Зададим авто везде, пусть растёт с контентом.
          height="auto"
          contentHeight="auto"
          expandRows={true}
          stickyHeaderDates={!isMobile}
          events={calendarEvents}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
          headerToolbar={headerToolbar}
          datesSet={(info) => {
            if (info.view.type !== calendarView) {
              setCalendarView(info.view.type);
              // сохраняем предпочтение только для десктопа
              if (!isMobile) {
                localStorage.setItem("calendarView", info.view.type);
              }
            }
          }}
          eventDidMount={(info) => {
            info.el.classList.add("evt-base");
            const { dupCount, dupIndex, status } = info.event.extendedProps || {};
            
            // Explicitly set background color to ensure it applies to short events
            // FullCalendar sometimes doesn't apply backgroundColor for short duration events
            if (info.event.backgroundColor) {
              info.el.style.backgroundColor = info.event.backgroundColor;
              // Also set border color for better visibility
              info.el.style.borderColor = info.event.backgroundColor;
            }
            
            if (dupCount > 1 && !isMobile) {
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
      )}

      {activeTab === "chat" && (
        <div className={`card agent-chat-container ${isMobile ? 'mobile' : ''}`}>
          <h3>AI Ассистент</h3>
          <AgentChat
            whisperUrl={WHISPER_URL}
            agentUrl={`${API_URL}/agent`}
            token={token}
          />
        </div>
      )}

      {/* Floating Action Button (только на мобильных и только на вкладке календаря) */}
      {isMobile && activeTab === "calendar" && (
        <button
          className="floating-action-button"
          aria-label="Новое событие"
          onClick={() => setShowForm(true)}
        >
          +
        </button>
      )}

      {/* MODAL: create/edit */}
      {showForm && (
        <div
          className="modal-overlay"
        >
          <div
            className="modal-card event-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialogTitle"
            style={isMobile ? { width: "92%", margin: "8vh auto" } : undefined}
          >
            <div className="modal-header">
              <h3 id="dialogTitle">{editingEvent ? "Редактировать событие" : "Новое событие"}</h3>
              <button className="icon-btn" aria-label="Закрыть" onClick={resetForm}>×</button>
            </div>

            <div className="modal-body">
              <label className="field">
                <span className="label">Заголовок</span>
                <input
                  className={`input ${formErrors.title ? 'error' : ''}`}
                  type="text"
                  placeholder="Например: Встреча с командой"
                  value={form.title}
                  onChange={(e) => {
                    setForm({ ...form, title: e.target.value });
                    if (formErrors.title) {
                      setFormErrors({ ...formErrors, title: "" });
                    }
                  }}
                />
                {formErrors.title && <div className="field-error">{formErrors.title}</div>}
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

              <div className="row" style={isMobile ? { gap: 12, flexDirection: "column" } : undefined}>
                <div className="field">
                  <span className="label">Цвет</span>
                  <div className="color-row" style={isMobile ? { gap: 8, flexWrap: "wrap" } : undefined}>
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

              <div className="row" style={isMobile ? { gap: 12, flexDirection: "column" } : undefined}>
                <label className="field" style={{ flex: 1 }}>
                  <span className="label">Начало</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  />
                </label>

                <label className="field" style={{ flex: 1 }}>
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

            <div className="modal-footer" style={isMobile ? { gap: 8 } : undefined}>
              <button
                className="btn primary"
                onClick={editingEvent ? handleUpdateEvent : handleAddEvent}
                style={isMobile ? { width: "100%" } : undefined}
              >
                {editingEvent ? "Сохранить" : "Добавить"}
              </button>
              <button
                className="btn ghost"
                onClick={resetForm}
                style={isMobile ? { width: "100%" } : undefined}
              >
                Отмена
              </button>
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
          <div
            className="modal-card small"
            style={isMobile ? { width: "92%", margin: "8vh auto" } : undefined}
          >
            <div className="modal-header">
              <h3>Событие: {selectedEvent.title}</h3>
              <button className="icon-btn" aria-label="Закрыть" onClick={() => setActionModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {selectedEvent.description && <p className="muted">{selectedEvent.description}</p>}
              <div className="row-buttons" style={isMobile ? { flexDirection: "column", gap: 8 } : undefined}>
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
                  style={isMobile ? { width: "100%" } : undefined}
                >
                  ✏ Редактировать
                </button>
                <button
                  className="btn"
                  onClick={() => handleMarkDone(selectedEvent.id)}
                  style={isMobile ? { width: "100%" } : undefined}
                >
                  ✅ Выполнено
                </button>
                <button
                  className="btn danger"
                  onClick={() => handleDeleteEvent(selectedEvent.id)}
                  style={isMobile ? { width: "100%" } : undefined}
                >
                  🗑 Удалить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Кнопка «Выйти» как нижний пункт на мобильных (чтобы не терялась) */}
      {isMobile && (
        <div style={{ height: 80 }} /> // небольшой нижний отступ, чтобы FAB не перекрывал
      )}
      {isMobile && (
        <button
          onClick={() => {
            localStorage.removeItem("token");
            setToken("");
            setEvents([]);
          }}
          className="mobile-logout-button"
        >
          Выйти
        </button>
      )}
    </div>
  );
}

export default App;
