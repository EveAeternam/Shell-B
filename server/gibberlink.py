"""Authenticated same-origin proxy for the HERMES Gibberlink API."""
import asyncio
import re

import httpx
import websockets
from fastapi import APIRouter, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

HERMES = "http://localhost:8001"
MAX_AUDIO_BYTES = 4 * 1024 * 1024

router = APIRouter(prefix="/api/gibberlink")


def _http_response(response: httpx.Response) -> Response:
    return Response(response.content, status_code=response.status_code,
                    media_type=response.headers.get("content-type", "application/json"))


async def _get(path: str) -> Response:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{HERMES}{path}")
    except httpx.RequestError as exc:
        raise HTTPException(502, "HERMES is unavailable") from exc
    return _http_response(response)


@router.get("/health")
async def health():
    return await _get("/health")


@router.get("/agents")
async def agents():
    return await _get("/gibberlink/agents")


@router.post("/encode")
async def encode(request: Request):
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{HERMES}/gibberlink/encode",
                content=await request.body(),
                headers={"content-type": request.headers.get("content-type", "application/json")},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, "HERMES is unavailable") from exc
    return _http_response(response)


@router.post("/decode")
async def decode(file: UploadFile = File(...)):
    audio = await file.read(MAX_AUDIO_BYTES + 1)
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio file exceeds the 4 MiB limit")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{HERMES}/gibberlink/decode",
                files={"file": (file.filename or "message.wav", audio, file.content_type or "audio/wav")},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, "HERMES is unavailable") from exc
    return _http_response(response)


@router.websocket("/ws/{agent_id}")
async def relay(websocket: WebSocket, agent_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", agent_id):
        await websocket.close(code=1008, reason="Invalid agent ID")
        return

    await websocket.accept()
    upstream_url = f"{HERMES.replace('http://', 'ws://', 1)}/gibberlink/ws/{agent_id}"
    try:
        async with websockets.connect(upstream_url, max_size=MAX_AUDIO_BYTES) as upstream:
            async def browser_to_hermes():
                try:
                    while True:
                        message = await websocket.receive()
                        if message["type"] == "websocket.disconnect":
                            return
                        audio = message.get("bytes")
                        if audio is None:
                            await websocket.close(code=1003, reason="Binary WAV messages required")
                            return
                        if len(audio) > MAX_AUDIO_BYTES:
                            await websocket.close(code=1009, reason="Audio message exceeds 4 MiB")
                            return
                        await upstream.send(audio)
                except WebSocketDisconnect:
                    return

            async def hermes_to_browser():
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)

            client_task = asyncio.create_task(browser_to_hermes())
            service_task = asyncio.create_task(hermes_to_browser())
            done, pending = await asyncio.wait(
                (client_task, service_task), return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            if service_task in done:
                try:
                    await websocket.close(code=1013, reason="HERMES relay disconnected")
                except RuntimeError:
                    pass
    except (OSError, websockets.exceptions.WebSocketException):
        try:
            await websocket.close(code=1013, reason="HERMES is unavailable")
        except RuntimeError:
            pass