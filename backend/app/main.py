import os
import secrets
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, Field
from .core import plan, sanitize_txt, sanitize_csv
from .explanations import ExplanationRequest, explain

app = FastAPI(title="Pribruhty Local Service", docs_url=None, redoc_url=None)
TOKEN_PATH = Path.home() / ".pribruhty-token"
if not TOKEN_PATH.exists():
    TOKEN_PATH.write_text(secrets.token_urlsafe(32), encoding="ascii")
    try:
        os.chmod(TOKEN_PATH, 0o600)
    except OSError:
        pass
TOKEN = TOKEN_PATH.read_text(encoding="ascii").strip()
MAX_TEXT = 1_000_000


class Scan(BaseModel):
    text: str = Field(max_length=MAX_TEXT)
    custom: list[str] = Field(default_factory=list, max_length=100)
    categories: list[str] | None = None


@app.middleware("http")
async def restrict(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and not origin.startswith("chrome-extension://"):
        return JSONResponse(
            {"detail": "Only a Chrome extension origin is allowed"}, status_code=403
        )
    if request.method == "OPTIONS":
        return Response(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": origin or "",
                "Access-Control-Allow-Headers": "x-pribruhty-token,content-type",
                "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
            },
        )
    if request.url.path != "/health" and not secrets.compare_digest(
        request.headers.get("x-pribruhty-token", ""), TOKEN
    ):
        return JSONResponse({"detail": "Invalid local token"}, status_code=401)
    response = await call_next(request)
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "x-pribruhty-token,content-type"
        response.headers["Access-Control-Allow-Methods"] = "POST,GET,OPTIONS"
    return response


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/scan")
def scan(body: Scan):
    return plan(body.text, body.custom, body.categories)


@app.post("/explain")
def education(body: ExplanationRequest):
    return explain(body)


@app.post("/document")
async def document(file: UploadFile = File(...), custom: str = Form("")):
    data = await file.read(MAX_TEXT + 1)
    if len(data) > MAX_TEXT:
        raise HTTPException(413, "Document exceeds 1 MB")
    name = Path(file.filename or "document").name
    ext = Path(name).suffix.lower()
    if ext not in (".txt", ".csv"):
        raise HTTPException(415, "Only TXT and CSV are exportable in this MVP")
    try:
        kwargs = {"custom": [x.strip() for x in custom.splitlines() if x.strip()]}
        output, result = (sanitize_txt if ext == ".txt" else sanitize_csv)(data, **kwargs)
    except UnicodeDecodeError:
        raise HTTPException(422, "File must be UTF-8 text")
    if not result["safe_to_submit"]:
        raise HTTPException(409, "Exact sensitive values require manual review")
    return Response(
        output,
        media_type="text/plain" if ext == ".txt" else "text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="protected-{name}"',
            "X-Pribruhty-Count": str(len(result["spans"])),
        },
    )
