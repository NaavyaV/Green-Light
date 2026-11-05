#include "engine/TrafficEngine.hpp"

#include <cmath>
#include <iostream>
#include <sstream>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
}

int main(int argc, char** argv) {
    using namespace greenlight;
    try {
        require(argc == 3, "Expected weights and reference CSV paths");
        for (const auto& invalid : {std::string(argv[1]) + ".missing", std::string(argv[2])}) {
            SimulationConfig config;
            config.imputed_speed_model = invalid;
            bool rejected = false;
            try {
                Simulator simulator(config);
            } catch (const std::runtime_error&) {
                rejected = true;
            }
            require(rejected, "Missing or malformed model must be rejected");
        }

        std::ifstream fixture(argv[2]);
        std::string header;
        require(bool(std::getline(fixture, header)), "Missing reference fixture header");
        std::istringstream columns(header);
        for (const auto* movement : movement_names) {
            for (const auto* suffix : {"arr5", "arr15", "arr30", "arr60", "avg_speed"}) {
                std::string column;
                std::getline(columns, column, ',');
                require(column == std::string(movement) + "_" + suffix, "Feature order differs from export");
            }
        }

        TrafficMLP reference;
        reference.load(argv[1]);
        for (auto controller : {ControllerMode::Fixed, ControllerMode::Reactive}) {
            SimulationConfig config;
            config.controller = controller;
            Simulator baseline(config);
            config.imputed_speed_model = argv[1];
            Simulator simulation(config);
            std::array<std::array<std::uint64_t, movement_count>, 131> totals{};
            std::optional<Prediction> last;
            for (std::size_t t = 1; t < totals.size(); ++t) {
                const auto& state = simulation.step();
                require(status_line(state) == status_line(baseline.step()), "Controller behavior changed");
                require(!baseline.state().prediction, "Default mode should not forecast");
                for (std::size_t i = 0; i < movement_count; ++i)
                    totals[t][i] = state.movements[i].total_arrivals;
                const auto features = simulation.forecast_features();
                if (t < 60) {
                    require(!features && !state.prediction, "Forecast before warm-up");
                    continue;
                }
                require(features.has_value(), "Missing completed feature window");
                for (std::size_t i = 0; i < movement_count; ++i) {
                    std::size_t slot = i * 5;
                    for (std::size_t width : {5, 15, 30, 60})
                        require((*features)[slot++] == totals[t][i] - totals[t - width][i],
                                "Incorrect arrival window");
                    require((*features)[slot] == reference.mean[slot], "Incorrect speed imputation");
                }
                require(state.prediction.has_value(), "Missing forecast after warm-up");
                const auto& forecast = *state.prediction;
                require(forecast.generated_at == t - t % 5, "Incorrect forecast cadence");
                require(forecast.horizon_seconds == 30, "Incorrect forecast horizon");
                if (t % 5 == 0) {
                    const auto expected = reference.predict({features->begin(), features->end()});
                    require(forecast.arrivals.size() == expected.size(), "Wrong forecast shape");
                    for (std::size_t i = 0; i < movement_count; ++i) {
                        const auto count = forecast.arrivals[i];
                        require(std::isfinite(count) && count >= 0, "Invalid predicted arrival count");
                        require(std::abs(count - expected[i]) < 1e-10, "Prediction differs from reference MLP");
                    }
                    last = forecast;
                } else {
                    require(last && forecast.arrivals == last->arrivals, "Forecast changed between ticks");
                }
            }
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
