import base64
import json
import os
import sys
import tempfile
import traceback
from typing import Any, Dict, Optional

try:
    from faster_whisper import WhisperModel
except Exception as exc:  # pragma: no cover
    WhisperModel = None
    IMPORT_ERROR = str(exc)
else:
    IMPORT_ERROR = None


model = None
session_started = False
language = None


def normalize_ws(text: str) -> str:
    return " ".join((text or "").strip().split())


def is_hallucination_loop(text: str) -> bool:
    words = normalize_ws(text).lower().split(" ")
    words = [w for w in words if w]
    if len(words) < 10:
        return False

    # Very common loop pattern: same 1-2 words repeated too many times.
    unique = set(words)
    if len(unique) <= 2 and len(words) >= 10:
        return True

    # Repeated trigram pattern over the whole sentence.
    trigrams = [" ".join(words[i:i + 3]) for i in range(0, max(0, len(words) - 2))]
    if not trigrams:
        return False
    top = max(trigrams.count(t) for t in set(trigrams))
    return top >= max(4, len(trigrams) // 2)


def send(obj: Dict[str, Any]) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def event(name: str, payload: Optional[Dict[str, Any]] = None) -> None:
    send({"type": "event", "event": name, "payload": payload or {}})


def response(request_id: str, ok: bool, payload: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
    body: Dict[str, Any] = {"type": "response", "requestId": request_id, "ok": ok}
    if payload is not None:
        body["payload"] = payload
    if error:
        body["error"] = error
    send(body)


def ensure_model(payload: Dict[str, Any]) -> None:
    global model, language
    if model is not None:
        return
    if WhisperModel is None:
        raise RuntimeError(f"faster-whisper unavailable: {IMPORT_ERROR}")

    model_size = payload.get("model", "base")
    device = payload.get("device", "cpu")
    compute_type = payload.get("compute_type", "int8")
    language = payload.get("language") or None
    model = WhisperModel(model_size, device=device, compute_type=compute_type)


def transcribe_chunk(payload: Dict[str, Any]) -> Dict[str, Any]:
    global model, language
    if not session_started:
        raise RuntimeError("Session not started")
    if model is None:
        raise RuntimeError("Model is not loaded")

    speaker = payload.get("speaker", "unknown")
    audio_b64 = payload.get("audioBase64", "")
    mime_type = payload.get("mimeType", "audio/webm")
    use_vad = bool(payload.get("use_vad", False))

    if not audio_b64:
        return {"speaker": speaker, "text": "", "skipped": True}

    raw = base64.b64decode(audio_b64)
    suffix = ".webm" if "webm" in mime_type else ".wav"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        segments, info = model.transcribe(
            tmp_path,
            language=language,
            vad_filter=use_vad,
            beam_size=1,
            temperature=0.0,
            condition_on_previous_text=False,
            repetition_penalty=1.2,
            no_speech_threshold=0.65,
        )
        text = normalize_ws(" ".join((seg.text or "").strip() for seg in segments))
        if is_hallucination_loop(text):
            return {
                "speaker": speaker,
                "text": "",
                "skipped": True,
                "reason": "hallucination_loop",
            }
        return {
            "speaker": speaker,
            "text": text,
            "language": getattr(info, "language", None),
            "probability": getattr(info, "language_probability", None),
        }
    except Exception as exc:
        # Some MediaRecorder chunks can be malformed/incomplete (common with captureStream/webm).
        # Do not fail the whole session for a single bad chunk.
        msg = str(exc).lower()
        if "invalid data found when processing input" in msg or "no such file" in msg or "silero_vad_v6.onnx" in msg:
            return {
                "speaker": speaker,
                "text": "",
                "skipped": True,
                "error": str(exc),
            }
        raise
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def main() -> None:
    global session_started
    event("engine_ready", {"importError": IMPORT_ERROR})

    while True:
        try:
            line = input()
        except EOFError:
            break
        line = (line or "").strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except Exception:
            event("log", {"line": line})
            continue

        if msg.get("type") != "command":
            continue

        request_id = msg.get("requestId", "")
        command = msg.get("command", "")
        payload = msg.get("payload", {}) or {}

        try:
            if command == "start_session":
                ensure_model(payload)
                session_started = True
                event("session_started", {"started": True})
                response(request_id, True, {"started": True})
                continue

            if command == "stop_session":
                session_started = False
                event("session_stopped", {"stopped": True})
                response(request_id, True, {"stopped": True})
                continue

            if command == "transcribe_chunk":
                result = transcribe_chunk(payload)
                text = (result.get("text") or "").strip()
                if text:
                    event("transcript", result)
                response(request_id, True, {"accepted": True, "hasText": bool(text)})
                continue

            response(request_id, False, error=f"Unknown command: {command}")
        except Exception as exc:
            event("error", {"message": str(exc), "trace": traceback.format_exc()})
            response(request_id, False, error=str(exc))


if __name__ == "__main__":
    # Force UTF-8 over stdio to avoid mojibake on Windows when sending JSON to Electron.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
