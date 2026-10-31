# Reuse the runner's CPU Blender toolchain (build it first; see README).
FROM bunbunny-run-render:latest
WORKDIR /work
ENTRYPOINT ["blender", "-b", "--factory-startup", "--python-exit-code", "1", "--python", "assets-src/td/render.py"]
