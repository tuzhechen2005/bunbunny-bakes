# Optional CPU-only renderer when macOS Metal discovery fails in headless mode.
FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends blender \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENTRYPOINT ["blender", "-b", "--factory-startup", "--python-exit-code", "1", "--python", "assets-src/run/render.py"]
