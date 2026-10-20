"""Kino TTS server: a tiny HTTP wrapper around a text-to-speech model.

    npm run tts                       # or: tts/.venv/bin/python tts/server.py
    tts/.venv/bin/python tts/server.py --port 8808 --model KittenML/kitten-tts-2

Default engine: Kitten TTS 2 (KittenML/kitten-tts-2), on the GPU when torch sees one (CUDA or ROCm), else CPU.
Models whose id starts with "Qwen/" use Qwen3-TTS instead (pip install qwen-tts).

Endpoints
    GET  /health      -> {"ready", "device", "models", "voices"}
    POST /synthesize  {"text", "model", "speaker", "language", "instruct", "preset", "reference", "referenceText"}
                      -> audio/wav (PCM16)

Kino (CLI and studio) caches the results in .kino-cache/tts, so each line is
only synthesized once.
"""

import argparse
import io
import json
import sys
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_MODEL = "KittenML/kitten-tts-2"

# Kitten TTS 2 emotion tags; an `instruct` naming one of these becomes a leading [tag]
KITTEN_EMOTIONS = {"angry", "contemplative", "excited", "joyful", "mundane", "nervous", "sad", "stern", "surprised", "tender"}


def log(*args):
    print(time.strftime("[%H:%M:%S]"), *args, file=sys.stderr, flush=True)


def match(names, value: str) -> str | None:
    """Case-insensitive lookup in a model's list of names."""
    return next((n for n in names if n.lower() == value.lower()), None)


class KittenEngine:
    def __init__(self, name: str, device: str):
        from kittenml import KittenTTS

        self.model = KittenTTS(name, device=device)
        self.voices = list(getattr(self.model, "available_voices", []))
        self.sample_rate = self.model.sample_rate

    def synthesize(self, text: str, req: dict):
        speaker = str(req.get("speaker") or "")
        language = str(req.get("language") or "Auto")
        english = language.lower() in ("auto", "english", "en", "")
        kwargs: dict = {}
        if req.get("reference"):
            # voice cloning from a 5-30s recording of one speaker
            kwargs["reference"] = str(req["reference"])
            if req.get("referenceText"):
                kwargs["reference_text"] = str(req["referenceText"])
        else:
            voice = match(self.voices, speaker) if speaker else None
            # other languages are spoken by their language voice ("German", "Spanish"...)
            if not english:
                voice = match(self.voices, language) or voice
            if voice:
                kwargs["voice"] = voice
            elif speaker:
                raise ValueError(f"unknown voice {speaker!r}; available: {', '.join(self.voices)}")
        if not english:
            kwargs["normalize"] = False  # the text normalizer is English-only
        instruct = str(req.get("instruct") or "").strip().lower()
        if instruct in KITTEN_EMOTIONS and not text.lstrip().startswith("["):
            text = f"[{instruct}] {text}"
        if req.get("preset"):
            kwargs["preset"] = str(req["preset"])
        # same text + voice -> same audio
        kwargs["advanced"] = {"seed": zlib.crc32(text.encode())}
        wav = self.model.generate(text, **kwargs)
        return wav, self.sample_rate


class QwenEngine:
    def __init__(self, name: str, device: str):
        import torch
        from qwen_tts import Qwen3TTSModel

        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        self.model = Qwen3TTSModel.from_pretrained(name, device_map=device, dtype=dtype, attn_implementation="sdpa")
        self.voices = list(self.model.get_supported_speakers())
        self.languages = list(self.model.get_supported_languages())

    def synthesize(self, text: str, req: dict):
        kwargs = dict(
            text=text,
            language=match(self.languages, str(req.get("language") or "Auto")) or "Auto",
            speaker=match(self.voices, str(req.get("speaker") or "Ryan")) or str(req.get("speaker")),
        )
        if req.get("instruct"):
            kwargs["instruct"] = str(req["instruct"])
        wavs, sr = self.model.generate_custom_voice(**kwargs)
        return wavs[0], sr


class Server:
    """Loads models lazily (one per id) and serializes generation."""

    def __init__(self, device: str, default_model: str):
        self.device = device
        self.default_model = default_model
        self.engines: dict = {}
        self.lock = threading.Lock()
        self.ready = threading.Event()

    def engine(self, name: str):
        if name not in self.engines:
            log(f"loading {name} on {self.device} ...")
            t0 = time.time()
            cls = QwenEngine if name.startswith("Qwen/") else KittenEngine
            self.engines[name] = cls(name, self.device)
            log(f"loaded {name} in {time.time() - t0:.1f}s")
        return self.engines[name]

    def warmup(self):
        try:
            with self.lock:
                self.engine(self.default_model)
        except Exception as e:  # keep serving /health so clients see the problem
            log("failed to load default model:", repr(e))
        self.ready.set()

    def synthesize(self, req: dict) -> bytes:
        import soundfile as sf

        text = str(req.get("text", "")).strip()
        if not text:
            raise ValueError("empty text")
        self.ready.wait()
        with self.lock:
            eng = self.engine(str(req.get("model") or self.default_model))
            t0 = time.time()
            wav, sr = eng.synthesize(text, req)
            log(f"{req.get('speaker') or 'default'}: {len(wav) / sr:.1f}s of audio in {time.time() - t0:.1f}s  {text[:60]!r}")
        buf = io.BytesIO()
        sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    def info(self) -> dict:
        eng = self.engines.get(self.default_model)
        return {
            "ready": self.ready.is_set() and eng is not None,
            "device": self.device,
            "default_model": self.default_model,
            "models": list(self.engines),
            "voices": eng.voices if eng else [],
        }


def make_handler(server: Server):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, code: int, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                return self._json(200, server.info())
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/synthesize":
                return self._json(404, {"error": "not found"})
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                wav = server.synthesize(req)
            except Exception as e:  # report model errors (bad voice, missing package...) to the client
                log("error:", repr(e))
                return self._json(500, {"error": str(e)})
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)

        def log_message(self, *args):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8808)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--device", default="auto", help="auto (default: GPU if available), cpu, cuda, cuda:0, mps")
    args = ap.parse_args()
    if args.device == "auto":
        import torch

        # ROCm builds of torch also report their GPU through torch.cuda
        args.device = "cuda:0" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")

    server = Server(args.device, args.model)
    threading.Thread(target=server.warmup, daemon=True).start()
    http = ThreadingHTTPServer((args.host, args.port), make_handler(server))
    log(f"kino tts listening on http://{args.host}:{args.port} (model {args.model}, device {args.device})")
    http.serve_forever()


if __name__ == "__main__":
    main()
