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
  const coverSourceTag = document.getElementById('cover-source-tag');
  const coverFileInput = document.getElementById('cover-file');
  const uploadCoverBtn = document.getElementById('upload-cover-btn');
  const dragOverlay = document.getElementById('drag-overlay');

  const startTagBtn = document.getElementById('start-tag-btn');
  const downloadBox = document.getElementById('download-box');
  const finishedFilename = document.getElementById('finished-filename');
  const downloadLink = document.getElementById('download-link');

  let currentM4aArrayBuffer = null;
  let currentOriginalFilename = "song.m4a";
  let currentCoverBytes = null; // Uint8Array

  // 1. .m4a 음원 파일 선택 처리
  selectM4aBtn.addEventListener('click', () => m4aFileInput.click());

  m4aFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleSelectedM4aFile(file);
  });

  function handleSelectedM4aFile(file) {
    currentOriginalFilename = file.name;
    m4aFilenameDisplay.textContent = `🎵 ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;

    const reader = new FileReader();
    reader.onload = (e) => {
      currentM4aArrayBuffer = e.target.result;
      console.log('M4A ArrayBuffer Loaded:', currentM4aArrayBuffer.byteLength);

      // 파일명에서 아티스트/제목 추정 및 자동 검색 쿼리 구성
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      const cleanedQuery = nameWithoutExt.replace(/\[.*?\]|\(.*?\)|official|music video|mv|hd/gi, "").trim();
      searchQuery.value = cleanedQuery;

      // 자동 파싱 시도 (아티스트 - 곡제목)
      if (cleanedQuery.includes('-')) {
        const parts = cleanedQuery.split('-');
        trackArtist.value = parts[0].strip ? parts[0].strip() : parts[0].trim();
        trackTitle.value = parts[1].strip ? parts[1].strip() : parts[1].trim();
      } else {
        trackTitle.value = cleanedQuery;
      }

      // 파싱 직후 자동 검색 실행
      if (cleanedQuery) {
        fetchMetadataAndLyrics(cleanedQuery);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // 2. iTunes & LRCLIB API 직접 검색
  searchBtn.addEventListener('click', () => {
    const q = searchQuery.value.trim();
    if (!q) {
      alert('검색할 곡 제목이나 아티스트 이름을 입력해 주세요.');
      return;
    }
    fetchMetadataAndLyrics(q);
  });

  async function fetchMetadataAndLyrics(query) {
    searchBtn.disabled = true;
    searchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>탐색 중...</span>';

    try {
      // 2-1. iTunes Search API (1:1 1000x1000 High-Res Cover Art & Info)
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
            loadCoverFromUrl(artUrl, 'iTunes 1000x1000 High-Res');
          }
        }
      }

      // 2-2. LRCLIB API (Lyrics)
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
          if (lyricsText) {
            trackLyrics.value = lyricsText.trim();
          }
        }
      }
    } catch (err) {
      console.warn('API Fetch Notice:', err);
    } finally {
      searchBtn.disabled = false;
      searchBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>커버 & 가사 자동 수집</span>';
    }
  }

  // 3. 커버 이미지 로드 및 1:1 정방형 캔버스 변환
  function loadCoverFromUrl(url, sourceName) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
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

      if (sourceName) {
        coverSourceTag.textContent = sourceName;
        coverSourceTag.classList.remove('hidden');
      }

      // Convert canvas to ArrayBuffer bytes
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          currentCoverBytes = new Uint8Array(e.target.result);
        };
        reader.readAsArrayBuffer(blob);
      }, 'image/jpeg', 0.92);
    };
    img.src = url;
  }

  // 4. 수동 커버 이미지 첨부 및 드래그 앤 드롭
  uploadCoverBtn.addEventListener('click', () => coverFileInput.click());
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
      loadCoverFromUrl(e.target.result, 'Custom Upload (1:1 Ready)');
    };
    reader.readAsDataURL(file);
  }

  // 5. 순수 클라이언트 기반 M4A 태그 주입 & 다운로드 처리
  startTagBtn.addEventListener('click', () => {
    if (!currentM4aArrayBuffer) {
      alert('태그를 주입할 .m4a 오디오 파일을 먼저 선택해 주세요.');
      return;
    }

    startTagBtn.disabled = true;
    startTagBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>M4A Atom 태그 주입 및 인코딩 중...</span>';

    try {
      const metadata = {
        title: trackTitle.value.trim(),
        artist: trackArtist.value.trim(),
        album: trackAlbum.value.trim(),
        lyrics: trackLyrics.value.trim(),
        coverBytes: currentCoverBytes
      };

      // M4ATaggerEngine 호출 (0.05초 만에 바이너리 주입)
      const taggedBlob = M4ATaggerEngine.embedTags(currentM4aArrayBuffer, metadata);
      const downloadUrl = URL.createObjectURL(taggedBlob);

      const safeArtist = metadata.artist || 'Artist';
      const safeTitle = metadata.title || 'Track';
      const outputFilename = `${safeArtist} - ${safeTitle}.m4a`;

      finishedFilename.textContent = outputFilename;
      downloadLink.href = downloadUrl;
      downloadLink.download = outputFilename;
      downloadBox.classList.remove('hidden');

      // 자동 다운로드 트리거 (아이폰 / PC)
      downloadLink.click();

    } catch (err) {
      alert(`태그 매립 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      startTagBtn.disabled = false;
      startTagBtn.innerHTML = '<i class="fa-solid fa-sparkles"></i> <span>🎉 완벽한 M4A 음원 생성 & 내 기기에 저장하기</span>';
    }
  });
});
