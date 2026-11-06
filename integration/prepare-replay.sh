#!/bin/sh
# Create a scratch copy of the team's Vite app with an optional engine replay route.
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: sh integration/prepare-replay.sh <recording.jsonl>" >&2
  exit 2
fi
root=$(git rev-parse --show-toplevel)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/green-light-react.XXXXXX")
git archive origin/frontend frontend > "$scratch/frontend.tar"
tar -xf "$scratch/frontend.tar" -C "$scratch"
rm "$scratch/frontend.tar"
app="$scratch/frontend"
cp "$root/integration/ReplayApp.jsx" "$root/integration/replay.mjs" "$root/integration/replay.css" "$app/src/"
cp "$1" "$app/public/replay.jsonl"
mv "$app/src/App.jsx" "$app/src/LiveApp.jsx"
cat > "$app/src/App.jsx" <<'JSX'
import LiveApp from './LiveApp.jsx';
import ReplayApp from './ReplayApp.jsx';

export default function App() {
  return new URLSearchParams(window.location.search).has('replay') ? <ReplayApp /> : <LiveApp />;
}
JSX
printf '%s\n' "$app"
