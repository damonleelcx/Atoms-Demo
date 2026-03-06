# Build stage. Pass --build-arg CACHEBUST=1 to force full rebuild when backend code changed.
FROM golang:1.23-alpine AS builder
ARG CACHEBUST=0
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN echo "cachebust=$CACHEBUST" && CGO_ENABLED=0 go build -o /server ./cmd/server

# Run stage
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /server .
COPY config.yaml .
EXPOSE 8080
ENTRYPOINT ["./server"]
