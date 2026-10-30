#include "engine/TrafficEngine.hpp"
#include <cmath>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace greenlight {
namespace {
constexpr std::array<std::array<bool, movement_count>, 4> phase_masks{{
    {{true,false,false,true,false,false,false,false,false,false,false,false}},
    {{false,true,true,false,true,true,false,false,false,false,false,false}},
    {{false,false,false,false,false,false,true,false,false,true,false,false}},
    {{false,false,false,false,false,false,false,true,true,false,true,true}}
}};
void check(bool condition, const char* message) {
    if (!condition) throw std::invalid_argument(message);
}
}
void SignalPlan::validate() const {
    check(min_green > 0 && min_green <= max_green, "invalid minimum/maximum green");
    check(yellow_seconds > 0 && all_red_seconds > 0, "clearance intervals must be positive");
    for (auto duration : green_seconds)
        check(duration >= min_green && duration <= max_green, "green duration outside safety limits");
}
void SimulationConfig::validate() const {
    signals.validate();
    check(service_per_green_second > 0, "service capacity must be positive");
    for (double p : arrival_probability)
        check(std::isfinite(p) && p >= 0 && p <= 1, "arrival probabilities must be finite and in [0,1]");
}
std::array<bool, movement_count> green_movements(SignalPhase phase, SignalStage stage) {
    auto i = static_cast<std::size_t>(phase);
    check(i < phase_masks.size(), "invalid phase");
    return stage == SignalStage::Green ? phase_masks[i] : std::array<bool, movement_count>{};
}
bool conflicting(Movement first, Movement second) {
    auto a = static_cast<std::size_t>(first), b = static_cast<std::size_t>(second);
    check(a < movement_count && b < movement_count, "invalid movement");
    if (a == b) return false;
    // Conservative protected-movement policy: only compatible within a phase group.
    for (const auto& mask : phase_masks) if (mask[a] && mask[b]) return false;
    return true;
}
FixedTimeController::FixedTimeController(SignalPlan plan) : plan_(std::move(plan)) { plan_.validate(); }
void FixedTimeController::advance() {
    ++elapsed_;
    const auto duration = stage_ == SignalStage::Green ? plan_.green_seconds[static_cast<std::size_t>(phase_)]
                        : stage_ == SignalStage::Yellow ? plan_.yellow_seconds : plan_.all_red_seconds;
    if (elapsed_ < duration) return;
    elapsed_ = 0;
    if (stage_ == SignalStage::Green) stage_ = SignalStage::Yellow;
    else if (stage_ == SignalStage::Yellow) stage_ = SignalStage::AllRed;
    else {
        stage_ = SignalStage::Green;
        phase_ = static_cast<SignalPhase>((static_cast<std::size_t>(phase_) + 1) % 4);
    }
}
std::uint64_t TrafficState::throughput() const {
    std::uint64_t n = 0; for (const auto& m : movements) n += m.total_departures; return n;
}
std::uint64_t TrafficState::total_queue() const {
    std::uint64_t n = 0; for (const auto& m : movements) n += m.queue; return n;
}
double TrafficState::mean_departed_wait() const {
    std::uint64_t wait = 0; for (const auto& m : movements) wait += m.departed_wait_seconds;
    return throughput() ? static_cast<double>(wait) / static_cast<double>(throughput()) : 0;
}
Simulator::Simulator(SimulationConfig config)
    : config_(std::move(config)), controller_(config_.signals), rng_(config_.seed) { config_.validate(); }
const TrafficState& Simulator::step() {
    // Apply the signal for [t,t+1). Arrivals join at t, service occurs at t,
    // then remaining vehicles accrue one second of waiting. Publish at t+1.
    state_.phase = controller_.phase(); state_.stage = controller_.stage();
    state_.signal_elapsed = controller_.elapsed() + 1;
    const auto mask = green_movements(state_.phase, state_.stage);
    for (std::size_t i = 0; i < movement_count; ++i) {
        auto& m = state_.movements[i];
        // Explicit mapping avoids implementation-dependent std::bernoulli_distribution.
        const double sample = static_cast<double>(rng_()) / 4294967296.0;
        m.arrivals = sample < config_.arrival_probability[i] ? 1 : 0;
        m.total_arrivals += m.arrivals;
        if (m.arrivals) queues_[i].push_back(state_.time_seconds);
        m.departures = 0;
        if (mask[i]) {
            while (!queues_[i].empty() && m.departures < config_.service_per_green_second) {
                m.departed_wait_seconds += state_.time_seconds - queues_[i].front();
                queues_[i].pop_front(); ++m.departures;
            }
        }
        m.total_departures += m.departures;
        m.queue = queues_[i].size();
        m.queued_vehicle_seconds += m.queue;
    }
    ++state_.time_seconds;
    controller_.advance();
    return state_;
}
std::string status_line(const TrafficState& s) {
    constexpr std::array<const char*, 4> names{"NS_LEFT", "NS_THROUGH_RIGHT", "EW_LEFT", "EW_THROUGH_RIGHT"};
    const char* stage = s.stage == SignalStage::Green ? "G" : s.stage == SignalStage::Yellow ? "Y" : "AR";
    std::uint64_t arrivals = 0, departures = 0;
    for (const auto& m : s.movements) { arrivals += m.arrivals; departures += m.departures; }
    std::ostringstream out;
    out << "t=" << s.time_seconds << " phase=" << names[static_cast<std::size_t>(s.phase)] << '/' << stage
        << ':' << s.signal_elapsed << " in=" << arrivals << " out=" << departures << " q=[";
    for (std::size_t i = 0; i < movement_count; ++i) out << (i ? "," : "") << s.movements[i].queue;
    out << "] throughput=" << s.throughput() << " avg_wait=" << std::fixed << std::setprecision(2)
        << s.mean_departed_wait() << 's';
    return out.str();
}
}
