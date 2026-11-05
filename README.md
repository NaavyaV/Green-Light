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
runs inference parity, simulator forecasting, engine and predictive controller
tests, and the three-controller benchmark. See [optional simulator forecasting](src/engine/README.md#optional-simulator-forecasting)
for the explicit training-mean speed imputation mode. Use the [predictive controller commands](src/engine/README.md#predictive-mode)
to exercise forecast-based signal decisions. Fixed and reactive controllers
operate independently of forecasts. Training data, exporter,
evaluations, and model baselines are maintained on the `ML` branch.
