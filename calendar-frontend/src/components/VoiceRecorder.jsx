import React, { useEffect, useRef, useState } from "react";

export default function VoiceRecorder({ whisperUrl = "http://localhost:9000", token, onTranscript }) {
  const [supportedMime, setSupportedMime] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const chunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  // выбрать поддерживаемый mime
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

  useEffect(() => () => stopAll(), []); // cleanup

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
      mr.onstop = handleStop;

      mr.start(100);
      setIsRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setError("Нет доступа к микрофону или браузер не поддерживает запись.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      handleStop();
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

  const handleStop = async () => {
    clearInterval(timerRef.current);
    setIsRecording(false);

    const mime = supportedMime || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];

    // отправка на whisper
    const ext = mime.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `record.${ext}`, { type: mime });
    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch(`${whisperUrl}/transcribe`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Ошибка распознавания (${res.status})`);
      }
      const data = await res.json();
      const text = data?.text || "";
      // передаем текст наверх (например, чтобы заполнить форму события)
      onTranscript?.(text);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      stopAll();
    }
  };

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const disabled = !window.MediaRecorder || supportedMime === null;

  return (
    <div className="voice-recorder-content">
      <div className="voice-recorder-controls">
        <button
          className={`btn voice-recorder-button ${isRecording ? "danger" : "primary"}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={disabled}
        >
          {isRecording ? "■ Стоп" : "● Записать голос"}
        </button>
        {isRecording && <span className="recording-timer">Запись: {mmss(elapsed)}</span>}
        {disabled && <span className="recorder-error">Браузер не поддерживает MediaRecorder</span>}
      </div>
      {error && <div className="alert">{error}</div>}
    </div>
  );
}
