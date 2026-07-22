/**
 * M4A Tagger Engine - Pure Client-Side JavaScript MPEG-4 Atom Writer
 * Designed for iPhone Safari & Modern Browsers (Zero-Server Architecture)
 * Supports: ©nam (Title), ©ART (Artist), ©alb (Album), ©lyr (Lyrics), covr (Cover Art)
 */

class M4ATaggerEngine {
  /**
   * DataView Data Writer Helper (Big-Endian)
   */
  static writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  static stringToBytes(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }

  /**
   * iTunes ilst 단일 데이터 Atom (data atom) 생성
   * @param {string} fourcc - atom 태그 키 ('©nam', '©ART', '©alb', '©lyr', 'covr')
   * @param {Uint8Array|string} payload - 주입할 데이터
   * @param {number} flags - 1: UTF-8 텍스트, 13: JPEG, 14: PNG
   */
  static createIlstItemAtom(fourcc, payload, flags = 1) {
    let payloadBytes;
    if (typeof payload === 'string') {
      payloadBytes = this.stringToBytes(payload);
    } else {
      payloadBytes = payload;
    }

    // data atom 헤더: [4 bytes size] + 'data' [4 bytes] + [4 bytes flags] + [4 bytes reserved] = 16 bytes
    const dataAtomSize = 16 + payloadBytes.length;
    const itemAtomSize = 8 + dataAtomSize; // 4-byte key + 4-byte size = 8 bytes

    const buffer = new ArrayBuffer(itemAtomSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // 1. Item Atom Header
    view.setUint32(0, itemAtomSize, false);
    this.writeString(view, 4, fourcc);

    // 2. Data Atom Header
    view.setUint32(8, dataAtomSize, false);
    this.writeString(view, 12, 'data');
    view.setUint32(16, flags, false); // Type flags (1=UTF8, 13=JPEG, 14=PNG)
    view.setUint32(20, 0, false);      // Reserved (0)

    // 3. Payload
    bytes.set(payloadBytes, 24);

    return bytes;
  }

  /**
   * 새로운 ilst (iTunes Metadata List) Box 생성
   */
  static createIlstBox({ title, artist, album, lyrics, coverBytes }) {
    const itemBytesList = [];

    if (title && title.trim()) {
      itemBytesList.push(this.createIlstItemAtom('\xa9nam', title.trim(), 1));
    }
    if (artist && artist.trim()) {
      itemBytesList.push(this.createIlstItemAtom('\xa9ART', artist.trim(), 1));
    }
    if (album && album.trim()) {
      itemBytesList.push(this.createIlstItemAtom('\xa9alb', album.trim(), 1));
    }
    if (lyrics && lyrics.trim()) {
      itemBytesList.push(this.createIlstItemAtom('\xa9lyr', lyrics.trim(), 1));
    }
    if (coverBytes && coverBytes.length > 0) {
      // JPEG vs PNG 판별
      let isPng = coverBytes[0] === 0x89 && coverBytes[1] === 0x50 && coverBytes[2] === 0x4e && coverBytes[3] === 0x47;
      const flags = isPng ? 14 : 13;
      itemBytesList.push(this.createIlstItemAtom('covr', coverBytes, flags));
    }

    let totalContentSize = 0;
    for (const item of itemBytesList) {
      totalContentSize += item.length;
    }

    const ilstBoxSize = 8 + totalContentSize;
    const ilstBuffer = new ArrayBuffer(ilstBoxSize);
    const view = new DataView(ilstBuffer);
    const bytes = new Uint8Array(ilstBuffer);

    view.setUint32(0, ilstBoxSize, false);
    this.writeString(view, 4, 'ilst');

    let offset = 8;
    for (const item of itemBytesList) {
      bytes.set(item, offset);
      offset += item.length;
    }

    return bytes;
  }

  /**
   * meta Atom 생성 (hdlr + ilst 포장)
   */
  static createMetaBox(ilstBytes) {
    // hdlr (Handler Reference Atom) - 33 bytes
    const hdlrSize = 33;
    const hdlrBuffer = new ArrayBuffer(hdlrSize);
    const hdlrView = new DataView(hdlrBuffer);
    const hdlrBytes = new Uint8Array(hdlrBuffer);

    hdlrView.setUint32(0, hdlrSize, false);
    this.writeString(hdlrView, 4, 'hdlr');
    hdlrView.setUint32(8, 0, false); // version + flags
    hdlrView.setUint32(12, 0, false); // pre_defined
    this.writeString(hdlrView, 16, 'mdir'); // handler type
    this.writeString(hdlrView, 20, 'appl'); // manufacturer
    hdlrView.setUint32(24, 0, false); // flags
    hdlrView.setUint32(28, 0, false); // flags

    // meta Box = 12 bytes (size + 'meta' + version/flags 4bytes) + hdlr (33bytes) + ilst
    const metaSize = 12 + hdlrSize + ilstBytes.length;
    const metaBuffer = new ArrayBuffer(metaSize);
    const metaView = new DataView(metaBuffer);
    const metaBytes = new Uint8Array(metaBuffer);

    metaView.setUint32(0, metaSize, false);
    this.writeString(metaView, 4, 'meta');
    metaView.setUint32(8, 0, false); // Fullbox version/flags

    metaBytes.set(hdlrBytes, 12);
    metaBytes.set(ilstBytes, 12 + hdlrSize);

    return metaBytes;
  }

  /**
   * udta Atom 생성 (meta 주입)
   */
  static createUdtaBox(metaBytes) {
    const udtaSize = 8 + metaBytes.length;
    const udtaBuffer = new ArrayBuffer(udtaSize);
    const udtaView = new DataView(udtaBuffer);
    const udtaBytes = new Uint8Array(udtaBuffer);

    udtaView.setUint32(0, udtaSize, false);
    this.writeString(udtaView, 4, 'udta');
    udtaBytes.set(metaBytes, 8);

    return udtaBytes;
  }

  /**
   * M4A ArrayBuffer 파싱 및 stco/co64 오프셋 재계산 후 태그가 완료된 신규 ArrayBuffer/Blob 생성
   */
  static embedTags(inputArrayBuffer, metadata) {
    const inputBytes = new Uint8Array(inputArrayBuffer);
    const inputView = new DataView(inputArrayBuffer);

    const ilstBytes = this.createIlstBox(metadata);
    const metaBytes = this.createMetaBox(ilstBytes);
    const newUdtaBytes = this.createUdtaBox(metaBytes);

    // Top-level Box 파싱
    let offset = 0;
    let moovStart = -1;
    let moovSize = 0;
    let mdatStart = -1;
    let mdatSize = 0;
    const boxes = [];

    while (offset < inputBytes.length) {
      if (offset + 8 > inputBytes.length) break;
      let size = inputView.getUint32(offset, false);
      const name = String.fromCharCode(
        inputBytes[offset + 4],
        inputBytes[offset + 5],
        inputBytes[offset + 6],
        inputBytes[offset + 7]
      );

      if (size === 1) {

        size = Number(inputView.getBigUint64(offset + 8, false));
      } else if (size === 0) {
        size = inputBytes.length - offset;
      }

      boxes.push({ name, start: offset, size });

      if (name === 'moov') {
        moovStart = offset;
        moovSize = size;
      } else if (name === 'mdat') {
        mdatStart = offset;
        mdatSize = size;
      }

      offset += size;
    }

    if (moovStart === -1) {
      throw new Error("유효한 M4A/MP4 오디오 파일이 아닙니다 (moov atom 없음).");
    }

    // moov 박스 복사 및 udta 교체/추가
    const moovBytes = inputBytes.subarray(moovStart, moovStart + moovSize);
    const newMoovBytes = this.patchMoovBox(moovBytes, newUdtaBytes);

    // 새 파일 조립
    const parts = [];
    let moovDelta = newMoovBytes.length - moovSize;

    for (const box of boxes) {
      if (box.name === 'moov') {
        parts.push(newMoovBytes);
      } else {
        parts.push(inputBytes.subarray(box.start, box.start + box.size));
      }
    }

    // Total ArrayBuffer 생성
    let totalSize = 0;
    for (const p of parts) totalSize += p.length;

    const finalBuffer = new ArrayBuffer(totalSize);
    const finalBytes = new Uint8Array(finalBuffer);
    let writeOffset = 0;

    for (const p of parts) {
      finalBytes.set(p, writeOffset);
      writeOffset += p.length;
    }

    // mdat Chunk Offset (stco) 재정렬 처리
    if (moovDelta !== 0 && mdatStart > moovStart) {
      this.shiftChunkOffsets(finalBytes, moovStart, newMoovBytes.length, moovDelta);
    }

    return new Blob([finalBuffer], { type: 'audio/mp4' });
  }

  /**
   * moov 박스 내의 udta를 교체하거나 신규 삽입
   */
  static patchMoovBox(moovBytes, newUdtaBytes) {
    const moovView = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    let offset = 8;
    let existingUdtaStart = -1;
    let existingUdtaSize = 0;
    const moovChildren = [];

    while (offset < moovBytes.length) {
      if (offset + 8 > moovBytes.length) break;
      const size = moovView.getUint32(offset, false);
      const name = String.fromCharCode(
        moovBytes[offset + 4],
        moovBytes[offset + 5],
        moovBytes[offset + 6],
        moovBytes[offset + 7]
      );

      if (name === 'udta') {
        existingUdtaStart = offset;
        existingUdtaSize = size;
      } else {
        moovChildren.push({ name, start: offset, size });
      }
      offset += size;
    }

    let newMoovContentSize = newUdtaBytes.length;
    for (const child of moovChildren) {
      newMoovContentSize += child.size;
    }

    const newMoovSize = 8 + newMoovContentSize;
    const newMoovBuffer = new ArrayBuffer(newMoovSize);
    const newMoovView = new DataView(newMoovBuffer);
    const newMoovBytes = new Uint8Array(newMoovBuffer);

    newMoovView.setUint32(0, newMoovSize, false);
    this.writeString(newMoovView, 4, 'moov');

    let writeOffset = 8;
    for (const child of moovChildren) {
      newMoovBytes.set(moovBytes.subarray(child.start, child.start + child.size), writeOffset);
      writeOffset += child.size;
    }

    newMoovBytes.set(newUdtaBytes, writeOffset);

    return newMoovBytes;
  }

  /**
   * stco (Sample Table Chunk Offset) 수치 보정
   */
  static shiftChunkOffsets(fileBytes, moovStart, newMoovSize, delta) {
    const fileView = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
    let offset = moovStart + 8;
    const moovEnd = moovStart + newMoovSize;

    // stco atom 탐색 (재귀 검색)
    function searchStco(start, end) {
      let curr = start;
      while (curr < end - 8) {
        const size = fileView.getUint32(curr, false);
        if (size < 8 || curr + size > end) break;

        const name = String.fromCharCode(
          fileBytes[curr + 4],
          fileBytes[curr + 5],
          fileBytes[curr + 6],
          fileBytes[curr + 7]
        );

        if (name === 'stco') {
          const entryCount = fileView.getUint32(curr + 12, false);
          let stcoOffset = curr + 16;
          for (let i = 0; i < entryCount; i++) {
            const oldVal = fileView.getUint32(stcoOffset, false);
            fileView.setUint32(stcoOffset, oldVal + delta, false);
            stcoOffset += 4;
          }
        } else if (['trak', 'mdia', 'minf', 'stbl'].includes(name)) {
          searchStco(curr + 8, curr + size);
        }

        curr += size;
      }
    }

    searchStco(offset, moovEnd);
  }
}

window.M4ATaggerEngine = M4ATaggerEngine;
