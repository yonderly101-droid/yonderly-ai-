FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Install build deps and pip dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . /app

# Default port (can be overridden by $PORT)
ENV PORT=8080
EXPOSE 8080

# Run gunicorn binding to $PORT (Railway/Heroku/Rancher friendly)
CMD ["sh", "-c", "gunicorn -w 4 -b 0.0.0.0:${PORT:-8080} app:app"]
