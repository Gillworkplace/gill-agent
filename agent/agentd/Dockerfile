FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple uvicorn
COPY pyproject.toml ./
COPY gill_core ./gill_core
COPY agentd ./agentd
COPY gill_cli ./gill_cli
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
    "openai>=1.40" "typer>=0.12" "rich>=13" "httpx>=0.27" "pydantic>=2.7" \
    "fastapi>=0.111" "redis>=5" "cubesandbox>=0.7.3" "websockets>=12"
ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["python", "-m", "agentd.app"]
