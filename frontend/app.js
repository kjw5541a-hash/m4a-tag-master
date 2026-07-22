document.addEventListener('DOMContentLoaded', () => {
  const m4aFileInput = document.getElementById('m4a-file-input');
  const selectM4aBtn = document.getElementById('select-m4a-btn');
  const m4aFilenameDisplay = document.getElementById('m4a-filename-display');
  
  const searchQuery = document.getElementById('search-query');
  const searchBtn = document.getElementById('search-btn');

  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');
  const trackAlbum = document.getElementById('track-album');
  const trackLyrics = document.getElementById('track-lyrics');

  const coverFrame = document.getElementById('cover-frame');
  const coverPlaceholder = document.getElementById('cover-placeholder');
  const coverPreview = document.getElementById('cover-preview');
  const coverFileInput = document.getElementById('cover-file');
  const uploadCoverBtn = document.getElementById('upload-cover-btn');
  const dragOverlay = document.getElementById('drag-overlay');

  const lyricsHeader = document.getElementById('lyrics-accordion-header');
  const lyricsBody = document.getElementById('lyrics-accordion-body');
  const lyricsArrow = document.getElementById('accordion-arrow');
  const lyricsStatusTag = document.getElementById('lyrics-status-tag');

  const startTagBtn = document.getElementById('start-tag-btn');
  const downloadBox = document.getElementById('download-box');
  const finishedFilename = document.getElementById('finished-filename');
  const downloadLink = document.getElementById('download-link');

  let currentM4aArrayBuffer = null;
  let currentCoverBytes = null; // Uint8Array

  // 1. 가사 아코디언 접기/펼치기 제어
  lyricsHeader.addEventListener('click', () => {
    lyricsBody.classList.toggle('collapsed');
    lyricsArrow.classList.toggle('rotated');
  });

  function updateLyricsStatusTag(text) {
    if (text && text.trim()) {
      const lines = text.trim().split('\n').length;
      lyricsStatusTag.textContent = `가사 수집 완료 (${lines}줄)`;
      lyricsStatusTag.classList.add('active');
    } else {
      lyricsStatusTag.textContent = '비어있음';
      lyricsStatusTag.classList.remove('active');
    }
  }

  trackLyrics.addEventListener('input', () => {
    updateLyricsStatusTag(trackLyrics.value);
  });

  // 2. 스마트 파일명 정제기 (Smart Filename Sanitizer)
  function sanitizeFilenameToQuery(filename) {
    // macOS/iOS 한글 유니코드 정규화 (NFD -> NFC)
    let s = filename.normalize ? filename.normalize('NFC') : filename;
    
    // 확장자 제거
    s = s.replace(/\.[^/.]+$/, "");

    // 자주 사용되는 유튜브 채널명 제거
    const channelPatterns = [
      /1theK\s*\([^)]*\)/gi,
      /1theK/gi,
      /CJENMMUSIC\s*Official/gi,
      /CJENMMUSIC/gi,
      /HYBE\s*LABELS/gi,
      /Stone\s*Music\s*Entertainment/gi,
      /YG\s*ENTERTAINMENT/gi,
      /SMTOWN/gi,
      /Official\s*VEVO/gi,
      /VEVO/gi,
      /- Topic/gi,
      /Official\s*Channel/gi
    ];
    for (const p of channelPatterns) {
      s = s.replace(p, "");
    }

    // 유튜브 노이즈 태그 및 특수문자 제거
    const noisePatterns = [
      /\[.*?official.*?\]/gi,
      /\(.*Path.*? official.*?\)/gi,
      /\[.*?mv.*?\]/gi,
      /\(.*Path.*?mv.*?\)/gi,
      /\[.*?lyrics?.*?\]/gi,
      /\(.*Path.*?lyrics?.*?\)/gi,
      /\[.*?가사.*?\]/gi,
      /\(.*Path.*?가사.*?\)/gi,
      /official\s*video/gi,
      /music\s*video/gi,
      /official\s*audio/gi,
      /live\s*session/gi,
      /hd|4k|1080p/gi,
      /공식음원|라이브/gi
    ];
    for (const p of noisePatterns) {
      s = s.replace(p, "");
    }

    // 밑줄(_) 및 괄호 잔여 정리
    s = s.replace(/_/g, " ");
    s = s.replace(/\[\s*\]|\(\s*\)/g, "");
    s = s.replace(/\s+/g, " ").strip ? s.replace(/\s+/g, " ").strip() : s.replace(/\s+/g, " ").trim();

    return s;
  }

  // 3. .m4a 파일 선택 및 자동 파싱
  selectM4aBtn.addEventListener('click', () => m4aFileInput.click());

  m4aFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleSelectedM4aFile(file);
  });

  function handleSelectedM4aFile(file) {
    const cleanName = file.name.normalize ? file.name.normalize('NFC') : file.name;
    m4aFilenameDisplay.textContent = `🎵 ${cleanName}`;

    const reader = new FileReader();
    reader.onload = (e) => {
      currentM4aArrayBuffer = e.target.result;

      // 파일명 정제
      const cleanedQuery = sanitizeFilenameToQuery(cleanName);
      searchQuery.value = cleanedQuery;

      // 아티스트 - 제목 분리 시도
      let parsedArtist = "";
      let parsedTitle = cleanedQuery;

      if (cleanedQuery.includes('-')) {
        const parts = cleanedQuery.split('-');
        parsedArtist = parts[0].trim();
        parsedTitle = parts[1].trim();
      } else if (cleanedQuery.includes('–')) {
        const parts = cleanedQuery.split('–');
        parsedArtist = parts[0].trim();
        parsedTitle = parts[1].trim();
      }

      trackArtist.value = parsedArtist;
      trackTitle.value = parsedTitle;

      if (cleanedQuery) {
        fetchMetadataAndLyrics(cleanedQuery);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // 4. iTunes Search API & LRCLIB API 수집 (CORS 우회 로더 연동)
  searchBtn.addEventListener('click', () => {
    const q = searchQuery.value.trim();
    if (!q) {
      alert('검색할 곡명이나 아티스트 이름을 입력해 주세요.');
      return;
    }
    fetchMetadataAndLyrics(q);
  });

  async function fetchMetadataAndLyrics(query) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
      // iTunes API 검색
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=3`;
      const itunesResp = await fetch(itunesUrl);
      if (itunesResp.ok) {
        const data = await itunesResp.json();
        if (data.results && data.results.length > 0) {
          const match = data.results[0];
          if (!trackTitle.value || trackTitle.value === query) trackTitle.value = match.trackName || '';
          if (!trackArtist.value) trackArtist.value = match.artistName || '';
          if (!trackAlbum.value) trackAlbum.value = match.collectionName || '';

          const artUrl = match.artworkUrl100
            ? match.artworkUrl100.replace('100x100bb.jpg', '1000x1000bb.jpg').replace('100x100.jpg', '1000x1000.jpg')
            : '';

          if (artUrl) {
            await safeLoadCoverFromUrl(artUrl);
          }
        }
      }

      // LRCLIB API 가사 검색
      const lrclibUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      const lrclibResp = await fetch(lrclibUrl);
      if (lrclibResp.ok) {
        const lrcData = await lrclibResp.json();
        if (Array.isArray(lrcData) && lrcData.length > 0) {
          const best = lrcData[0];
          let lyricsText = best.plainLyrics;
          if (!lyricsText && best.syncedLyrics) {
            lyricsText = best.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '');
          }
          if (lyricsText && lyricsText.trim()) {
            trackLyrics.value = lyricsText.trim();
            updateLyricsStatusTag(lyricsText.trim());
          }
        }
      }
    } catch (err) {
      console.warn('Metadata fetch notice:', err);
    } finally {
      searchBtn.disabled = false;
      searchBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>수집</span>';
    }
  }

  // 5. CORS 보안 차단(Canvas Taint) 없는 안전한 커버 로더 (Direct Blob Fetch)
  async function safeLoadCoverFromUrl(imageUrl) {
    try {
      // 이미지 바이너리를 직접 fetch하여 CORS Taint 오염 원천 차단
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error('Image fetch failed');
      const blob = await resp.blob();

      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1000;
        canvas.height = 1000;
        const ctx = canvas.getContext('2d');

        // 1:1 Center Crop
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 1000, 1000);
        coverPreview.src = canvas.toDataURL('image/jpeg', 0.92);
        coverPreview.classList.remove('hidden');
        coverPlaceholder.classList.add('hidden');

        canvas.toBlob((jpegBlob) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            currentCoverBytes = new Uint8Array(e.target.result);
          };
          reader.readAsArrayBuffer(jpegBlob);
        }, 'image/jpeg', 0.92);

        URL.revokeObjectURL(objectUrl);
      };
      img.src = objectUrl;
    } catch (e) {
      console.warn('Direct blob cover load notice:', e);
    }
  }

  // 6. 커버 이미지 교체 (터치 / 드래그 앤 드롭)
  coverFrame.addEventListener('click', () => coverFileInput.click());
  uploadCoverBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    coverFileInput.click();
  });

  coverFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleCustomImageFile(file);
  });

  coverFrame.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('hidden');
  });
  coverFrame.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragOverlay.classList.add('hidden');
  });
  coverFrame.addEventListener('drop', (e) => {
    e.preventDefault();
    dragOverlay.classList.add('hidden');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleCustomImageFile(file);
  });

  function handleCustomImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1000;
        canvas.height = 1000;
        const ctx = canvas.getContext('2d');

        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 1000, 1000);
        coverPreview.src = canvas.toDataURL('image/jpeg', 0.92);
        coverPreview.classList.remove('hidden');
        coverPlaceholder.classList.add('hidden');

        canvas.toBlob((jpegBlob) => {
          const r = new FileReader();
          r.onload = (ev) => {
            currentCoverBytes = new Uint8Array(ev.target.result);
          };
          r.readAsArrayBuffer(jpegBlob);
        }, 'image/jpeg', 0.92);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // 7. M4A 태그 주입 및 iOS "파일에 저장 (Save to Files)" Native Share API 연동
  startTagBtn.addEventListener('click', async () => {
    if (!currentM4aArrayBuffer) {
      alert('태그를 주입할 .m4a 오디오 파일을 먼저 선택해 주세요.');
      return;
    }

    startTagBtn.disabled = true;
    startTagBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>태그 매립 중...</span>';

    try {
      const metadata = {
        title: trackTitle.value.trim(),
        artist: trackArtist.value.trim(),
        album: trackAlbum.value.trim(),
        lyrics: trackLyrics.value.trim(),
        coverBytes: currentCoverBytes
      };

      // M4A Atom 바이너리 태깅
      const taggedBlob = M4ATaggerEngine.embedTags(currentM4aArrayBuffer, metadata);

      const safeArtist = metadata.artist || 'Artist';
      const safeTitle = metadata.title || 'Track';
      const outputFilename = `${safeArtist} - ${safeTitle}.m4a`;

      // iOS Native Share API (navigator.share) - 아이폰 "파일에 저장" 팝업 호출
      const fileToShare = new File([taggedBlob], outputFilename, { type: 'audio/mp4' });

      if (navigator.canShare && navigator.canShare({ files: [fileToShare] })) {
        await navigator.share({
          files: [fileToShare]
        });
      } else {
        // Desktop / Chrome Fallback 다운로드 링크
        const downloadUrl = URL.createObjectURL(taggedBlob);
        finishedFilename.textContent = outputFilename;
        downloadLink.href = downloadUrl;
        downloadLink.download = outputFilename;
        downloadBox.classList.remove('hidden');
        downloadLink.click();
      }

    } catch (err) {
      if (err.name !== 'AbortError') {
        alert(`저장 중 오류가 발생했습니다: ${err.message}`);
      }
    } finally {
      startTagBtn.disabled = false;
      startTagBtn.innerHTML = '<i class="fa-solid fa-circle-down"></i> <span>🎉 완벽한 M4A 음원 생성 & 파일 앱에 저장</span>';
    }
  });
});
