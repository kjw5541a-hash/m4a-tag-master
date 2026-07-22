import os
from mutagen.mp4 import MP4, MP4Cover

def tag_m4a_file(
    file_path: str,
    title: str,
    artist: str,
    album: str = "",
    lyrics: str = "",
    cover_image_bytes: bytes = None
) -> bool:
    """
    Apple iTunes / QuickTime 규격의 MP4/M4A 메타데이터(moov.udta.meta.ilst)를 주입합니다.
    - Title: ©nam (\xa9nam)
    - Artist: ©ART (\xa9ART)
    - Album: ©alb (\xa9alb)
    - Lyrics: ©lyr (\xa9lyr)
    - Cover Art: covr (MP4Cover)
    """
    if not os.path.exists(file_path):
        print(f"[Tag Error] File not found: {file_path}")
        return False

    try:
        audio = MP4(file_path)
        
        # 1. 텍스트 태그 설정 (리스트 형태로 삽입하는 것이 MP4Box 표준)
        if title:
            audio["\xa9nam"] = [str(title).strip()]
        if artist:
            audio["\xa9ART"] = [str(artist).strip()]
        if album:
            audio["\xa9alb"] = [str(album).strip()]
        elif artist:
            # 앨범이 비어있으면 싱글 앨범으로 기본 지정
            audio["\xa9alb"] = [f"{str(artist).strip()} - Single"]
            
        if lyrics:
            # 유니코드 줄바꿈 보존하여 비싱크 가사 삽입
            audio["\xa9lyr"] = [str(lyrics).strip()]
            
        # 2. 커버 아트 주입 (covr Box)
        if cover_image_bytes and len(cover_image_bytes) > 0:
            # 마법의 바이트 체크로 JPEG / PNG 판별
            image_format = MP4Cover.FORMAT_JPEG
            if cover_image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                image_format = MP4Cover.FORMAT_PNG
                
            cover_obj = MP4Cover(cover_image_bytes, imageformat=image_format)
            audio["covr"] = [cover_obj]
            
        audio.save()
        print(f"[Tag Success] M4A tagged successfully: {file_path}")
        return True
        
    except Exception as e:
        print(f"[Tag Exception] {e}")
        return False
