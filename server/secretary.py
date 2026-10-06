"""Shell:B Secretary Mode — live meeting listening, speaker identification, and executive summaries.

Captures spoken conversations in real time (or from uploaded audio recordings), identifies distinct speakers
via acoustic pitch and timbre profiling, produces diarized transcripts, and compiles structured executive
summaries with key decisions, action items, and discussion points via ShellB-Swift.
Summaries can be saved directly to the Codex reference shelf and action items exported to project todos.
"""
import asyncio
import io
import json
import logging
import math
import re
import time
import uuid
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
import soundfile as sf
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

import db
import codex

router = APIRouter(prefix="/api/secretary")
log = logging.getLogger("shellb.secretary")

HERMES = "http://localhost:8001"
OLLAMA = "http://localhost:11434"
SPEAKER_DIST_THRESHOLD = 1.25
SENSITIVITY_THRESHOLDS = {
    "strict": 0.95,
    "high": 0.95,
    "balanced": 1.25,
    "normal": 1.25,
    "relaxed": 1.65,
    "low": 1.65,
}

SPEAKER_PALETTE = [
    "#38bdf8",  # Sky
    "#fb7185",  # Rose
    "#34d399",  # Emerald
    "#f59e0b",  # Amber
    "#a78bfa",  # Violet
    "#f472b6",  # Pink
    "#2dd4bf",  # Teal
    "#fbbf24",  # Yellow
    "#818cf8",  # Indigo
    "#4ade80",  # Green
]

# meeting_id -> { speaker_id -> list of feature vectors }
_SPEAKER_VECTORS: dict[str, dict[str, list[np.ndarray]]] = {}


def init():
    with db.conn() as c:
        c.executescript("""
CREATE TABLE IF NOT EXISTS meetings(
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT DEFAULT 'idle',
  created REAL,
  updated REAL,
  duration REAL DEFAULT 0.0,
  speakers TEXT DEFAULT '[]',
  utterances TEXT DEFAULT '[]',
  summary TEXT DEFAULT '',
  summary_data TEXT DEFAULT '{}',
  codex_entry_id TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_created ON meetings(created);
""")


def _extract_voice_features(audio: np.ndarray, sr: int = 16000) -> tuple[np.ndarray, float]:
    """Extracts a 17-dimensional acoustic feature vector and median pitch (F0).
    
    Uses pure NumPy:
    - Pitch (F0) estimation via Normalized Autocorrelation (NACF) on voiced frames (60-400Hz)
    - Spectral Centroid & Spectral Rolloff (85% energy point)
    - 20-band Mel-filterbank energies + Discrete Cosine Transform (DCT-II) -> 13 MFCCs
    """
    if len(audio) < sr * 0.2:
        return np.zeros(17, dtype=np.float32), 150.0

    # Ensure mono float32
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float32)

    # 1. Pitch estimation using normalized autocorrelation (NACF)
    min_lag = int(sr / 400)
    max_lag = int(sr / 60)
    frame_len = int(sr * 0.04)  # 40ms
    hop_len = int(sr * 0.02)    # 20ms
    pitches = []

    for i in range(0, len(audio) - frame_len, hop_len * 2):
        frame = audio[i:i + frame_len]
        w_frame = frame * np.hamming(len(frame))
        corr = np.correlate(w_frame, w_frame, mode="full")
        corr = corr[len(w_frame) - 1:]
        if corr[0] <= 1e-6:
            continue
        corr_norm = corr / corr[0]
        peak_idx = min_lag + int(np.argmax(corr_norm[min_lag:max_lag]))
        peak_val = corr_norm[peak_idx]
        if peak_val > 0.35:
            pitches.append(sr / peak_idx)

    if pitches:
        f0_med = float(np.median(pitches))
        f0_std = float(np.std(pitches))
    else:
        f0_med, f0_std = 150.0, 30.0

    # 2. Spectral features via FFT
    n_fft = 512
    window = np.hanning(n_fft)
    specs = []
    hop = int(sr * 0.015)
    for i in range(0, len(audio) - n_fft, hop):
        frame = audio[i:i + n_fft] * window
        mag = np.abs(np.fft.rfft(frame))
        specs.append(mag)

    if not specs:
        return np.zeros(17, dtype=np.float32), f0_med

    avg_spec = np.mean(specs, axis=0) + 1e-8
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sr)

    sc = float(np.sum(freqs * avg_spec) / np.sum(avg_spec))
    cum_energy = np.cumsum(avg_spec)
    rolloff_idx = np.searchsorted(cum_energy, 0.85 * cum_energy[-1])
    s_roll = float(freqs[min(rolloff_idx, len(freqs) - 1)])

    # 3. Mel Filterbank (20 bands) + DCT-II -> 13 MFCCs
    def hz_to_mel(hz):
        return 2595.0 * np.log10(1.0 + hz / 700.0)

    def mel_to_hz(mel):
        return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

    mel_min = hz_to_mel(100.0)
    mel_max = hz_to_mel(sr / 2.0)
    mel_points = np.linspace(mel_min, mel_max, 22)
    hz_points = mel_to_hz(mel_points)
    bin_points = np.floor((n_fft + 1) * hz_points / sr).astype(int)

    fbank = np.zeros((20, n_fft // 2 + 1))
    for m in range(1, 21):
        f_m_minus = bin_points[m - 1]
        f_m = bin_points[m]
        f_m_plus = bin_points[m + 1]
        for k in range(f_m_minus, f_m):
            if f_m != f_m_minus:
                fbank[m - 1, k] = (k - f_m_minus) / (f_m - f_m_minus)
        for k in range(f_m, f_m_plus):
            if f_m_plus != f_m:
                fbank[m - 1, k] = (f_m_plus - k) / (f_m_plus - f_m)

    mel_energies = np.dot(fbank, avg_spec)
    log_mel = np.log(mel_energies + 1e-8)

    n_ceps = 13
    mfcc = np.zeros(n_ceps)
    for k in range(n_ceps):
        mfcc[k] = np.sum(log_mel * np.cos(np.pi * k * (np.arange(20) + 0.5) / 20.0))

    f0_norm = f0_med / 100.0
    f0_std_norm = f0_std / 50.0
    sc_norm = sc / 1000.0
    roll_norm = s_roll / 2000.0
    mfcc_norm = mfcc / 10.0

    vec = np.hstack([f0_norm * 2.5, f0_std_norm, sc_norm, roll_norm, mfcc_norm]).astype(np.float32)
    return vec, f0_med


def _speaker_distance(v1: np.ndarray, v2: np.ndarray) -> float:
    return float(np.linalg.norm(v1 - v2))


def _cluster_vectors_agglomerative(vectors: list[np.ndarray], threshold: float = 1.25) -> list[list[int]]:
    """Hierarchical agglomerative clustering using average linkage."""
    if not vectors:
        return []
    clusters = [[i] for i in range(len(vectors))]
    while len(clusters) > 1:
        best_d = float("inf")
        best_pair = (-1, -1)
        for i in range(len(clusters)):
            c_i = np.mean([vectors[idx] for idx in clusters[i]], axis=0)
            for j in range(i + 1, len(clusters)):
                c_j = np.mean([vectors[idx] for idx in clusters[j]], axis=0)
                d = float(np.linalg.norm(c_i - c_j))
                if d < best_d:
                    best_d = d
                    best_pair = (i, j)
        if best_d > threshold:
            break
        i, j = best_pair
        clusters[i].extend(clusters[j])
        clusters.pop(j)
    return clusters


def _cluster_vectors_fixed_k(vectors: list[np.ndarray], k: int) -> list[list[int]]:
    """Agglomerative clustering merging down to exactly k clusters."""
    if not vectors:
        return []
    k = max(1, min(k, len(vectors)))
    clusters = [[i] for i in range(len(vectors))]
    while len(clusters) > k:
        best_d = float("inf")
        best_pair = (-1, -1)
        for i in range(len(clusters)):
            c_i = np.mean([vectors[idx] for idx in clusters[i]], axis=0)
            for j in range(i + 1, len(clusters)):
                c_j = np.mean([vectors[idx] for idx in clusters[j]], axis=0)
                d = float(np.linalg.norm(c_i - c_j))
                if d < best_d:
                    best_d = d
                    best_pair = (i, j)
        i, j = best_pair
        clusters[i].extend(clusters[j])
        clusters.pop(j)
    return clusters


def _ensure_meeting_vectors(mid: str, m: dict) -> dict[str, list[np.ndarray]]:
    """Reconstructs in-memory speaker vectors from saved utterances if server was restarted."""
    if mid not in _SPEAKER_VECTORS or not _SPEAKER_VECTORS[mid]:
        _SPEAKER_VECTORS[mid] = {}
        for u in m.get("utterances", []):
            sid = u.get("speakerId")
            v = u.get("voiceVector")
            if sid and v:
                _SPEAKER_VECTORS[mid].setdefault(sid, []).append(np.array(v, dtype=np.float32))
    return _SPEAKER_VECTORS[mid]


def _load_meeting(mid: str) -> Optional[dict]:
    with db.conn() as c:
        row = c.execute("SELECT * FROM meetings WHERE id=?", (mid,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["speakers"] = json.loads(d["speakers"] or "[]")
        d["utterances"] = json.loads(d["utterances"] or "[]")
        d["summaryData"] = json.loads(d["summary_data"] or "{}")
        d["codexEntryId"] = d.pop("codex_entry_id", None)
        d.pop("summary_data", None)
        return d


def _save_meeting(m: dict):
    with db.conn() as c:
        c.execute("""
UPDATE meetings SET
  title=?, status=?, updated=?, duration=?,
  speakers=?, utterances=?, summary=?, summary_data=?, codex_entry_id=?
WHERE id=?
""", (
            m.get("title") or "Untitled Meeting",
            m.get("status") or "idle",
            time.time(),
            float(m.get("duration") or 0.0),
            json.dumps(m.get("speakers") or []),
            json.dumps(m.get("utterances") or []),
            m.get("summary") or "",
            json.dumps(m.get("summaryData") or {}),
            m.get("codexEntryId"),
            m["id"],
        ))


@router.get("/meetings")
async def list_meetings():
    """Returns summary list of all recorded meetings."""
    with db.conn() as c:
        rows = c.execute("SELECT id, title, status, created, updated, duration, speakers, utterances, summary, codex_entry_id FROM meetings ORDER BY created DESC").fetchall()
    out = []
    for r in rows:
        speakers = json.loads(r["speakers"] or "[]")
        utterances = json.loads(r["utterances"] or "[]")
        out.append({
            "id": r["id"],
            "title": r["title"] or "Untitled Meeting",
            "status": r["status"] or "idle",
            "created": r["created"],
            "updated": r["updated"],
            "duration": r["duration"] or 0.0,
            "speakerCount": len(speakers),
            "utteranceCount": len(utterances),
            "hasSummary": bool(r["summary"]),
            "codexEntryId": r["codex_entry_id"],
        })
    return out


@router.post("/meetings")
async def create_meeting(req: Request):
    """Creates a new meeting session."""
    body = await req.json() if req.headers.get("content-type", "").startswith("application/json") else {}
    mid = db.new_id("mtg")
    now = time.time()
    title = str(body.get("title") or "").strip() or f"Meeting on {time.strftime('%b %d, %Y %H:%M')}"
    initial_speakers = body.get("speakers") or []

    with db.conn() as c:
        c.execute("""
INSERT INTO meetings(id, title, status, created, updated, duration, speakers, utterances, summary, summary_data)
VALUES(?,?,?,?,?,?,?,?,?,?)
""", (mid, title, "idle", now, now, 0.0, json.dumps(initial_speakers), "[]", "", "{}"))

    _SPEAKER_VECTORS[mid] = {}
    return _load_meeting(mid)


@router.get("/meetings/{mid}")
async def get_meeting(mid: str):
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")
    return m


@router.patch("/meetings/{mid}")
async def patch_meeting(mid: str, req: Request):
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")
    patch = await req.json()

    if "title" in patch:
        m["title"] = str(patch["title"]).strip() or m["title"]
    if "status" in patch:
        m["status"] = patch["status"]
    if "duration" in patch:
        m["duration"] = float(patch["duration"])
    if "speakers" in patch:
        m["speakers"] = patch["speakers"]
    if "utterances" in patch:
        m["utterances"] = patch["utterances"]
    if "summary" in patch:
        m["summary"] = patch["summary"]
    if "summaryData" in patch:
        m["summaryData"] = patch["summaryData"]

    _save_meeting(m)
    return m


@router.delete("/meetings/{mid}")
async def delete_meeting(mid: str):
    with db.conn() as c:
        c.execute("DELETE FROM meetings WHERE id=?", (mid,))
    _SPEAKER_VECTORS.pop(mid, None)
    return {"deleted": True, "id": mid}


@router.post("/meetings/{mid}/utterance")
async def process_utterance(
    mid: str,
    file: UploadFile = File(...),
    start: float = Form(default=0.0),
    end: float = Form(default=0.0),
    speaker_hint: Optional[str] = Form(default=None),
    sensitivity: Optional[str] = Form(default="balanced"),
):
    """Transcribes an audio chunk, extracts speaker features, diarizes the speaker, and appends the utterance."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    audio_bytes = await file.read()
    if len(audio_bytes) < 400:
        return {"ignored": True, "reason": "audio too short"}

    # 1. Transcribe via Hermes Whisper
    filename = file.filename or "utterance.wav"
    ext = "." + filename.rsplit(".", 1)[-1]
    async with httpx.AsyncClient(timeout=60) as c:
        try:
            r = await c.post(
                f"{HERMES}/stt",
                files={"file": (filename, audio_bytes, file.content_type or "audio/wav")},
            )
            r.raise_for_status()
            stt_data = r.json()
        except Exception as e:
            log.warning("Hermes STT failed for utterance: %s", e)
            raise HTTPException(502, f"HERMES STT error: {e}")

    text = (stt_data.get("text") or "").strip()
    # Filter out empty or noise hallucination
    if not text or re.match(r"^[\W_]*$", text):
        return {"ignored": True, "reason": "no speech detected"}

    clip_duration = float(stt_data.get("duration") or 0.0)
    actual_start = start
    actual_end = end if end > start else start + clip_duration

    # 2. Extract acoustic vector
    vec: Optional[np.ndarray] = None
    pitch_est = 150.0
    try:
        data, sr = sf.read(io.BytesIO(audio_bytes))
        vec, pitch_est = _extract_voice_features(data, sr)
    except Exception as e:
        log.info("Could not extract acoustic features directly via soundfile: %s", e)

    # 3. Speaker assignment & diarization
    vectors_map = _ensure_meeting_vectors(mid, m)
    active_threshold = SENSITIVITY_THRESHOLDS.get(sensitivity or "balanced", SPEAKER_DIST_THRESHOLD)

    assigned_speaker = None
    speakers: list[dict] = m.get("speakers", [])

    if speaker_hint:
        # User explicitly designated a speaker
        for spk in speakers:
            if spk["id"] == speaker_hint or spk["name"].lower() == speaker_hint.lower():
                assigned_speaker = spk
                break

    if not assigned_speaker and vec is not None:
        # Match against existing speaker centroids
        best_spk = None
        min_dist = float("inf")

        for spk in speakers:
            spk_id = spk["id"]
            vectors = vectors_map.get(spk_id, [])
            if vectors:
                centroid = np.mean(vectors, axis=0)
                d = _speaker_distance(vec, centroid)
                if d < min_dist:
                    min_dist = d
                    best_spk = spk

        if best_spk and min_dist <= active_threshold:
            assigned_speaker = best_spk
        else:
            # Create a new speaker
            spk_idx = len(speakers) + 1
            color = SPEAKER_PALETTE[(spk_idx - 1) % len(SPEAKER_PALETTE)]
            assigned_speaker = {
                "id": f"spk_{spk_idx}",
                "name": f"Speaker {spk_idx}",
                "color": color,
                "pitch": round(pitch_est, 1),
                "utteranceCount": 0,
                "totalDuration": 0.0,
            }
            speakers.append(assigned_speaker)

    if not assigned_speaker:
        if speakers:
            assigned_speaker = speakers[0]
        else:
            assigned_speaker = {
                "id": "spk_1",
                "name": "Speaker 1",
                "color": SPEAKER_PALETTE[0],
                "pitch": round(pitch_est, 1),
                "utteranceCount": 0,
                "totalDuration": 0.0,
            }
            speakers.append(assigned_speaker)

    # Update speaker profile
    assigned_speaker["utteranceCount"] = (assigned_speaker.get("utteranceCount") or 0) + 1
    assigned_speaker["totalDuration"] = round((assigned_speaker.get("totalDuration") or 0.0) + clip_duration, 1)
    if pitch_est > 60:
        assigned_speaker["pitch"] = round(pitch_est, 1)

    if vec is not None:
        vectors_map.setdefault(assigned_speaker["id"], []).append(vec)

    # 4. Create and store utterance
    utt = {
        "id": db.new_id("utt"),
        "speakerId": assigned_speaker["id"],
        "speakerName": assigned_speaker["name"],
        "start": round(actual_start, 2),
        "end": round(actual_end, 2),
        "text": text,
        "confidence": 0.95,
        "pitch": round(pitch_est, 1) if pitch_est > 0 else None,
        "voiceVector": vec.tolist() if vec is not None else None,
    }

    m["utterances"].append(utt)
    m["speakers"] = speakers
    m["duration"] = max(float(m.get("duration") or 0.0), actual_end)
    m["status"] = "recording"
    _save_meeting(m)

    return {
        "utterance": utt,
        "speakers": speakers,
        "duration": m["duration"],
    }



@router.post("/meetings/{mid}/upload-audio")
async def upload_meeting_audio(mid: str, file: UploadFile = File(...)):
    """Processes an entire recorded meeting file, transcribing and diarizing it into turns."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    m["status"] = "processing"
    _save_meeting(m)

    audio_bytes = await file.read()
    filename = file.filename or "meeting.wav"

    # Transcribe via Hermes Whisper
    async with httpx.AsyncClient(timeout=300) as c:
        r = await c.post(
            f"{HERMES}/stt",
            files={"file": (filename, audio_bytes, file.content_type or "audio/wav")},
        )
        if r.status_code != 200:
            m["status"] = "idle"
            _save_meeting(m)
            raise HTTPException(502, f"STT failed: {r.text[:200]}")
        stt_result = r.json()

    segments = stt_result.get("segments") or []
    if not segments:
        m["status"] = "idle"
        _save_meeting(m)
        return m

    # Read audio into numpy to slice segments
    audio_data = None
    sr = 16000
    try:
        audio_data, sr = sf.read(io.BytesIO(audio_bytes))
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
    except Exception as e:
        log.info("Direct soundfile read failed, diarizing with duration heuristic: %s", e)

    speakers: list[dict] = []
    utterances: list[dict] = []
    vectors_by_speaker: dict[str, list[np.ndarray]] = {}

    for seg in segments:
        s_start = float(seg["start"])
        s_end = float(seg["end"])
        s_text = seg["text"].strip()
        if not s_text:
            continue

        vec = None
        pitch = 150.0
        if audio_data is not None:
            idx_start = max(0, int(s_start * sr))
            idx_end = min(len(audio_data), int(s_end * sr))
            if idx_end - idx_start > sr * 0.2:
                slice_audio = audio_data[idx_start:idx_end]
                vec, pitch = _extract_voice_features(slice_audio, sr)

        # Match or create speaker
        assigned_spk = None
        if vec is not None and speakers:
            best_spk = None
            min_dist = float("inf")
            for spk in speakers:
                vs = vectors_by_speaker.get(spk["id"], [])
                if vs:
                    centroid = np.mean(vs, axis=0)
                    d = _speaker_distance(vec, centroid)
                    if d < min_dist:
                        min_dist = d
                        best_spk = spk
            if best_spk and min_dist <= SPEAKER_DIST_THRESHOLD:
                assigned_spk = best_spk

        if not assigned_spk:
            spk_idx = len(speakers) + 1
            color = SPEAKER_PALETTE[(spk_idx - 1) % len(SPEAKER_PALETTE)]
            assigned_spk = {
                "id": f"spk_{spk_idx}",
                "name": f"Speaker {spk_idx}",
                "color": color,
                "pitch": round(pitch, 1),
                "utteranceCount": 0,
                "totalDuration": 0.0,
            }
            speakers.append(assigned_spk)

        assigned_spk["utteranceCount"] += 1
        assigned_spk["totalDuration"] = round(assigned_spk["totalDuration"] + (s_end - s_start), 1)
        if vec is not None:
            vectors_by_speaker.setdefault(assigned_spk["id"], []).append(vec)

        utterances.append({
            "id": db.new_id("utt"),
            "speakerId": assigned_spk["id"],
            "speakerName": assigned_spk["name"],
            "start": round(s_start, 2),
            "end": round(s_end, 2),
            "text": s_text,
            "confidence": 0.95,
            "pitch": round(pitch, 1) if pitch > 0 else None,
            "voiceVector": vec.tolist() if vec is not None else None,
        })

    total_dur = float(stt_result.get("duration") or (utterances[-1]["end"] if utterances else 0.0))
    m["speakers"] = speakers
    m["utterances"] = utterances
    m["duration"] = round(total_dur, 2)
    m["status"] = "completed"
    _SPEAKER_VECTORS[mid] = vectors_by_speaker
    _save_meeting(m)

    return m


@router.post("/meetings/{mid}/rediarize")
async def rediarize_meeting(mid: str, req: Request):
    """Re-clusters and separates speakers across all utterances using voice profiles."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    body = await req.json() if req.headers.get("content-type", "").startswith("application/json") else {}
    num_speakers = body.get("numSpeakers")
    sensitivity = body.get("sensitivity") or "balanced"
    threshold = SENSITIVITY_THRESHOLDS.get(sensitivity, SPEAKER_DIST_THRESHOLD)

    utterances = m.get("utterances", [])
    if not utterances:
        return m

    # Filter utterances that have voice vectors
    indices_with_vectors = []
    vectors = []
    for idx, u in enumerate(utterances):
        v = u.get("voiceVector")
        if v:
            indices_with_vectors.append(idx)
            vectors.append(np.array(v, dtype=np.float32))

    if not vectors:
        raise HTTPException(400, "No acoustic voice vectors found in this meeting's utterances to re-cluster.")

    if num_speakers and int(num_speakers) >= 1:
        clusters = _cluster_vectors_fixed_k(vectors, int(num_speakers))
    else:
        clusters = _cluster_vectors_agglomerative(vectors, threshold=threshold)

    # Sort clusters by order of appearance of first utterance
    clusters.sort(key=lambda c: min(c))

    # Build new speakers list
    new_speakers = []
    new_vectors_by_spk = {}

    for cluster_idx, member_indices in enumerate(clusters):
        spk_id = f"spk_{cluster_idx + 1}"
        color = SPEAKER_PALETTE[cluster_idx % len(SPEAKER_PALETTE)]

        # Compute average pitch and total duration for this cluster
        cluster_pitches = []
        cluster_dur = 0.0
        for m_idx in member_indices:
            orig_u_idx = indices_with_vectors[m_idx]
            u = utterances[orig_u_idx]
            if u.get("pitch"):
                cluster_pitches.append(u["pitch"])
            dur = max(0.0, float(u.get("end", 0)) - float(u.get("start", 0)))
            cluster_dur += dur

        avg_pitch = round(float(np.mean(cluster_pitches)), 1) if cluster_pitches else 150.0

        spk_obj = {
            "id": spk_id,
            "name": f"Speaker {cluster_idx + 1}",
            "color": color,
            "pitch": avg_pitch,
            "utteranceCount": len(member_indices),
            "totalDuration": round(cluster_dur, 1),
        }
        new_speakers.append(spk_obj)

        cluster_vecs = [vectors[m_idx] for m_idx in member_indices]
        new_vectors_by_spk[spk_id] = cluster_vecs

        # Update utterances
        for m_idx in member_indices:
            orig_u_idx = indices_with_vectors[m_idx]
            utterances[orig_u_idx]["speakerId"] = spk_id
            utterances[orig_u_idx]["speakerName"] = spk_obj["name"]

    # For utterances without vectors (if any), assign to nearest or first speaker
    for idx, u in enumerate(utterances):
        if idx not in indices_with_vectors and new_speakers:
            u["speakerId"] = new_speakers[0]["id"]
            u["speakerName"] = new_speakers[0]["name"]

    m["speakers"] = new_speakers
    m["utterances"] = utterances
    _SPEAKER_VECTORS[mid] = new_vectors_by_spk
    _save_meeting(m)
    return m


@router.patch("/meetings/{mid}/utterances/{uid}")
async def reassign_utterance(mid: str, uid: str, req: Request):
    """Reassigns a specific utterance to a different speaker."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    body = await req.json()
    new_spk_id = body.get("speakerId")
    if not new_spk_id:
        raise HTTPException(400, "speakerId is required")

    target_spk = next((s for s in m.get("speakers", []) if s["id"] == new_spk_id), None)
    if not target_spk:
        raise HTTPException(404, "Target speaker not found")

    target_u = next((u for u in m.get("utterances", []) if u["id"] == uid), None)
    if not target_u:
        raise HTTPException(404, "Utterance not found")

    old_spk_id = target_u["speakerId"]
    target_u["speakerId"] = target_spk["id"]
    target_u["speakerName"] = target_spk["name"]

    # Recalculate speaker counts & durations
    for s in m.get("speakers", []):
        s_utts = [u for u in m["utterances"] if u["speakerId"] == s["id"]]
        s["utteranceCount"] = len(s_utts)
        s["totalDuration"] = round(sum(max(0.0, float(u.get("end", 0)) - float(u.get("start", 0))) for u in s_utts), 1)

    # Update vector store
    vectors_map = _ensure_meeting_vectors(mid, m)
    if target_u.get("voiceVector") and mid in _SPEAKER_VECTORS:
        vec = np.array(target_u["voiceVector"], dtype=np.float32)
        if old_spk_id in vectors_map:
            vectors_map[old_spk_id] = [v for v in vectors_map[old_spk_id] if not np.array_equal(v, vec)]
        vectors_map.setdefault(target_spk["id"], []).append(vec)

    _save_meeting(m)
    return m


@router.post("/meetings/{mid}/summarize")
async def summarize_meeting(mid: str):
    """Compiles an executive summary with key decisions, action items, and topic breakdown using ShellB-Swift."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    utterances = m.get("utterances", [])
    if not utterances:
        raise HTTPException(400, "Meeting has no transcript to summarize.")

    # Build formatted transcript
    lines = []
    for u in utterances:
        s_min = int(u["start"]) // 60
        s_sec = int(u["start"]) % 60
        ts = f"{s_min:02d}:{s_sec:02d}"
        lines.append(f"[{ts}] {u['speakerName']}: {u['text']}")
    transcript_text = "\n".join(lines)

    speakers_list = ", ".join(f"{s['name']}" for s in m.get("speakers", []))

    system_prompt = (
        "You are an expert Executive Meeting Secretary. "
        "Your task is to analyze the provided diarized meeting transcript and produce an authoritative, "
        "structured meeting record with action items, key decisions, and topic summaries.\n\n"
        "Return a strictly valid JSON object with the following schema:\n"
        "{\n"
        '  "title": "A crisp, descriptive title for this meeting (e.g. Q4 Infrastructure Architecture & Rollout)",\n'
        '  "tldr": "A 2 to 3 paragraph executive summary synthesizing the core goals, discussion arc, and outcomes.",\n'
        '  "participants": [\n'
        '    {"name": "Speaker Name", "role": "Inferred role / perspective", "contribution": "Key points raised"}\n'
        "  ],\n"
        '  "topics": [\n'
        '    {"title": "Topic Title", "notes": ["Key point 1", "Key point 2"]}\n'
        "  ],\n"
        '  "decisions": ["Definitive decision 1", "Definitive decision 2"],\n'
        '  "actionItems": [\n'
        '    {"id": "act_1", "task": "Task description", "owner": "Assigned Person", "priority": "high|medium|low", "deadline": "Timeframe if mentioned or TBD"}\n'
        "  ],\n"
        '  "openQuestions": ["Unresolved topic or follow-up question"]\n'
        "}\n"
        "Be specific, capture concrete technical details, and assign every action item to the appropriate person."
    )

    user_prompt = (
        f"Meeting Title: {m.get('title', 'Meeting')}\n"
        f"Identified Speakers: {speakers_list}\n\n"
        f"Transcript:\n{transcript_text}"
    )

    payload = {
        "model": "ShellB-Swift",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 32768},
    }

    try:
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.post(f"{OLLAMA}/api/chat", json=payload)
            r.raise_for_status()
            res_content = r.json()["message"]["content"]
            summary_data = json.loads(res_content)
    except Exception as e:
        log.warning("Ollama JSON meeting summary failed, falling back to text prompt: %s", e)
        # Fallback to plain prompt
        payload["format"] = ""
        payload["messages"][0]["content"] = (
            "You are an expert Executive Meeting Secretary. Write an executive summary of this meeting in Markdown, "
            "including Executive Summary, Key Decisions, Action Items (with Owner and Priority), and Discussion Topics."
        )
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.post(f"{OLLAMA}/api/chat", json=payload)
            r.raise_for_status()
            raw_text = r.json()["message"]["content"]
            summary_data = {
                "title": m.get("title") or "Meeting Summary",
                "tldr": raw_text[:500],
                "participants": [],
                "topics": [],
                "decisions": [],
                "actionItems": [],
                "openQuestions": [],
            }

    # Format Markdown document
    md_lines = []
    title = summary_data.get("title") or m.get("title") or "Meeting Summary"
    m["title"] = title
    md_lines.append(f"# {title}\n")
    md_lines.append(f"**Date**: {time.strftime('%B %d, %Y', time.localtime(m['created']))}  ")
    md_lines.append(f"**Duration**: {int(m.get('duration', 0)) // 60}m {int(m.get('duration', 0)) % 60}s  ")
    md_lines.append(f"**Participants**: {', '.join(s['name'] for s in m.get('speakers', []))}\n")

    md_lines.append("## Executive Summary\n")
    md_lines.append(f"{summary_data.get('tldr', '')}\n")

    if summary_data.get("decisions"):
        md_lines.append("## Key Decisions Made\n")
        for i, d in enumerate(summary_data["decisions"], 1):
            md_lines.append(f"{i}. **{d}**")
        md_lines.append("")

    if summary_data.get("actionItems"):
        md_lines.append("## Action Items & Next Steps\n")
        md_lines.append("| Task | Owner | Priority | Timeline |")
        md_lines.append("| :--- | :--- | :--- | :--- |")
        for item in summary_data["actionItems"]:
            task = item.get("task", "")
            owner = item.get("owner", "Unassigned")
            prio = item.get("priority", "medium").upper()
            deadline = item.get("deadline", "TBD")
            md_lines.append(f"| {task} | **{owner}** | `{prio}` | {deadline} |")
        md_lines.append("")

    if summary_data.get("topics"):
        md_lines.append("## Discussion Breakdown\n")
        for topic in summary_data["topics"]:
            md_lines.append(f"### {topic.get('title', 'Topic')}")
            for n in topic.get("notes", []):
                md_lines.append(f"- {n}")
            md_lines.append("")

    if summary_data.get("openQuestions"):
        md_lines.append("## Open Questions & Follow-ups\n")
        for q in summary_data["openQuestions"]:
            md_lines.append(f"- [ ] {q}")
        md_lines.append("")

    summary_md = "\n".join(md_lines)

    m["summary"] = summary_md
    m["summaryData"] = summary_data
    m["status"] = "completed"
    _save_meeting(m)

    return {
        "summary": summary_md,
        "summaryData": summary_data,
        "title": title,
    }


@router.post("/meetings/{mid}/suggest-names")
async def suggest_speaker_names(mid: str):
    """Uses LLM to detect names mentioned in conversational greetings or intros."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    utterances = m.get("utterances", [])[:40]  # First 40 turns usually contain greetings/intros
    if not utterances:
        return {"suggestions": {}}

    lines = [f"{u['speakerName']} ({u['speakerId']}): {u['text']}" for u in utterances]
    dialogue = "\n".join(lines)

    prompt = (
        "Based on conversational cues in this dialogue (greetings, introductions, 'Hi this is X', 'Thanks Y', etc.), "
        "infer the real person's name for each speaker ID where discernible.\n"
        f"Speakers: {[s['id'] for s in m.get('speakers', [])]}\n\n"
        f"Dialogue snippet:\n{dialogue}\n\n"
        'Return ONLY a JSON map of {"speaker_id": "Real Name"}. Do not guess if there is no clue.'
    )

    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                f"{OLLAMA}/api/chat",
                json={
                    "model": "ShellB-Swift",
                    "messages": [{"role": "user", "content": prompt}],
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0.1},
                },
            )
            r.raise_for_status()
            sug = json.loads(r.json()["message"]["content"])
            return {"suggestions": sug}
    except Exception as e:
        log.warning("Name suggestion failed: %s", e)
        return {"suggestions": {}}


@router.post("/meetings/{mid}/save-to-codex")
async def save_meeting_to_codex(mid: str):
    """Saves the meeting summary and transcript into the Codex reference shelf as a permanent Note."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    title = m.get("title") or "Meeting Record"
    summary_md = m.get("summary") or "## Meeting Summary\n*(No summary generated yet)*\n"

    # Append full transcript
    transcript_md = "\n\n## Full Diarized Transcript\n\n"
    for u in m.get("utterances", []):
        s_min = int(u["start"]) // 60
        s_sec = int(u["start"]) % 60
        ts = f"{s_min:02d}:{s_sec:02d}"
        transcript_md += f"**[{ts}] {u['speakerName']}**: {u['text']}\n\n"

    full_body = summary_md + transcript_md
    tags = ["meeting", "secretary", "summary", "notes"]
    for spk in m.get("speakers", []):
        tags.append(spk["name"].lower().replace(" ", "-"))

    entry = codex.create({
        "kind": "note",
        "title": f"Meeting: {title}",
        "body": full_body,
        "tags": tags,
    })

    m["codexEntryId"] = entry["id"]
    _save_meeting(m)

    return {"ok": True, "codexEntry": entry}


@router.post("/meetings/{mid}/ask")
async def ask_meeting(mid: str, req: Request):
    """Answers user questions grounded strictly in the meeting transcript and summary."""
    m = _load_meeting(mid)
    if not m:
        raise HTTPException(404, "Meeting not found")

    body = await req.json()
    question = str(body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "Question is required")

    transcript_lines = []
    for u in m.get("utterances", []):
        s_min = int(u["start"]) // 60
        s_sec = int(u["start"]) % 60
        transcript_lines.append(f"[{s_min:02d}:{s_sec:02d}] {u['speakerName']}: {u['text']}")
    transcript_text = "\n".join(transcript_lines)

    context = f"Meeting Title: {m.get('title')}\n\nSummary:\n{m.get('summary', '')}\n\nTranscript:\n{transcript_text}"

    messages = [
        {
            "role": "system",
            "content": (
                "You are an intelligent executive meeting secretary. Answer the user's question using ONLY the facts "
                "from the meeting summary and transcript. Be direct, cite speakers when relevant, and mention timestamps if helpful."
            ),
        },
        {"role": "user", "content": f"Meeting Record:\n{context}\n\nQuestion: {question}"},
    ]

    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            f"{OLLAMA}/api/chat",
            json={
                "model": "ShellB-Swift",
                "messages": messages,
                "stream": False,
                "options": {"temperature": 0.2, "num_ctx": 32768},
            },
        )
        r.raise_for_status()
        answer = r.json()["message"]["content"]

    return {"answer": answer}
