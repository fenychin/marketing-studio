"""ASR sidecar: word-level speech recognition for the Marketing Studio.

A deliberately small, dependency-light HTTP service wrapping faster-whisper.
Contract (consumed by apps/api/src/agents/dna.ts via STUDIO_ASR_URL):

    POST /v1/asr          multipart/form-data, field "file" (audio/video)
                          → {"segments": [{"text", "start", "end",
                                           "words": [{"text", "start", "end"}]}]}
    GET  /health          → {"ok": true, "model": "...", "ready": bool}

Everything here is original code; faster-whisper is used as a pip library.
"""

import io
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("ASR_PORT", "8792"))
MODEL_SIZE = os.environ.get("ASR_MODEL", "base")
# Model weights come from Hugging Face; users behind regional network limits
# can point the client at a mirror via HF_ENDPOINT (see start-asr.sh).

_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel

                print(f"[asr] loading faster-whisper model '{MODEL_SIZE}' …", flush=True)
                _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
                print("[asr] model ready", flush=True)
    return _model


def parse_multipart_file(body: bytes, content_type: str) -> bytes | None:
    """Extract the first file part from a multipart/form-data body."""
    match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not match:
        return None
    boundary = ("--" + match.group(1)).encode()
    for part in body.split(boundary):
        chunk = part.strip(b"\r\n")
        if not chunk or chunk == b"--":
            continue
        header_end = chunk.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        headers = chunk[:header_end].decode("utf-8", "ignore").lower()
        payload = chunk[header_end + 4:]
        if 'name="file"' in headers or "filename=" in headers:
            return payload
    return None


def transcribe(audio: bytes) -> dict:
    model = get_model()
    # faster-whisper decodes bytes via PyAV — no temp files, no ffmpeg binary.
    segments, info = model.transcribe(io.BytesIO(audio), word_timestamps=True)
    out = []
    for seg in segments:
        words = [
            {"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
            for w in (seg.words or [])
            if w.word and w.word.strip()
        ]
        out.append(
            {
                "text": seg.text.strip(),
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "words": words,
            }
        )
    return {"segments": out, "language": info.language, "duration": round(info.duration, 3)}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True, "model": MODEL_SIZE, "ready": _model is not None})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/asr":
            self._json(404, {"error": "not_found"})
            return
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            self._json(400, {"error": "empty_body"})
            return
        body = self.rfile.read(length)
        audio = parse_multipart_file(body, self.headers.get("content-type", ""))
        if audio is None:
            audio = body  # also accept a raw audio body
        try:
            self._json(200, transcribe(audio))
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def log_message(self, fmt: str, *args) -> None:  # quieter logs
        print(f"[asr] {self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    print(f"[asr] listening on http://127.0.0.1:{PORT} (model={MODEL_SIZE})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
