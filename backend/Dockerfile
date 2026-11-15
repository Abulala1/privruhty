FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt && python -m spacy download en_core_web_sm
RUN useradd --create-home --uid 10001 privruhty
COPY --chown=privruhty:privruhty app ./app
USER privruhty
EXPOSE 8765
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "2", "--limit-concurrency", "16", "--no-access-log"]
