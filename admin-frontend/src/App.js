import React, { useState, useEffect, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line, Pie } from "react-chartjs-2";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import "./App.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const API_URL = "/admin-api";

function App() {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");
  const [auth, setAuth] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState(null);
  const [extendedStats, setExtendedStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState({ users: 1, events: 1, logs: 1 });
  const [editingUser, setEditingUser] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({});
  const [telegramLinks, setTelegramLinks] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);
  const [userHistory, setUserHistory] = useState([]);
  const [eventHistory, setEventHistory] = useState([]);
  const [viewingUser, setViewingUser] = useState(null);
  const [viewingEvent, setViewingEvent] = useState(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showBulkActions, setShowBulkActions] = useState(false);

  // Авторизация
  const handleLogin = async () => {
    try {
      const body = new URLSearchParams();
      body.append("username", auth.username);
      body.append("password", auth.password);
      const res = await fetch(`${API_URL.replace("/admin-api", "/api")}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) throw new Error("Неверные учетные данные");
      const data = await res.json();
      localStorage.setItem("admin_token", data.access_token);
      setToken(data.access_token);
      setError("");
    } catch (e) {
      setError(e.message || "Ошибка входа");
    }
  };

  // Загрузка статистики
  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки статистики");
      const data = await res.json();
      setStats(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка расширенной статистики
  const loadExtendedStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/stats/extended?days=30`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки расширенной статистики");
      const data = await res.json();
      setExtendedStats(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка пользователей
  const loadUsers = async (page = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/users?skip=${(page - 1) * 20}&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки пользователей");
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Поиск пользователей
  const searchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/users/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: searchQuery,
          filters: filters,
          skip: 0,
          limit: 100,
        }),
      });
      if (!res.ok) throw new Error("Ошибка поиска");
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка событий
  const loadEvents = async (page = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/events?skip=${(page - 1) * 20}&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки событий");
      const data = await res.json();
      setEvents(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Поиск событий
  const searchEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/events/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: searchQuery,
          filters: filters,
          skip: 0,
          limit: 100,
        }),
      });
      if (!res.ok) throw new Error("Ошибка поиска");
      const data = await res.json();
      setEvents(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Массовые операции
  const handleBulkOperation = async (action, data = {}) => {
    const ids = activeTab === "users" ? selectedUsers : selectedEvents;
    if (ids.length === 0) {
      setError("Выберите элементы для операции");
      return;
    }

    try {
      const endpoint = activeTab === "users" ? "/users/bulk" : "/events/bulk";
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids, action, data }),
      });
      if (!res.ok) throw new Error("Ошибка операции");
      const result = await res.json();
      setError("");
      alert(result.msg || "Операция выполнена");
      if (activeTab === "users") loadUsers();
      else loadEvents();
      setSelectedUsers([]);
      setSelectedEvents([]);
      setShowBulkActions(false);
    } catch (e) {
      setError(e.message);
    }
  };

  // Экспорт данных
  const exportData = async (type, format = "csv") => {
    try {
      const endpoint = type === "users" ? "/export/users" : "/export/events";
      const res = await fetch(`${API_URL}${endpoint}?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка экспорта");
      
      if (format === "csv") {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${type}_${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
      } else {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${type}_${new Date().toISOString().split("T")[0]}.json`;
        a.click();
      }
    } catch (e) {
      setError(e.message);
    }
  };

  // Создание пользователя
  const handleCreateUser = async (userData) => {
    try {
      const res = await fetch(`${API_URL}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(userData),
      });
      if (!res.ok) throw new Error("Ошибка создания");
      await loadUsers();
      setShowCreateUser(false);
    } catch (e) {
      setError(e.message);
    }
  };

  // Сброс пароля
  const handleResetPassword = async (userId, newPassword) => {
    try {
      const res = await fetch(`${API_URL}/users/${userId}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ new_password: newPassword }),
      });
      if (!res.ok) throw new Error("Ошибка сброса пароля");
      alert("Пароль успешно сброшен");
    } catch (e) {
      setError(e.message);
    }
  };

  // Загрузка Telegram привязок
  const loadTelegramLinks = async () => {
    try {
      const res = await fetch(`${API_URL}/telegram/links`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки");
      const data = await res.json();
      setTelegramLinks(data);
    } catch (e) {
      setError(e.message);
    }
  };

  // Отвязка Telegram
  const handleUnlinkTelegram = async (userId) => {
    if (!window.confirm("Отвязать Telegram?")) return;
    try {
      const res = await fetch(`${API_URL}/telegram/links/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка отвязки");
      await loadTelegramLinks();
    } catch (e) {
      setError(e.message);
    }
  };

  // Загрузка логов
  const loadAdminLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/logs?skip=${(currentPage.logs - 1) * 20}&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки логов");
      const data = await res.json();
      setAdminLogs(data);
    } catch (e) {
      setError(e.message);
    }
  };

  // Загрузка истории пользователя
  const loadUserHistory = async (userId) => {
    try {
      const res = await fetch(`${API_URL}/users/${userId}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки истории");
      const data = await res.json();
      setUserHistory(data);
    } catch (e) {
      setError(e.message);
    }
  };

  // Загрузка истории события
  const loadEventHistory = async (eventId) => {
    try {
      const res = await fetch(`${API_URL}/events/${eventId}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки истории");
      const data = await res.json();
      setEventHistory(data);
    } catch (e) {
      setError(e.message);
    }
  };

  // Обновление пользователя
  const handleUpdateUser = async (userId, data) => {
    try {
      const res = await fetch(`${API_URL}/users/${userId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Ошибка обновления");
      await loadUsers(currentPage.users);
      setEditingUser(null);
    } catch (e) {
      setError(e.message);
    }
  };

  // Удаление пользователя
  const handleDeleteUser = async (userId) => {
    if (!window.confirm("Удалить пользователя и все его события?")) return;
    try {
      const res = await fetch(`${API_URL}/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка удаления");
      await loadUsers(currentPage.users);
    } catch (e) {
      setError(e.message);
    }
  };

  // Обновление события
  const handleUpdateEvent = async (eventId, data) => {
    try {
      const res = await fetch(`${API_URL}/events/${eventId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Ошибка обновления");
      await loadEvents(currentPage.events);
      setEditingEvent(null);
    } catch (e) {
      setError(e.message);
    }
  };

  // Удаление события
  const handleDeleteEvent = async (eventId) => {
    if (!window.confirm("Удалить событие?")) return;
    try {
      const res = await fetch(`${API_URL}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка удаления");
      await loadEvents(currentPage.events);
    } catch (e) {
      setError(e.message);
    }
  };

  // Загрузка событий пользователя
  const loadUserEvents = async (userId) => {
    try {
      const res = await fetch(`${API_URL}/users/${userId}/events`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Ошибка загрузки");
      const data = await res.json();
      return data;
    } catch (e) {
      setError(e.message);
      return [];
    }
  };

  // Подготовка данных для графиков
  const chartData = useMemo(() => {
    if (!extendedStats) return null;

    const eventsByDayData = {
      labels: Object.keys(extendedStats.events_by_day).sort(),
      datasets: [
        {
          label: "События по дням",
          data: Object.keys(extendedStats.events_by_day)
            .sort()
            .map((day) => extendedStats.events_by_day[day]),
          backgroundColor: "rgba(102, 126, 234, 0.6)",
          borderColor: "rgba(102, 126, 234, 1)",
        },
      ],
    };

    const eventsByStatusData = {
      labels: Object.keys(extendedStats.events_by_status),
      datasets: [
        {
          data: Object.values(extendedStats.events_by_status),
          backgroundColor: [
            "rgba(255, 193, 7, 0.6)",
            "rgba(40, 167, 69, 0.6)",
          ],
        },
      ],
    };

    const topUsersData = {
      labels: extendedStats.top_users.map((u) => u.username),
      datasets: [
        {
          label: "Количество событий",
          data: extendedStats.top_users.map((u) => u.event_count),
          backgroundColor: "rgba(102, 126, 234, 0.6)",
        },
      ],
    };

    return { eventsByDayData, eventsByStatusData, topUsersData };
  }, [extendedStats]);

  // Загрузка данных при смене вкладки
  useEffect(() => {
    if (!token) return;
    if (activeTab === "dashboard" || activeTab === "stats") {
      loadStats();
      loadExtendedStats();
    } else if (activeTab === "users") {
      loadUsers(currentPage.users);
    } else if (activeTab === "events") {
      loadEvents(currentPage.events);
    } else if (activeTab === "telegram") {
      loadTelegramLinks();
    } else if (activeTab === "logs") {
      loadAdminLogs();
    }
  }, [activeTab, token, currentPage.users, currentPage.events, currentPage.logs]);

  // Экран авторизации
  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-panel">
          <h1>🔐 Admin Panel</h1>
          {error && <div className="alert error">{error}</div>}
          <input
            type="text"
            placeholder="Username"
            value={auth.username}
            onChange={(e) => setAuth({ ...auth, username: e.target.value })}
            className="input"
          />
          <input
            type="password"
            placeholder="Password"
            value={auth.password}
            onChange={(e) => setAuth({ ...auth, password: e.target.value })}
            className="input"
            onKeyPress={(e) => e.key === "Enter" && handleLogin()}
          />
          <button onClick={handleLogin} className="btn primary">
            Войти
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <header className="admin-header">
        <h1>Admin Panel</h1>
        <button
          onClick={() => {
            localStorage.removeItem("admin_token");
            setToken("");
          }}
          className="btn ghost"
        >
          Выйти
        </button>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="tabs">
        <button
          className={`tab ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          📊 Дашборд
        </button>
        <button
          className={`tab ${activeTab === "users" ? "active" : ""}`}
          onClick={() => setActiveTab("users")}
        >
          👥 Пользователи
        </button>
        <button
          className={`tab ${activeTab === "events" ? "active" : ""}`}
          onClick={() => setActiveTab("events")}
        >
          📅 События
        </button>
        <button
          className={`tab ${activeTab === "telegram" ? "active" : ""}`}
          onClick={() => setActiveTab("telegram")}
        >
          💬 Telegram
        </button>
        <button
          className={`tab ${activeTab === "logs" ? "active" : ""}`}
          onClick={() => setActiveTab("logs")}
        >
          📋 Логи
        </button>
        <button
          className={`tab ${activeTab === "system" ? "active" : ""}`}
          onClick={() => setActiveTab("system")}
        >
          ⚙️ Система
        </button>
      </div>

      <div className="content">
        {loading && <div className="loading">Загрузка...</div>}

        {/* Дашборд */}
        {activeTab === "dashboard" && (
          <div className="dashboard">
            {stats && (
              <div className="stats-grid">
                <div className="stat-card">
                  <h3>Всего пользователей</h3>
                  <p className="stat-value">{stats.total_users}</p>
                </div>
                <div className="stat-card">
                  <h3>Активных пользователей</h3>
                  <p className="stat-value">{stats.active_users}</p>
                </div>
                <div className="stat-card">
                  <h3>Всего событий</h3>
                  <p className="stat-value">{stats.total_events}</p>
                </div>
                <div className="stat-card">
                  <h3>Событий в работе</h3>
                  <p className="stat-value">{stats.pending_events}</p>
                </div>
                <div className="stat-card">
                  <h3>Выполнено событий</h3>
                  <p className="stat-value">{stats.done_events}</p>
                </div>
                <div className="stat-card">
                  <h3>Telegram привязано</h3>
                  <p className="stat-value">{stats.telegram_linked_users}</p>
                </div>
              </div>
            )}

            {extendedStats && chartData && (
              <div className="charts-grid">
                <div className="chart-card">
                  <h3>События по дням</h3>
                  <Line data={chartData.eventsByDayData} />
                </div>
                <div className="chart-card">
                  <h3>События по статусам</h3>
                  <Pie data={chartData.eventsByStatusData} />
                </div>
                <div className="chart-card">
                  <h3>Топ пользователей</h3>
                  <Bar data={chartData.topUsersData} />
                </div>
              </div>
            )}

            {extendedStats && (
              <div className="recent-activity">
                <h3>Последняя активность</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Администратор</th>
                      <th>Действие</th>
                      <th>Тип</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extendedStats.recent_activity.map((activity) => (
                      <tr key={activity.id}>
                        <td>{activity.admin}</td>
                        <td>{activity.action}</td>
                        <td>{activity.entity_type}</td>
                        <td>{new Date(activity.created_at).toLocaleString("ru")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {events.length > 0 && (
              <div className="calendar-widget">
                <h3>Календарь событий</h3>
                <FullCalendar
                  plugins={[dayGridPlugin, timeGridPlugin]}
                  initialView="dayGridMonth"
                  events={events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    start: e.start_time,
                    end: e.end_time,
                    backgroundColor: e.color,
                  }))}
                  height="400px"
                />
              </div>
            )}
          </div>
        )}

        {/* Пользователи */}
        {activeTab === "users" && (
          <div className="table-section">
            <div className="toolbar">
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input"
                style={{ flex: 1 }}
              />
              <button onClick={searchUsers} className="btn">
                🔍 Поиск
              </button>
              <button onClick={() => loadUsers()} className="btn">
                🔄 Обновить
              </button>
              <button onClick={() => setShowCreateUser(true)} className="btn primary">
                ➕ Создать
              </button>
              <button onClick={() => exportData("users", "csv")} className="btn">
                📥 CSV
              </button>
              <button onClick={() => exportData("users", "json")} className="btn">
                📥 JSON
              </button>
              {selectedUsers.length > 0 && (
                <button
                  onClick={() => setShowBulkActions(true)}
                  className="btn danger"
                >
                  Массовые операции ({selectedUsers.length})
                </button>
              )}
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedUsers(users.map((u) => u.id));
                          } else {
                            setSelectedUsers([]);
                          }
                        }}
                      />
                    </th>
                    <th>ID</th>
                    <th>Username</th>
                    <th>Theme</th>
                    <th>Timezone</th>
                    <th>Telegram</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(user.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUsers([...selectedUsers, user.id]);
                            } else {
                              setSelectedUsers(selectedUsers.filter((id) => id !== user.id));
                            }
                          }}
                        />
                      </td>
                      <td>{user.id}</td>
                      <td>{user.username}</td>
                      <td>{user.theme}</td>
                      <td>{user.timezone}</td>
                      <td>{user.telegram_username || user.telegram_chat_id || "-"}</td>
                      <td>
                        <button
                          onClick={() => {
                            setViewingUser(user);
                            loadUserHistory(user.id);
                          }}
                          className="btn small"
                        >
                          👁️
                        </button>
                        <button
                          onClick={() => setEditingUser(user)}
                          className="btn small"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="btn small danger"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* События */}
        {activeTab === "events" && (
          <div className="table-section">
            <div className="toolbar">
              <input
                type="text"
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input"
                style={{ flex: 1 }}
              />
              <select
                className="input"
                value={filters.status || ""}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value || undefined })
                }
              >
                <option value="">Все статусы</option>
                <option value="pending">Pending</option>
                <option value="done">Done</option>
              </select>
              <button onClick={searchEvents} className="btn">
                🔍 Поиск
              </button>
              <button onClick={() => loadEvents()} className="btn">
                🔄 Обновить
              </button>
              <button onClick={() => exportData("events", "csv")} className="btn">
                📥 CSV
              </button>
              <button onClick={() => exportData("events", "json")} className="btn">
                📥 JSON
              </button>
              {selectedEvents.length > 0 && (
                <button
                  onClick={() => setShowBulkActions(true)}
                  className="btn danger"
                >
                  Массовые операции ({selectedEvents.length})
                </button>
              )}
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedEvents(events.map((e) => e.id));
                          } else {
                            setSelectedEvents([]);
                          }
                        }}
                      />
                    </th>
                    <th>ID</th>
                    <th>Название</th>
                    <th>Владелец</th>
                    <th>Начало</th>
                    <th>Окончание</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(event.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEvents([...selectedEvents, event.id]);
                            } else {
                              setSelectedEvents(
                                selectedEvents.filter((id) => id !== event.id)
                              );
                            }
                          }}
                        />
                      </td>
                      <td>{event.id}</td>
                      <td>{event.title}</td>
                      <td>{event.owner_id}</td>
                      <td>{new Date(event.start_time).toLocaleString("ru")}</td>
                      <td>{new Date(event.end_time).toLocaleString("ru")}</td>
                      <td>
                        <span className={`status ${event.status}`}>
                          {event.status}
                        </span>
                      </td>
                      <td>
                        <button
                          onClick={() => {
                            setViewingEvent(event);
                            loadEventHistory(event.id);
                          }}
                          className="btn small"
                        >
                          👁️
                        </button>
                        <button
                          onClick={() => setEditingEvent(event)}
                          className="btn small"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDeleteEvent(event.id)}
                          className="btn small danger"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Telegram */}
        {activeTab === "telegram" && (
          <div className="table-section">
            <div className="toolbar">
              <button onClick={loadTelegramLinks} className="btn">
                🔄 Обновить
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>Username</th>
                  <th>Telegram Chat ID</th>
                  <th>Telegram Username</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {telegramLinks.map((link) => (
                  <tr key={link.user_id}>
                    <td>{link.user_id}</td>
                    <td>{link.username}</td>
                    <td>{link.telegram_chat_id}</td>
                    <td>{link.telegram_username || "-"}</td>
                    <td>
                      <button
                        onClick={() => handleUnlinkTelegram(link.user_id)}
                        className="btn small danger"
                      >
                        Отвязать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Логи */}
        {activeTab === "logs" && (
          <div className="table-section">
            <div className="toolbar">
              <button onClick={loadAdminLogs} className="btn">
                🔄 Обновить
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Администратор</th>
                  <th>Действие</th>
                  <th>Тип</th>
                  <th>ID сущности</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {adminLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.id}</td>
                    <td>{log.admin_username}</td>
                    <td>{log.action}</td>
                    <td>{log.entity_type}</td>
                    <td>{log.entity_id || "-"}</td>
                    <td>{new Date(log.created_at).toLocaleString("ru")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Система */}
        {activeTab === "system" && (
          <div className="system-section">
            <h2>Управление системой</h2>
            <div className="system-actions">
              <button
                onClick={async () => {
                  if (!window.confirm("Очистить старые данные (старше 30 дней)?")) return;
                  try {
                    const res = await fetch(`${API_URL}/system/cleanup?days=30`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!res.ok) throw new Error("Ошибка очистки");
                    const data = await res.json();
                    alert(`Очищено: ${JSON.stringify(data)}`);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
                className="btn danger"
              >
                Очистить старые данные
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Модальные окна */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Редактировать пользователя</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                handleUpdateUser(editingUser.id, {
                  username: formData.get("username"),
                  theme: formData.get("theme"),
                  timezone: formData.get("timezone"),
                });
              }}
            >
              <input
                type="text"
                name="username"
                defaultValue={editingUser.username}
                className="input"
                placeholder="Username"
              />
              <select name="theme" defaultValue={editingUser.theme} className="input">
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
              <input
                type="text"
                name="timezone"
                defaultValue={editingUser.timezone}
                className="input"
                placeholder="Timezone"
              />
              <div className="modal-actions">
                <button type="submit" className="btn primary">
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="btn ghost"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateUser && (
        <div className="modal-overlay" onClick={() => setShowCreateUser(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Создать пользователя</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                handleCreateUser({
                  username: formData.get("username"),
                  password: formData.get("password"),
                  theme: formData.get("theme") || "dark",
                  timezone: formData.get("timezone") || "Europe/Amsterdam",
                });
              }}
            >
              <input
                type="text"
                name="username"
                required
                className="input"
                placeholder="Username"
              />
              <input
                type="password"
                name="password"
                required
                className="input"
                placeholder="Password"
              />
              <select name="theme" className="input">
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
              <input
                type="text"
                name="timezone"
                className="input"
                placeholder="Timezone"
                defaultValue="Europe/Amsterdam"
              />
              <div className="modal-actions">
                <button type="submit" className="btn primary">
                  Создать
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateUser(false)}
                  className="btn ghost"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBulkActions && (
        <div className="modal-overlay" onClick={() => setShowBulkActions(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Массовые операции</h2>
            <div className="bulk-actions">
              {activeTab === "events" && (
                <>
                  <button
                    onClick={() =>
                      handleBulkOperation("update_status", { status: "done" })
                    }
                    className="btn"
                  >
                    Отметить выполненными
                  </button>
                  <button
                    onClick={() =>
                      handleBulkOperation("update_status", { status: "pending" })
                    }
                    className="btn"
                  >
                    Вернуть в работу
                  </button>
                </>
              )}
              <button
                onClick={() => handleBulkOperation("delete")}
                className="btn danger"
              >
                Удалить выбранные
              </button>
            </div>
            <button
              onClick={() => setShowBulkActions(false)}
              className="btn ghost"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {viewingUser && (
        <div className="modal-overlay" onClick={() => setViewingUser(null)}>
          <div className="modal large" onClick={(e) => e.stopPropagation()}>
            <h2>Пользователь: {viewingUser.username}</h2>
            <div className="tabs-inner">
              <button onClick={() => loadUserHistory(viewingUser.id)} className="btn">
                История
              </button>
            </div>
            {userHistory.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Поле</th>
                    <th>Старое значение</th>
                    <th>Новое значение</th>
                    <th>Изменено</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {userHistory.map((h) => (
                    <tr key={h.id}>
                      <td>{h.field_name}</td>
                      <td>{h.old_value}</td>
                      <td>{h.new_value}</td>
                      <td>{h.changed_by}</td>
                      <td>{new Date(h.created_at).toLocaleString("ru")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button
              onClick={() => setViewingUser(null)}
              className="btn ghost"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {viewingEvent && (
        <div className="modal-overlay" onClick={() => setViewingEvent(null)}>
          <div className="modal large" onClick={(e) => e.stopPropagation()}>
            <h2>Событие: {viewingEvent.title}</h2>
            <button onClick={() => loadEventHistory(viewingEvent.id)} className="btn">
              Загрузить историю
            </button>
            {eventHistory.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Поле</th>
                    <th>Старое значение</th>
                    <th>Новое значение</th>
                    <th>Изменено</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {eventHistory.map((h) => (
                    <tr key={h.id}>
                      <td>{h.field_name}</td>
                      <td>{h.old_value}</td>
                      <td>{h.new_value}</td>
                      <td>{h.changed_by}</td>
                      <td>{new Date(h.created_at).toLocaleString("ru")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button
              onClick={() => setViewingEvent(null)}
              className="btn ghost"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
