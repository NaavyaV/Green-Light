# Green-Light


## C++ engine integration

The tested engine lives in `src/engine/`; `src/main.cpp` runs it. Build and run:

```sh
cmake -S . -B /tmp/green-light-cpp-build -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/green-light-cpp-build
ctest --test-dir /tmp/green-light-cpp-build --output-on-failure
/tmp/green-light-cpp-build/green_light 300 42 --controller fixed
/tmp/green-light-cpp-build/green_light 300 42 --controller reactive
```

See `src/engine/README.md` for timing conventions, queue statistics, and measured
comparison results. The bounded reactive controller reduces accumulated queueing across the three documented seeds. Fixed-time throughput still leads on seed 123. Both respect green
limits and clearance intervals. Predictive control is not implemented.

Sanjit's original `src/control`, `src/core`, `src/io`, `src/signal`, `src/sim`, and
placeholder tests are retained unchanged. They are scaffolds and are not compiled;
the working implementation is `src/engine`. The empty `CMakelists.txt` scaffold was
renamed to standard `CMakeLists.txt` and populated. The original entry-point comment
is retained in `src/main.cpp`.

`ml_handoff/` contains only the frozen inference header, exported 680-epoch weights,
interface contract, and parity fixtures/test required by this C++ branch. CTest
runs the inference parity test as well as the nine engine tests and controller benchmark. Engine and ML
remain separate: no model calls, fabricated speed observations, or predictive
signal decisions are added. Training, exporter, dataset, evaluations and archived
model baselines remain maintained on `ML`; those artifacts are not duplicated here.
