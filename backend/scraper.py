import re
import io
import urllib.parse
import requests
from PIL import Image

def sanitize_title(raw_title: str, channel_name: str = "") -> dict:
    """
    유튜브 영상 제목과 채널명을 분석하여 아티스트명과 곡 제목을 깔끔하게 분리하고 정제합니다.
    """
    # 1. 흔히 붙는 유튜브 태그 제거 (대소문자 무시)
    patterns_to_remove = [
        r"\b(official\s*(music\s*)?video)\b",
        r"\b(official\s*audio)\b",
        r"\b(official\s*mv)\b",
        r"\b(music\s*video)\b",
        r"\b(lyric(s)?\s*video)\b",
        r"\b(audio\s*only)\b",
        r"\b(high\s*quality|hq|hd|4k|1080p)\b",
        r"\b(live\s*session|live\s*version)\b",
        r"\b(remastered(\s*\d{4})?)\b",
        r"\[.*?official.*?\]",
        r"\(.*?official.*?\)",
        r"\[.*?mv.*?\]",
        r"\(.*?mv.*?\)",
        r"\[.*?video.*?\]",
        r"\(.*?video.*?\)",
        r"\[.*?audio.*?\]",
        r"\(.*?audio.*?\)",
        r"\[.*?lyrics?.*?\]",
        r"\(.*?lyrics?.*?\)",
    ]
    
    cleaned = raw_title
    for p in patterns_to_remove:
        cleaned = re.sub(p, "", cleaned, flags=re.IGNORECASE)
    
    # 괄호만 남거나 불필요한 특수문자 정리
    cleaned = re.sub(r"\[\s*\]|\(\s*\)", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    
    # 2. 아티스트 - 제목 분리 시도 (- 또는 – 또는 | 또는 :)
    artist = ""
    title = cleaned
    
    delimiters = [r"\s+-\s+", r"\s+–\s+", r"\s+—\s+", r"\s+:\s+", r"\s+\|\s+"]
    for delim in delimiters:
        parts = re.split(delim, cleaned, maxsplit=1)
        if len(parts) == 2:
            artist = parts[0].strip()
            title = parts[1].strip()
            break
            
    # 분리가 안 되었지만 channel_name이 있다면 채널명을 아티스트로 활용
    if not artist and channel_name:
        # 채널명에서 - Topic, Official 등 제거
        channel_clean = re.sub(r"\s+-\s+Topic|\s+Official.*|\s+VEVO", "", channel_name, flags=re.IGNORECASE).strip()
        artist = channel_clean
        
    # 따옴표 및 불필요한 바깥쪽 괄호 정리
    def clean_outer(s: str) -> str:
        s = s.strip(' "\'[]')
        if s.startswith('(') and s.endswith(')'):
            s = s[1:-1].strip()
        return s
        
    title = clean_outer(title)
    artist = clean_outer(artist)
    
    return {
        "artist": artist,
        "title": title,
        "album": artist if artist else "Single"
    }

def process_and_square_crop(image_bytes: bytes, target_size: int = 1000) -> bytes:
    """
    이미지 바이너리를 받아 1:1 정방형으로 중앙 크롭하고, 고해상도 리사이징하여 JPEG 바이트로 반환합니다.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            # RGB로 변환 (PNG 등 투명도 문제 방지)
            if img.mode != "RGB":
                img = img.convert("RGB")
                
            width, height = img.size
            if width != height:
                min_dim = min(width, height)
                left = (width - min_dim) // 2
                top = (height - min_dim) // 2
                right = left + min_dim
                bottom = top + min_dim
                img = img.crop((left, top, right, bottom))
                
            # 리사이징 (Lanczos 고화질 필터)
            img = img.resize((target_size, target_size), Image.Resampling.LANCZOS)
            
            output = io.BytesIO()
            img.save(output, format="JPEG", quality=92)
            return output.getvalue()
    except Exception as e:
        print(f"[Image Process Error] {e}")
        return image_bytes

def fetch_cover_art(artist: str, title: str, fallback_url: str = None) -> dict:
    """
    iTunes Search API를 통해 최고 화질(1000x1000) 앨범 커버를 찾습니다.
    실패 시 fallback_url (유튜브 썸네일)을 다운로드하여 1:1 정방형으로 크롭합니다.
    """
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    
    # 1. iTunes API 검색
    if artist or title:
        query = f"{artist} {title}".strip()
        encoded_query = urllib.parse.quote(query)
        url = f"https://itunes.apple.com/search?term={encoded_query}&entity=song&limit=5"
        try:
            resp = requests.get(url, headers=headers, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                if results:
                    best_match = results[0]
                    art_url = best_match.get("artworkUrl100", "")
                    if art_url:
                        # 100x100bb.jpg -> 1000x1000bb.jpg 고화질 URL 치환
                        high_res_url = art_url.replace("100x100bb.jpg", "1000x1000bb.jpg").replace("100x100.jpg", "1000x1000.jpg")
                        img_resp = requests.get(high_res_url, headers=headers, timeout=10)
                        if img_resp.status_code == 200:
                            processed = process_and_square_crop(img_resp.content, 1000)
                            return {
                                "source": "iTunes API (High-Res Album Art)",
                                "data": processed,
                                "album_suggested": best_match.get("collectionName", "")
                            }
        except Exception as e:
            print(f"[iTunes Search Error] {e}")
            
    # 2. Fallback: YouTube Thumbnail
    if fallback_url:
        try:
            img_resp = requests.get(fallback_url, headers=headers, timeout=10)
            if img_resp.status_code == 200:
                processed = process_and_square_crop(img_resp.content, 1000)
                return {
                    "source": "YouTube High-Res Thumbnail (Square Cropped)",
                    "data": processed,
                    "album_suggested": ""
                }
        except Exception as e:
            print(f"[Fallback Thumbnail Error] {e}")
            
    return {"source": "None", "data": None, "album_suggested": ""}

def fetch_lyrics(artist: str, title: str, duration: int = None) -> str:
    """
    LRCLIB API를 통해 곡의 가사(일반 텍스트 또는 싱크 텍스트)를 다각도로 검색하여 반환합니다.
    """
    if not title:
        return ""
        
    headers = {"User-Agent": "M4A-Tag-Master-Studio/1.0 (https://github.com/google/antigravity)"}
    
    # 아티스트 특수문자 및 괄호 정리 (예: IU(아이유) -> IU 아이유 또는 IU)
    clean_artist = re.sub(r"[\(\)\[\]]", " ", artist).strip()
    clean_artist = re.sub(r"\s+", " ", clean_artist)
    
    clean_title = re.sub(r"[\(\)\[\]]", " ", title).strip()
    clean_title = re.sub(r"\s+", " ", clean_title)
    
    # 1. Exact match via GET
    for a in [artist, clean_artist, clean_artist.split()[0] if clean_artist else ""]:
        if not a:
            continue
        try:
            params = {
                "artist_name": a,
                "track_name": title,
            }
            if duration:
                params["duration"] = duration
                
            resp = requests.get("https://lrclib.net/api/get", params=params, headers=headers, timeout=4)
            if resp.status_code == 200:
                data = resp.json()
                plain = data.get("plainLyrics")
                if plain and plain.strip():
                    return plain.strip()
                synced = data.get("syncedLyrics")
                if synced and synced.strip():
                    cleaned = re.sub(r"\[\d{2}:\d{2}\.\d{2,3}\]\s*", "", synced)
                    return cleaned.strip()
        except Exception as e:
            print(f"[LRCLIB Get Error ({a})] {e}")

    # 2. Search queries
    queries = [
        f"{clean_artist} {clean_title}".strip(),
        f"{clean_title}".strip()
    ]
    
    for q in queries:
        if not q:
            continue
        try:
            params = {"q": q}
            resp = requests.get("https://lrclib.net/api/search", params=params, headers=headers, timeout=4)
            if resp.status_code == 200:
                results = resp.json()
                if isinstance(results, list) and len(results) > 0:
                    # 첫 번째 유효 가사 검색 결과 채택
                    for best in results:
                        plain = best.get("plainLyrics")
                        if plain and plain.strip():
                            return plain.strip()
                        synced = best.get("syncedLyrics")
                        if synced and synced.strip():
                            cleaned = re.sub(r"\[\d{2}:\d{2}\.\d{2,3}\]\s*", "", synced)
                            return cleaned.strip()
        except Exception as e:
            print(f"[LRCLIB Search Error ({q})] {e}")
            
    return ""
