// Reproducible finite-horizon comparison. No performance threshold is asserted.
#include "engine/TrafficEngine.hpp"
#include <iomanip>
#include <iostream>

int main(int argc, char** argv) {
    using namespace greenlight;
    if (argc != 2) {
        std::cerr << "Usage: controller_benchmark <model_weights.txt>\n";
        return 1;
    }
    try {
        std::cout << "seed,controller,arrivals,departures,final_queue,queued_vehicle_seconds,"
                     "max_queued_without_green_seconds,forecast_decisions,clearance_seconds,mean_departed_wait\n";
        for (unsigned seed : {42, 7, 123}) {
            SimulationConfig config;
            config.seed = seed;
            Simulator fixed(config);
            config.controller = ControllerMode::Reactive;
            Simulator reactive(config);
            config.controller = ControllerMode::Predictive;
            config.imputed_speed_model = argv[1];
            Simulator predictive(config);
            std::array<Simulator*, 3> simulators{&fixed, &reactive, &predictive};
            std::array<std::array<unsigned, movement_count>, 3> gaps{};
            std::array<unsigned, 3> max_gaps{}, forecast_decisions{}, clearance{};
            for (unsigned t = 0; t < 300; ++t) {
                for (std::size_t mode = 0; mode < simulators.size(); ++mode) {
                    const auto& state = simulators[mode]->step();
                    clearance[mode] += state.stage != SignalStage::Green;
                    const auto green = green_movements(state.phase, state.stage);
                    forecast_decisions[mode] += state.predictive_decision == DecisionSource::Forecast;
                    for (std::size_t i = 0; i < movement_count; ++i) {
                        const auto& movement = state.movements[i];
                        if (movement.arrivals != fixed.state().movements[i].arrivals)
                            throw std::runtime_error("Arrival stream mismatch");
                        auto& gap = gaps[mode][i];
                        gap = movement.queue && !green[i] ? gap + 1 : 0;
                        max_gaps[mode] = std::max(max_gaps[mode], gap);
                    }
                }
            }
            const char* names[] = {"fixed", "reactive", "predictive_imputed_speed"};
            for (std::size_t mode = 0; mode < simulators.size(); ++mode) {
                const auto& state = simulators[mode]->state();
                std::uint64_t arrivals = 0, wait = 0;
                for (const auto& movement : state.movements) {
                    arrivals += movement.total_arrivals;
                    wait += movement.queued_vehicle_seconds;
                }
                std::cout << seed << ',' << names[mode] << ',' << arrivals << ','
                          << state.throughput() << ',' << state.total_queue() << ',' << wait << ','
                          << max_gaps[mode] << ',' << forecast_decisions[mode] << ','
                          << clearance[mode] << ',' << std::fixed << std::setprecision(6)
                          << state.mean_departed_wait() << '\n';
            }
            if (!forecast_decisions[2]) throw std::runtime_error("Predictive benchmark never used forecast");
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
