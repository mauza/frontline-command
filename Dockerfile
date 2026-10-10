FROM node:24-alpine AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-bookworm AS server-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=1 go test ./... && CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home frontline && mkdir -p /data/games /data/archives && chown -R frontline:frontline /data
COPY --from=server-build /server /app/server
COPY --from=web-build /src/web/dist /app/web
USER frontline
ENV ADDR=:8080 DATA_DIR=/data WEB_DIR=/app/web
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/app/server"]
