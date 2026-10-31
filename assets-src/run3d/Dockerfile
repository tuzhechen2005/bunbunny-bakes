# Reuse the existing CPU-only Debian Blender pipeline (4.3.2).
ARG BLENDER_IMAGE=bunbunny-run-render:latest
FROM ${BLENDER_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends python3-numpy && rm -rf /var/lib/apt/lists/*
WORKDIR /work
ENTRYPOINT ["blender", "-b", "--factory-startup", "--python-exit-code", "1", "--python", "assets-src/run3d/render.py"]
