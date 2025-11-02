# whisper-service/app.py
import os
import tempfile
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from faster_whisper import WhisperModel

# ---------- Config ----------
WHISPER_MODEL   = os.getenv("WHISPER_MODEL", "medium")  # tiny, base, small, medium, large-v3
COMPUTE_TYPE    = os.getenv("COMPUTE_TYPE", "float16")   # int8 / int8_float16 / float16 / float32
DEVICE          = os.getenv("DEVICE", "cpu")          # "cpu" или "cuda"
MODEL_CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "/models")
VAD_FILTER      = os.getenv("VAD_FILTER", "true").lower() == "true"
BEAM_SIZE       = int(os.getenv("BEAM_SIZE", "5"))

# ---------- App ----------
app = FastAPI(title="Whisper Microservice", version="1.0.0")

# На время разработки — открыть CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# Грузим модель при старте (один раз в память)
model = WhisperModel(
    WHISPER_MODEL,
    device=DEVICE,
    compute_type=COMPUTE_TYPE,
    download_root=MODEL_CACHE_DIR
)

# ---------- Schemas ----------
class Segment(BaseModel):
    start: float
    end: float
    text: str

class TranscribeResponse(BaseModel):
    text: str
    language: Optional[str] = None
    segments: List[Segment]

# ---------- Utils ----------
SUPPORTED_EXTS = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac", ".mp4", ".mkv", ".aac"}

def _safe_suffix(filename: str) -> str:
    suffix = os.path.splitext(filename or "")[1].lower()
    return suffix if suffix in SUPPORTED_EXTS else ".webm"

# ---------- Routes ----------
@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),         # например "ru", "en"
    translate: bool = Form(False),                # True = принудительно в английский
    temperature: float = Form(0.0),               # 0..1
):
    if not file:
        raise HTTPException(400, detail="No file provided")

    # Сохраняем во временный файл (faster-whisper принимает путь)
    suffix = _safe_suffix(file.filename)
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
    except Exception as e:
        raise HTTPException(500, detail=f"Failed to save upload: {e}")

    try:
        segments, info = model.transcribe(
            tmp_path,
            language=language,           # None => автоопределение
            task="translate" if translate else "transcribe",
            vad_filter=VAD_FILTER,
            beam_size=BEAM_SIZE,
            temperature=temperature
        )

        seg_list = []
        full_text = []
        for seg in segments:
            seg_list.append(Segment(start=seg.start, end=seg.end, text=seg.text))
            full_text.append(seg.text)

        return TranscribeResponse(
            text=(" ".join(full_text)).strip(),
            language=info.language if hasattr(info, "language") else language,
            segments=seg_list
        )
    except Exception as e:
        raise HTTPException(500, detail=f"Transcription failed: {e}")
    finally:
        # чистим temp
        try:
            os.remove(tmp_path)
        except Exception:
            pass

@app.get("/healthz")
def healthz():
    return {"status": "ok", "model": WHISPER_MODEL, "device": DEVICE, "compute_type": COMPUTE_TYPE}
