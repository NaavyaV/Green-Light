# Green-Light

The C++ engine for Green Light, a real-time adaptive traffic signal system. It simulates a four-way intersection once per simulated second and operates the signals safely. Milestone 1 is a standalone simulator with a fixed-timing controller; see `docs/PLAN.md` for the full plan.

## Requirements

- CMake 3.16 or newer
- A C++17 compiler (developed with g++ 10.3 / TDM-GCC on Windows)

## Build

From the repo root:

```bash
cmake -S . -B build -G "MinGW Makefiles"
cmake --build build
```

On Linux or macOS, leave out `-G "MinGW Makefiles"`. For a clean rebuild, delete the `build` folder first.

## Run

```bash
./build/green_light [seconds] [seed]
```

- `seconds`: how many simulated seconds to run (default 120)
- `seed`: random seed for the arrivals (default 42). The same seed always gives the same traffic.

For example, `./build/green_light 300 7` runs five simulated minutes with seed 7.

Output is one status line per simulated second, plus a line for each signal change and each decision the safety rules reject:

```
TIME 19s | NS_THROUGH | NS Queue: 2 | EW Queue: 7 | Avg Wait: 12.8s | Passed: 5
[20s] SIGNAL: NS_THROUGH -> NS_YELLOW
TIME 20s | NS_YELLOW | NS Queue: 2 | EW Queue: 8 | Avg Wait: 12.4s | Passed: 5
```

All timings and rates live in `src/core/Config.hpp`. Rebuild after changing them. The program refuses to start if the settings break a safety rule (for example, a minimum green longer than a default green).

Exit codes: `0` success, `1` bad arguments or invalid settings, `2` safety violation (a bug in the engine).

## Test

```bash
ctest --test-dir build --output-on-failure
```

Each test is also a program you can run on its own, such as `./build/test_simulator`, which prints the largest queue seen for each movement.
