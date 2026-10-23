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

On Linux or macOS, leave out `-G "MinGW Makefiles"`.

## Run

```bash
./build/green_light
```
