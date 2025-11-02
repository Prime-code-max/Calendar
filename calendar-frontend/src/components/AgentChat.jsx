import React, { useEffect, useRef, useState } from "react";

export default function AgentChat({ whisperUrl = "/whisper", agentUrl = "/api/agent", token }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Voice recording state
  const [supportedMime, setSupportedMime] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const chunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  // Helper function to check if user is near the bottom of the chat
  const isNearBottom = (threshold = 150) => {
    if (!messagesContainerRef.current) return true;
    const container = messagesContainerRef.current;
    // Calculate distance from bottom
    // After a new message is added, scrollHeight increases, but scrollTop stays the same
    // So we check if user is within threshold of the PREVIOUS bottom
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom <= threshold;
  };

  // Track if this is the initial load to auto-scroll on first load
  const isInitialLoadRef = useRef(true);

  // Load chat history on mount
  useEffect(() => {
    const loadHistory = async () => {
      if (!token) return;
      
      try {
        const res = await fetch(`${agentUrl}/chat/history`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.messages && Array.isArray(data.messages)) {
            // Convert messages to format expected by component
            const formattedMessages = data.messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            }));
            setMessages(formattedMessages);
            isInitialLoadRef.current = true; // Mark as initial load
          }
        }
      } catch (e) {
        // Silently fail - user can still use chat
        console.error("Failed to load chat history:", e);
      }
    };

    loadHistory();
  }, [token, agentUrl]); // Load when token or agentUrl changes

  // Auto-scroll to bottom when messages change, but only if user is near the bottom
  useEffect(() => {
    if (messages.length === 0) return;
    
    // Always scroll to bottom on initial load (when history is loaded)
    if (isInitialLoadRef.current) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
        isInitialLoadRef.current = false;
      }, 50);
      return;
    }
    
    // For new messages, check scroll position after DOM has updated
    // Use requestAnimationFrame to ensure DOM is fully rendered before checking
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Double RAF ensures the DOM has fully updated with new messages
        // When a new message is added:
        // - scrollHeight increases by the message height
        // - scrollTop stays the same (user hasn't scrolled)
        // - So if user was at bottom before, they're now some distance from the new bottom
        // We check if they're within 150px of the bottom, which accounts for:
        //   1. They were near bottom before (within 150px)
        //   2. The new message height might push them slightly away
        // Only auto-scroll if user is already near the bottom
        // This prevents disrupting users who are reading older messages
        if (isNearBottom(150)) {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      });
    });
  }, [messages]);

  // Detect supported audio MIME type
  useEffect(() => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];
    for (const t of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) {
        setSupportedMime(t);
        return;
      }
    }
    setSupportedMime(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopAll(), []);

  // Send message to agent
  const sendMessage = async (text) => {
    if (!text.trim() || isLoading) return;

    const userMessage = { role: "user", content: text.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch(`${agentUrl}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question: text.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || `Ошибка запроса (${res.status})`);
      }

      const data = await res.json();
      const aiMessage = {
        role: "assistant",
        content: data.answer || data.error || "Нет ответа",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (e) {
      setError(String(e.message || e));
      const errorMessage = {
        role: "assistant",
        content: `Ошибка: ${e.message || e}`,
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle text input submission
  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(inputText);
  };

  // Voice recording functions
  const startRecording = async () => {
    setError("");
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mr = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : undefined);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = handleRecordingStop;

      mr.start(100);
      setIsRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      setError("Нет доступа к микрофону или браузер не поддерживает запись.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      handleRecordingStop();
    }
  };

  const stopAll = () => {
    clearInterval(timerRef.current);
    setIsRecording(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const handleRecordingStop = async () => {
    clearInterval(timerRef.current);
    setIsRecording(false);

    if (chunksRef.current.length === 0) {
      stopAll();
      return;
    }

    const mime = supportedMime || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];

    // Send to whisper-service for transcription
    const ext = mime.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `record.${ext}`, { type: mime });
    const fd = new FormData();
    fd.append("file", file);

    try {
      setIsLoading(true);
      setError("");
      
      // Ensure whisperUrl has a trailing slash for proper routing
      const whisperEndpoint = whisperUrl.endsWith('/') ? `${whisperUrl}transcribe` : `${whisperUrl}/transcribe`;
      const res = await fetch(whisperEndpoint, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Ошибка распознавания (${res.status})`);
      }

      const data = await res.json();
      const text = data?.text || "";

      if (text.trim()) {
        // Automatically send transcribed text to agent
        // The scroll will be handled by the useEffect when messages update
        await sendMessage(text);
      } else {
        setError("Не удалось распознать речь");
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      stopAll();
      setIsLoading(false);
    }
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const canRecord = window.MediaRecorder && supportedMime !== null;

  return (
    <div className="agent-chat">
      {/* Messages area */}
      <div className="agent-chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="agent-chat-empty">
            <p>Начните общение с AI-ассистентом. Введите сообщение или используйте микрофон.</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`agent-chat-message ${msg.role} ${msg.isError ? "error" : ""}`}>
              <div className="agent-chat-message-content">
                {msg.content}
              </div>
              <div className="agent-chat-message-time">{formatTime(msg.timestamp)}</div>
            </div>
          ))
        )}
        {isLoading && messages.length > 0 && (
          <div className="agent-chat-message assistant">
            <div className="agent-chat-message-content loading">
              <span className="loading-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error display */}
      {error && <div className="alert agent-chat-error">{error}</div>}

      {/* Input area */}
      <form className="agent-chat-input-area" onSubmit={handleSubmit}>
        <div className="agent-chat-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="input agent-chat-input"
            placeholder={isRecording ? "Идет запись..." : "Введите сообщение..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isLoading || isRecording}
          />
          <button
            type="button"
            className={`btn agent-chat-mic-btn ${isRecording ? "recording" : ""}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!canRecord || isLoading}
            title={isRecording ? "Остановить запись" : "Голосовой ввод"}
            aria-label={isRecording ? "Остановить запись" : "Голосовой ввод"}
          >
            {isRecording ? (
              <>
                <span className="mic-icon">⏹</span>
                {elapsed > 0 && <span className="mic-timer">{mmss(elapsed)}</span>}
              </>
            ) : (
              <span className="mic-icon">🎤</span>
            )}
          </button>
          <button
            type="submit"
            className="btn primary agent-chat-send-btn"
            disabled={!inputText.trim() || isLoading || isRecording}
            aria-label="Отправить сообщение"
          >
            Отправить
          </button>
        </div>
        {isRecording && (
          <div className="agent-chat-recording-indicator">
            <span className="recording-pulse"></span>
            Запись: {mmss(elapsed)}
          </div>
        )}
        {!canRecord && (
          <div className="agent-chat-warning">
            Браузер не поддерживает запись голоса
          </div>
        )}
      </form>
    </div>
  );
}

