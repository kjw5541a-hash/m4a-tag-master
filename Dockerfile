FROM python:3.11-slim

# FFmpeg 및 필수 패키지 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 파이썬 의존성 설치
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# 소스코드 전체 복사
COPY backend ./backend
COPY frontend ./frontend

# 다운로드 디렉토리 준비
RUN mkdir -p downloads

# Render 클라우드는 $PORT 환경변수를 동적으로 할당함
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
