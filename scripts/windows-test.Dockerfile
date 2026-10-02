# Compatibility testing on non-Windows hosts; does not establish native Windows DAW support.
FROM --platform=linux/amd64 debian:bookworm
RUN dpkg --add-architecture i386 && apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wine wine32:i386 wine64 xvfb xauth ca-certificates fonts-liberation && \
    rm -rf /var/lib/apt/lists/*
ENV WINEDEBUG=-all WINEPREFIX=/tmp/sessionstream-wine
WORKDIR /work
