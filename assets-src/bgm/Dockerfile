FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3
# Base and complete dependency versions are pinned.
COPY apt-packages.lock /tmp/apt-packages.lock
RUN rm /etc/apt/sources.list.d/debian.sources && \
    echo 'deb http://deb.debian.org/debian bookworm main' > /etc/apt/sources.list && \
    apt-get update && xargs -a /tmp/apt-packages.lock apt-get install -y --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 LC_ALL=C SOURCE_DATE_EPOCH=1793491200
WORKDIR /work
ENTRYPOINT ["python3", "assets-src/bgm/render.py"]
