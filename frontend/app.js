document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('youtube-url');
  const analyzeBtn = document.getElementById('analyze-btn');
  const startTagBtn = document.getElementById('start-tag-btn');
  
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
  
  const progressBox = document.getElementById('progress-box');
  const progressStatus = document.getElementById('progress-status');
  const progressInfo = document.getElementById('progress-info');
  const progressBar = document.getElementById('progress-bar');
  
  const downloadBox = document.getElementById('download-box');
  const finishedFilename = document.getElementById('finished-filename');
  const downloadLink = document.getElementById('download-link');

  // 🌐 백엔드 서버 주소 설정 (Vercel 배포 시 Render 백엔드로 연결, 로컬 구동 시 자동 감지)
  const BACKEND_HOST = window.CONFIG_BACKEND_HOST || (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? window.location.host
      : 'm4a-tag-master-backend.onrender.com'
  );

  const API_HTTP_BASE = BACKEND_HOST.startsWith('http') 
    ? BACKEND_HOST 
    : `${window.location.protocol}//${BACKEND_HOST}`;

  const API_WS_BASE = BACKEND_HOST.startsWith('http')
    ? BACKEND_HOST.replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${BACKEND_HOST}`;

  let currentCoverBase64 = "";

  // 1. 유튜브 URL 분석 요청
  analyzeBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      alert('유튜브 음악 영상 URL을 입력해주세요.');
      return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>메타데이터 분석 및 고화질 커버 탐색 중...</span>';
    downloadBox.classList.add('hidden');
    progressBox.classList.add('hidden');

    try {
      const resp = await fetch(`${API_HTTP_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || '분석에 실패했습니다.');
      }

      // 폼 데이터 채우기
      trackTitle.value = data.title || '';
      trackArtist.value = data.artist || '';
      trackAlbum.value = data.album || '';
      trackLyrics.value = data.lyrics || '';
      
      // 커버 사진 설정
      if (data.cover_base64) {
        currentCoverBase64 = data.cover_base64;
        coverPreview.src = currentCoverBase64;
        coverPreview.classList.remove('hidden');
        coverPlaceholder.classList.add('hidden');
        if (data.cover_source) {
          coverSourceTag.textContent = data.cover_source;
          coverSourceTag.classList.remove('hidden');
        }
      } else {
        coverPreview.classList.add('hidden');
        coverPlaceholder.classList.remove('hidden');
        coverSourceTag.classList.add('hidden');
        currentCoverBase64 = "";
      }

      startTagBtn.disabled = false;

    } catch (err) {
      alert(`오류 발생: ${err.message}`);
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>분석 및 메타데이터 스크래핑</span>';
    }
  });

  // 2. 커버 사진 교체 (파일 첨부 버튼)
  uploadCoverBtn.addEventListener('click', () => {
    coverFileInput.click();
  });

  coverFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
  });

  // 3. 커버 사진 교체 (드래그 앤 드롭)
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
    if (file && file.type.startsWith('image/')) {
      handleImageFile(file);
    }
  });

  function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      currentCoverBase64 = e.target.result;
      coverPreview.src = currentCoverBase64;
      coverPreview.classList.remove('hidden');
      coverPlaceholder.classList.add('hidden');
      coverSourceTag.textContent = 'Custom File Upload (1:1 Ready)';
      coverSourceTag.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  // 4. M4A 다운로드 및 완벽 태그 매립 (WebSocket 스트리밍)
  startTagBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) return;

    startTagBtn.disabled = true;
    startTagBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>오디오 무손실 추출 및 태깅 중...</span>';
    progressBox.classList.remove('hidden');
    downloadBox.classList.add('hidden');
    
    progressBar.style.width = '0%';
    progressStatus.textContent = '웹소켓 연결 및 다운로드 준비 중...';
    progressInfo.textContent = '0%';

    const wsUrl = `${API_WS_BASE}/ws/download`;
    const ws = new WebSocket(wsUrl);

    let isCompleted = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        url,
        title: trackTitle.value.trim(),
        artist: trackArtist.value.trim(),
        album: trackAlbum.value.trim(),
        lyrics: trackLyrics.value.trim(),
        cover_base64: currentCoverBase64
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.status === 'starting') {
        progressStatus.textContent = msg.message;
      } else if (msg.status === 'downloading') {
        progressStatus.textContent = `유튜브 AAC 오디오 스트림 다운로드 중... (${msg.speed || ''})`;
        progressBar.style.width = `${msg.progress}%`;
        progressInfo.textContent = `${msg.progress}% (${msg.eta || 'calc'})`;
      } else if (msg.status === 'converting') {
        progressStatus.textContent = msg.message;
        progressBar.style.width = '90%';
        progressInfo.textContent = '90%';
      } else if (msg.status === 'tagging') {
        progressStatus.textContent = msg.message;
        progressBar.style.width = '95%';
        progressInfo.textContent = '95%';
      } else if (msg.status === 'done') {
        isCompleted = true;
        progressBar.style.width = '100%';
        progressInfo.textContent = '100%';
        progressStatus.textContent = msg.message;
        
        finishedFilename.textContent = msg.filename;
        const dlUrl = msg.download_url.startsWith('http') 
          ? msg.download_url 
          : `${API_HTTP_BASE}${msg.download_url}`;
        downloadLink.href = dlUrl;
        downloadBox.classList.remove('hidden');
        
        startTagBtn.disabled = false;
        startTagBtn.innerHTML = '<i class="fa-solid fa-download"></i> <span>고음질 M4A 추출 & 태그 주입 및 완성하기</span>';
        ws.close();
      } else if (msg.status === 'error') {
        alert(`다운로드 실패: ${msg.message}`);
        startTagBtn.disabled = false;
        startTagBtn.innerHTML = '<i class="fa-solid fa-download"></i> <span>고음질 M4A 추출 & 태그 주입 및 완성하기</span>';
        ws.close();
      }
    };

    ws.onerror = (err) => {
      if (isCompleted) return;
      alert('웹소켓 통신 중 오류가 발생했습니다.');
      startTagBtn.disabled = false;
      startTagBtn.innerHTML = '<i class="fa-solid fa-download"></i> <span>고음질 M4A 추출 & 태그 주입 및 완성하기</span>';
    };
  });
});
