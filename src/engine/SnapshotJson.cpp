#include "engine/TrafficEngine.hpp"

#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>

namespace greenlight {
std::string snapshot_json(const TrafficState& state, ControllerMode mode) {
    // All string values come from internal enum labels or movement constants.
    constexpr std::array<const char*, 4> phases{
        "NS_LEFT", "NS_THROUGH_RIGHT", "EW_LEFT", "EW_THROUGH_RIGHT"};
    const char* light = state.stage == SignalStage::Green ? "green"
        : state.stage == SignalStage::Yellow ? "yellow" : "all_red";
    const char* controller = mode == ControllerMode::Fixed ? "fixed"
        : mode == ControllerMode::Reactive ? "reactive" : "predictive";

    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::setprecision(std::numeric_limits<double>::max_digits10)
        << "{\"schema_version\":1,\"time_seconds\":" << state.time_seconds
        << ",\"phase\":\"" << phases[static_cast<std::size_t>(state.phase)]
        << "\",\"light_state\":\"" << light
        << "\",\"phase_elapsed_seconds\":" << state.signal_elapsed
        << ",\"controller_mode\":\"" << controller << "\",\"decision_source\":";
    if (state.predictive_decision) {
        const auto source = *state.predictive_decision;
        out << '"' << (source == DecisionSource::Forecast ? "predictive_imputed_speed"
            : source == DecisionSource::ReactiveFallback ? "reactive_fallback" : "safety_timing") << '"';
    } else {
        out << "null";
    }

    out << ",\"movement_order\":[";
    for (std::size_t i = 0; i < movement_count; ++i)
        out << (i ? "," : "") << '"' << movement_names[i] << '"';
    out << ']';

    const auto write_counts = [&](const char* key, auto field) {
        out << ",\"" << key << "\":[";
        for (std::size_t i = 0; i < movement_count; ++i)
            out << (i ? "," : "") << state.movements[i].*field;
        out << ']';
    };
    write_counts("queues", &MovementState::queue);
    write_counts("arrivals", &MovementState::arrivals);
    write_counts("departures", &MovementState::departures);
    out << ",\"throughput\":" << state.throughput()
        << ",\"mean_completed_wait_seconds\":" << state.mean_departed_wait()
        << ",\"forecast\":";
    if (state.prediction) {
        const auto& forecast = *state.prediction;
        out << "{\"generated_at_seconds\":" << forecast.generated_at
            << ",\"horizon_seconds\":" << forecast.horizon_seconds
            << ",\"speed_input\":\"imputed_training_mean\",\"arrivals\":[";
        for (std::size_t i = 0; i < movement_count; ++i)
            out << (i ? "," : "") << forecast.arrivals[i];
        out << "]}";
    } else {
        out << "null";
    }
    out << '}';
    return out.str();
}
} // namespace greenlight
