"""Speech & Voice routing: STT, TTS, Lexicon, and Qwen voice design via HERMES."""
from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile
import httpx

router = APIRouter(prefix="/api")

HERMES = "http://localhost:8001"


@router.post("/stt")
async def stt(file: UploadFile = File(...)):
    data = await file.read()
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(f"{HERMES}/stt", files={"file": (file.filename or "speech.webm", data, file.content_type)})
    if r.status_code != 200:
        raise HTTPException(502, f"HERMES: {r.text[:300]}")
    return r.json()


@router.post("/tts")
async def tts(req: Request):
    from roster import get_settings
    body = await req.json()
    text = str(body.get("text", ""))[:4000]  # HERMES strips the Markdown; read-aloud sends a few sentences at a time
    s = get_settings()
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(f"{HERMES}/tts", json={"text": text, "voice": body.get("voice") or s["ttsVoice"],
                                                "speed": body.get("speed") or s.get("ttsSpeed") or 1.0, "format": "mp3",
                                                "style": body.get("style") or s.get("ttsStyle") or "",
                                                "fx": body.get("fx"), "voice_style": body.get("voiceStyle")})
    if r.status_code != 200:
        raise HTTPException(502, f"HERMES: {r.text[:300]}")
    return Response(r.content, media_type=r.headers.get("content-type", "audio/mpeg"))


@router.api_route("/tts/lexicon", methods=["GET", "PUT"])
@router.post("/tts/lexicon/apply")
async def tts_lexicon(req: Request):
    """Speech settings → Pronunciation: HERMES's word → spoken-form list (Shell:B → Shelby is built in)."""
    path = "/tts/lexicon/apply" if req.url.path.endswith("/apply") else "/tts/lexicon"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(req.method, f"{HERMES}{path}", content=await req.body(),
                            headers={"content-type": "application/json"})
    return Response(r.content, status_code=r.status_code, media_type="application/json")


@router.api_route("/tts/qwen/{path:path}", methods=["GET", "POST", "PATCH", "DELETE"])
async def tts_qwen(path: str, req: Request):
    """Speech settings → voice library (design, samples, fx, edit, delete): passed through HERMES to the Qwen3-TTS service."""
    headers = {k: v for k, v in req.headers.items() if k.lower() == "content-type"}
    async with httpx.AsyncClient(timeout=600) as c:
        r = await c.request(req.method, f"{HERMES}/tts/qwen/{path}", params=req.query_params, content=await req.body(),
                            headers=headers)
    keep = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "x-draft-id")}
    return Response(r.content, status_code=r.status_code, headers=keep)


@router.get("/tts/voices")
async def voices():
    async with httpx.AsyncClient(timeout=10) as c:
        return (await c.get(f"{HERMES}/tts/voices")).json()
