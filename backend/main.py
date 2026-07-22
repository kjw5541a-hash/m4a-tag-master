import os
import re
import base64
import json
import asyncio
import urllib.parse
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp

from backend.scraper import sanitize_title, fetch_cover_art, fetch_lyrics
from backend.tagger import tag_m4a_file

app = FastAPI(title="M4A Tag-Master Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 다운로드 저장소 생성
DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

class AnalyzeRequest(BaseModel):
    url: str

@app.post("/api/analyze")
def analyze_youtube_url(req: AnalyzeRequest):
    """
    유튜브 URL 메타데이터를 추출하고, 커버 아트와 가사를 자동 수집하여 반환합니다.
    """
    if not req.url or "youtu" not in req.url:
        raise HTTPException(status_code=400, detail="유효한 유튜브 URL을 입력해주세요.")
        
    ydl_opts = {
        'quiet': True,
        'skip_download': True,
        'extract_flat': False,
        'nocheckcertificate': True,
        'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'extractor_args': {
            'youtube': {
                'player_client': ['mweb', 'android', 'ios', 'web'],
            }
        }
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
            
        raw_title = info.get('title', '')
        uploader = info.get('uploader', '') or info.get('channel', '')
        duration = info.get('duration', 0)
        thumbnail_url = info.get('thumbnail', '')
        youtube_id = info.get('id', '')
        
        # 1. 제목 정제 및 아티스트 분리
        sanitized = sanitize_title(raw_title, uploader)
        artist = sanitized["artist"]
        title = sanitized["title"]
        album = sanitized["album"]
        
        # 2. 커버 아트 수집 (iTunes -> 유튜브 썸네일 fallback)
        cover_result = fetch_cover_art(artist, title, thumbnail_url)
        cover_base64 = ""
        if cover_result["data"]:
            cover_base64 = f"data:image/jpeg;base64,{base64.b64encode(cover_result['data']).decode('utf-8')}"
            if cover_result.get("album_suggested"):
                album = cover_result["album_suggested"]
                
        # 3. 가사 수집 (LRCLIB)
        lyrics = fetch_lyrics(artist, title, duration)
        
        return {
            "success": True,
            "youtube_id": youtube_id,
            "raw_title": raw_title,
            "artist": artist,
            "title": title,
            "album": album,
            "lyrics": lyrics,
            "cover_base64": cover_base64,
            "cover_source": cover_result.get("source", ""),
            "duration": duration
        }
        
    except Exception as e:
        print(f"[Analyze Error] {e}")
        raise HTTPException(status_code=500, detail=f"유튜브 분석 중 오류가 발생했습니다: {str(e)}")

@app.websocket("/ws/download")
async def websocket_download_and_tag(websocket: WebSocket):
    """
    유튜브 오디오를 무손실 M4A로 다운로드하고, 사용자가 확정한 메타데이터로 즉시 태깅한 후 진행률을 실시간 전송합니다.
    """
    await websocket.accept()
    try:
        data = await websocket.receive_text()
        req = json.loads(data)
        
        url = req.get("url")
        artist = req.get("artist", "").strip()
        title = req.get("title", "").strip()
        album = req.get("album", "").strip()
        lyrics = req.get("lyrics", "").strip()
        cover_base64 = req.get("cover_base64", "")
        
        if not url:
            await websocket.send_json({"status": "error", "message": "URL이 누락되었습니다."})
            return
            
        # 안전한 파일명 생성
        safe_filename = re.sub(r'[\\/*?:"<>|]', "", f"{artist} - {title}".strip() if artist and title else "downloaded_track")
        if not safe_filename:
            safe_filename = "downloaded_track"
        output_template = os.path.join(DOWNLOAD_DIR, f"{safe_filename}.%(ext)s")
        
        # 진행률 전송 콜백
        def progress_hook(d):
            if d['status'] == 'downloading':
                try:
                    p_str = d.get('_percent_str', '0%').strip().replace('%', '')
                    speed = d.get('_speed_str', '')
                    eta = d.get('_eta_str', '')
                    asyncio.run_coroutine_threadsafe(
                        websocket.send_json({
                            "status": "downloading",
                            "progress": float(p_str) if p_str.replace('.', '', 1).isdigit() else 50.0,
                            "speed": speed,
                            "eta": eta
                        }),
                        loop
                    )
                except Exception:
                    pass
            elif d['status'] == 'finished':
                asyncio.run_coroutine_threadsafe(
                    websocket.send_json({"status": "converting", "message": "M4A 오디오 컨테이너 변환 및 정렬 중..."}),
                    loop
                )

        loop = asyncio.get_event_loop()
        
        # yt-dlp 옵션 (무손실 AAC 스트림 복사 -> m4a)
        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/best',
            'outtmpl': output_template,
            'progress_hooks': [progress_hook],
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'm4a',
                'preferredquality': '0', # 원본 품질 유지
            }],
            'quiet': True,
            'nocheckcertificate': True,
            'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
            'extractor_args': {
                'youtube': {
                    'player_client': ['mweb', 'android', 'ios', 'web'],
                }
            }
        }
        
        await websocket.send_json({"status": "starting", "message": "유튜브 무손실 오디오 스트림 다운로드 시작..."})
        
        # 다운로드 실행 (백그라운드 스레드)
        def run_ydl():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])
                
        await loop.run_in_executor(None, run_ydl)
        
        final_filepath = os.path.join(DOWNLOAD_DIR, f"{safe_filename}.m4a")
        if not os.path.exists(final_filepath):
            # yt-dlp가 가끔 다른 확장자로 임시 저장 후 변환했을 경우 탐색
            for f in os.listdir(DOWNLOAD_DIR):
                if safe_filename in f and f.endswith(".m4a"):
                    final_filepath = os.path.join(DOWNLOAD_DIR, f)
                    break
                    
        if not os.path.exists(final_filepath):
            await websocket.send_json({"status": "error", "message": "다운로드 완료 후 M4A 파일을 찾을 수 없습니다."})
            return
            
        await websocket.send_json({"status": "tagging", "message": "Apple 표준 MP4Box 메타데이터 및 커버 이미지 매립 중..."})
        
        # 커버 이미지 바이너리 추출
        cover_bytes = None
        if cover_base64 and "," in cover_base64:
            try:
                b64_data = cover_base64.split(",", 1)[1]
                cover_bytes = base64.b64decode(b64_data)
            except Exception as e:
                print(f"[Cover Decode Error] {e}")
                
        # 태그 매립
        tag_result = tag_m4a_file(
            file_path=final_filepath,
            title=title,
            artist=artist,
            album=album,
            lyrics=lyrics,
            cover_image_bytes=cover_bytes
        )
        
        if tag_result:
            await websocket.send_json({
                "status": "done",
                "message": "🎉 완벽한 메타데이터가 담긴 M4A 음원이 완성되었습니다!",
                "filename": f"{safe_filename}.m4a",
                "download_url": f"/api/download?filename={urllib.parse.quote(f'{safe_filename}.m4a')}"
            })
        else:
            await websocket.send_json({"status": "error", "message": "오디오 다운로드는 완료되었으나 메타데이터 태깅에 실패했습니다."})
            
    except WebSocketDisconnect:
        print("Client disconnected from WebSocket")
    except Exception as e:
        print(f"[WebSocket Error] {e}")
        try:
            await websocket.send_json({"status": "error", "message": str(e)})
        except Exception:
            pass

@app.get("/api/download")
def download_tagged_file(filename: str):
    """
    완성된 M4A 파일을 클라이언트로 다운로드합니다.
    """
    file_path = os.path.join(DOWNLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="audio/mp4"
    )

# 프론트엔드 정적 디렉토리 마운트 (마지막에 위치해야 API 라우팅을 가리지 않음)
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
