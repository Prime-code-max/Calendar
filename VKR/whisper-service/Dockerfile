# whisper-service/Dockerfile
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# ffmpeg нужен для декодирования аудио/видео
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# каталог для кэша моделей (чтобы не тянуть при каждом запуске)
ENV MODEL_CACHE_DIR=/models
RUN mkdir -p ${MODEL_CACHE_DIR}
VOLUME ["/models"]

COPY app.py ./

EXPOSE 9000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9000"]
