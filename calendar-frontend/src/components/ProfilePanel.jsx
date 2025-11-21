import React, { useEffect, useRef, useState } from "react";

export default function ProfilePanel({
  open,
  onClose,
  token,
  apiUrl,
  theme,
  setTheme,
  hideDone,
  setHideDone,
  setTimezoneApplied,
  isTelegram = false,
}) {
  const [loading, setLoading] = useState(true);
  const [tz, setTz] = useState("Europe/Amsterdam");
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const [pw, setPw] = useState({ old_password: "", new_password: "" });

  // 🔒 Лочим скролл бэкграунда, возвращаем как было при закрытии
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    const hasScrollbar = window.innerWidth > document.documentElement.clientWidth;
    if (hasScrollbar) {
      const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.paddingRight = `${scrollBarWidth}px`;
    }
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${apiUrl}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Не удалось получить профиль");
        const p = await res.json();
        setTheme(p.theme);
        setHideDone(!!p.hide_done);
        setTz(p.timezone || "Europe/Amsterdam");
        setErr("");
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const saveProfile = async () => {
    try {
      const res = await fetch(`${apiUrl}/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ theme, hide_done: hideDone, timezone: tz }),
      });
      if (!res.ok) throw new Error("Не удалось сохранить профиль");
      setTimezoneApplied?.(tz);
      alert("Сохранено");
      setErr("");
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const importICS = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return alert("Выберите .ics файл");
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch(`${apiUrl}/import-ics`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Импорт не удался");
      }
      const data = await res.json();
      alert(`Импортировано: ${data.created}, пропущено: ${data.skipped}`);
      fileRef.current.value = "";
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const changePassword = async () => {
    if (!pw.old_password || !pw.new_password) return alert("Введите старый и новый пароль");
    try {
      const res = await fetch(`${apiUrl}/change-password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(pw),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Не удалось сменить пароль");
      }
      alert("Пароль изменён");
      setPw({ old_password: "", new_password: "" });
      setErr("");
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-card profile"
           role="dialog" aria-modal="true" aria-labelledby="profileTitle">
        <div className="modal-header sticky">
          <h3 id="profileTitle">Личный кабинет</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <div className="modal-body scroll">
          {err && <div className="alert" style={{ marginBottom: 12 }}>{err}</div>}

          {loading ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : (
            <>
              <section className="panel">
                <h4>Предпочтения</h4>
                <div className="row">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={theme === "dark"}
                      onChange={() => setTheme(theme === "dark" ? "light" : "dark")}
                    />
                    <span>Тёмная тема</span>
                  </label>

                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={hideDone}
                      onChange={(e) => setHideDone(e.target.checked)}
                    />
                    <span>Скрывать выполненные</span>
                  </label>
                </div>

                <div className="row" style={{ marginTop: 8 }}>
                  <label className="field">
                    <span className="label">Часовой пояс</span>
                    <input
                      className="input"
                      type="text"
                      value={tz}
                      onChange={(e) => setTz(e.target.value)}
                      placeholder="Europe/Amsterdam"
                    />
                  </label>
                </div>

                <div className="row-buttons">
                  <button className="btn primary" onClick={saveProfile}>Сохранить</button>
                </div>
              </section>

              <section className="panel">
                <h4>Импорт из Google Calendar (.ics)</h4>
                <p className="muted">
                  Экспортируйте календарь в Google Calendar → Настройки → Импорт/экспорт → Экспорт (.ics),
                  затем загрузите файл сюда.
                </p>
                <input ref={fileRef} type="file" accept=".ics,text/calendar" />
                <div className="row-buttons" style={{ marginTop: 8 }}>
                  <button className="btn" onClick={importICS}>Импортировать</button>
                </div>
              </section>

              <section className="panel">
                <h4>Смена пароля</h4>
                <div className="row">
                  <input
                    className="input"
                    type="password"
                    placeholder="Старый пароль"
                    value={pw.old_password}
                    onChange={(e) => setPw({ ...pw, old_password: e.target.value })}
                  />
                  <input
                    className="input"
                    type="password"
                    placeholder="Новый пароль"
                    value={pw.new_password}
                    onChange={(e) => setPw({ ...pw, new_password: e.target.value })}
                  />
                </div>
                <div className="row-buttons" style={{ marginTop: 8 }}>
                  <button className="btn" onClick={changePassword}>Изменить пароль</button>
                </div>
              </section>

            </>
          )}
        </div>
      </div>
    </div>
  );
}
