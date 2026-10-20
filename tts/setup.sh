#!/usr/bin/env bash
# Creates tts/.venv with Python 3.12 + Kitten TTS 2 (kittenml) and a GPU torch build when possible.
#   tts/setup.sh               # torch build auto-detected: NVIDIA -> cuda, AMD Strix Halo -> rocm-gfx1151, other AMD -> rocm, else cpu
#   tts/setup.sh --with-qwen   # also install Qwen3-TTS (models "Qwen/...")
#   TORCH=cpu tts/setup.sh     # force a build: cuda | rocm | rocm-gfx1151 | cpu
set -euo pipefail
cd "$(dirname "$0")"

torch="${TORCH:-auto}"
if [[ "$torch" == auto ]]; then
  if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then torch=cuda
  elif [[ -e /dev/kfd ]] && lspci 2>/dev/null | grep -qi 'strix halo'; then torch=rocm-gfx1151
  elif [[ -e /dev/kfd ]]; then torch=rocm
  else torch=cpu; fi
fi
with_qwen=false
[[ "${1:-}" == --with-qwen ]] && with_qwen=true

if ! command -v uv >/dev/null; then
  echo "==> bootstrapping uv in tts/.bootstrap"
  python3 -m venv .bootstrap
  .bootstrap/bin/pip install -q uv
  UV="$PWD/.bootstrap/bin/uv"
else
  UV=uv
fi

[[ -d .venv ]] || "$UV" venv --python 3.12 .venv
export VIRTUAL_ENV="$PWD/.venv"

if ! "$UV" pip freeze | grep -q '^torch=='; then
  echo "==> torch ($torch)"
  case "$torch" in
    cpu) "$UV" pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu ;;
    cuda) "$UV" pip install torch torchaudio ;;
    rocm) "$UV" pip install torch torchaudio --index-url https://download.pytorch.org/whl/rocm6.4 ;;
    # AMD Strix Halo (Radeon 8060S): ROCm wheels built by AMD's TheRock project
    rocm-gfx1151) "$UV" pip install torch torchaudio --index-url https://rocm.nightlies.amd.com/v2/gfx1151/ ;;
    *) echo "unknown TORCH=$torch" >&2; exit 2 ;;
  esac
fi

# keep the installed torch build (other packages would otherwise pull the default PyPI one)
TORCH_PIN="$("$UV" pip freeze | grep -E '^(torch|torchaudio)==')"
"$UV" pip install kittenml soundfile --constraint <(echo "$TORCH_PIN")
$with_qwen && "$UV" pip install qwen-tts --constraint <(echo "$TORCH_PIN")
echo "==> done. Start the server with: npm run tts   (the model downloads on first start)"
