#include "engine/TrafficEngine.hpp"

#include <iostream>

namespace {
using namespace greenlight;

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void controlled_forecasts() {
    SignalPlan plan;
    std::array<MovementState, movement_count> queues{};
    for (auto& movement : queues) movement.queue = 1;

    for (auto target : {SignalPhase::NS_THROUGH_RIGHT, SignalPhase::EW_LEFT}) {
        Prediction forecast;
        const auto mask = green_movements(target, SignalStage::Green);
        for (std::size_t i = 0; i < movement_count; ++i)
            if (mask[i]) forecast.arrivals[i] = 90;
        ReactiveController controller(plan);
        for (unsigned t = 0; t < plan.green_seconds[0]; ++t) {
            require(controller.stage() == SignalStage::Green, "Forecast skipped green batch");
            controller.advance(queues, &forecast);
        }
        require(controller.stage() == SignalStage::Yellow, "Forecast did not trigger a transition");
        // Reverse the ranking during clearance. The selected phase must stay locked.
        forecast.arrivals.fill(1000);
        for (unsigned t = 0; t < plan.yellow_seconds; ++t) {
            require(controller.stage() == SignalStage::Yellow, "Incorrect yellow duration");
            controller.advance(queues, &forecast);
        }
        for (unsigned t = 0; t < plan.all_red_seconds; ++t) {
            require(controller.stage() == SignalStage::AllRed, "Incorrect all-red duration");
            controller.advance(queues, &forecast);
        }
        require(controller.stage() == SignalStage::Green && controller.phase() == target,
                "Controlled forecast failed to change selected phase");
    }

    // A sustained extreme preference cannot extend the current green or starve queued rivals.
    Prediction extreme;
    extreme.arrivals[0] = 1e9;
    ReactiveController controller(plan);
    std::array<unsigned, 4> gap{};
    const auto bound = 6 * (plan.max_green + plan.yellow_seconds + plan.all_red_seconds);
    for (unsigned t = 0; t < 1500; ++t) {
        const auto phase = static_cast<std::size_t>(controller.phase());
        const auto stage = controller.stage();
        const auto elapsed = controller.elapsed();
        const auto green = green_movements(controller.phase(), stage);
        for (std::size_t a = 0; a < movement_count; ++a) {
            require(stage == SignalStage::Green || !green[a], "Green during clearance");
            for (std::size_t b = a + 1; b < movement_count; ++b)
                require(!green[a] || !green[b] || !conflicting(static_cast<Movement>(a),
                        static_cast<Movement>(b)), "Conflicting green movements");
        }
        for (std::size_t p = 0; p < gap.size(); ++p) {
            gap[p] = p == phase && stage == SignalStage::Green ? 0 : gap[p] + 1;
            require(gap[p] <= bound, "Forecast starved persistent demand");
        }
        controller.advance(queues, &extreme);
        if (stage == SignalStage::Green) {
            require(elapsed < plan.max_green, "Maximum green exceeded");
            if (controller.stage() != stage)
                require(elapsed + 1 >= plan.min_green &&
                        controller.stage() == SignalStage::Yellow, "Unsafe green transition");
        }
    }
}

void simulator_fallback(const char* weights) {
    SimulationConfig config;
    config.controller = ControllerMode::Reactive;
    Simulator reactive(config);
    config.controller = ControllerMode::Predictive;
    Simulator without_model(config);
    config.imputed_speed_model = weights;
    Simulator with_model(config);
    bool used_forecast = false, used_fallback = false;
    for (unsigned t = 1; t <= 300; ++t) {
        const auto& baseline = reactive.step();
        const auto& fallback = without_model.step();
        const auto& predicted = with_model.step();
        const auto same_signal = [&](const TrafficState& state) {
            return state.phase == baseline.phase && state.stage == baseline.stage &&
                   state.signal_elapsed == baseline.signal_elapsed &&
                   state.throughput() == baseline.throughput();
        };
        require(!fallback.prediction && same_signal(fallback), "No-model fallback differs from reactive");
        require(fallback.predictive_decision != DecisionSource::Forecast, "Forecast used without model");
        used_fallback |= fallback.predictive_decision == DecisionSource::ReactiveFallback;
        if (t < 60) {
            require(!predicted.prediction && same_signal(predicted), "Warm-up differs from reactive");
            require(predicted.predictive_decision != DecisionSource::Forecast, "Forecast used during warm-up");
        }
        used_forecast |= predicted.predictive_decision == DecisionSource::Forecast;
        for (std::size_t i = 0; i < movement_count; ++i) {
            require(fallback.movements[i].queue == baseline.movements[i].queue,
                    "Fallback queue differs from reactive");
            const auto& movement = predicted.movements[i];
            require(movement.total_arrivals == movement.queue + movement.total_departures,
                    "Predictive queue conservation failed");
        }
    }
    require(used_fallback && used_forecast, "Decision sources were not exercised");
}
}

int main(int argc, char** argv) {
    try {
        require(argc == 2, "Expected weights path");
        controlled_forecasts();
        simulator_fallback(argv[1]);
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
