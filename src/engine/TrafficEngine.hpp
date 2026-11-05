#pragma once
#include <array>
#include <cstdint>
#include <deque>
#include <optional>
#include <random>
#include <string>

namespace greenlight {
// N/S/E/W denote travel direction, matching ML preprocessing (not entry side).
enum class Movement : std::size_t {
    N_LEFT, N_THROUGH, N_RIGHT, S_LEFT, S_THROUGH, S_RIGHT,
    E_LEFT, E_THROUGH, E_RIGHT, W_LEFT, W_THROUGH, W_RIGHT, Count
};
constexpr std::size_t movement_count = static_cast<std::size_t>(Movement::Count);
inline constexpr std::array<const char*, movement_count> movement_names = {
    "N_LEFT", "N_THROUGH", "N_RIGHT", "S_LEFT", "S_THROUGH", "S_RIGHT",
    "E_LEFT", "E_THROUGH", "E_RIGHT", "W_LEFT", "W_THROUGH", "W_RIGHT"
};
enum class SignalPhase : std::size_t { NS_LEFT, NS_THROUGH_RIGHT, EW_LEFT, EW_THROUGH_RIGHT };
enum class SignalStage { Green, Yellow, AllRed };
struct SignalPlan {
    std::array<unsigned, 4> green_seconds{10, 20, 10, 20};
    unsigned min_green = 5, max_green = 40, yellow_seconds = 3, all_red_seconds = 2;
    void validate() const;
};
struct Prediction {
    std::array<double, movement_count> arrivals{};
    unsigned horizon_seconds = 30;
    std::uint64_t generated_at = 0;
};
struct MovementState {
    std::uint64_t queue = 0, arrivals = 0, departures = 0;
    std::uint64_t total_arrivals = 0, total_departures = 0;
    std::uint64_t queued_vehicle_seconds = 0, departed_wait_seconds = 0;
    std::uint64_t oldest_wait_seconds = 0;
};
struct TrafficState {
    std::uint64_t time_seconds = 0;
    std::array<MovementState, movement_count> movements{};
    SignalPhase phase = SignalPhase::NS_LEFT;
    SignalStage stage = SignalStage::Green;
    unsigned signal_elapsed = 0;
    std::optional<Prediction> prediction; // Unavailable: no ML inference or speed observations.
    std::uint64_t throughput() const;
    std::uint64_t total_queue() const;
    double mean_departed_wait() const;
};
enum class ControllerMode { Fixed, Reactive };
struct SimulationConfig {
    ControllerMode controller = ControllerMode::Fixed;
    std::uint32_t seed = 42;
    // Independent Bernoulli arrivals: zero or one arrival per movement per second.
    std::array<double, movement_count> arrival_probability{
        .15, .35, .10, .15, .35, .10, .15, .35, .10, .15, .35, .10};
    unsigned service_per_green_second = 1;
    SignalPlan signals;
    void validate() const;
};
std::array<bool, movement_count> green_movements(SignalPhase phase, SignalStage stage);
bool conflicting(Movement first, Movement second);
class FixedTimeController {
public:
    explicit FixedTimeController(SignalPlan plan);
    void advance();
    SignalPhase phase() const { return phase_; }
    SignalStage stage() const { return stage_; }
    unsigned elapsed() const { return elapsed_; }
private:
    SignalPlan plan_;
    SignalPhase phase_ = SignalPhase::NS_LEFT;
    SignalStage stage_ = SignalStage::Green;
    unsigned elapsed_ = 0;
};
// Decisions use queues after the completed second; the next phase is locked through clearance.
class ReactiveController {
public:
    explicit ReactiveController(SignalPlan plan);
    void advance(const std::array<MovementState, movement_count>& movements);
    SignalPhase phase() const { return phase_; }
    SignalStage stage() const { return stage_; }
    unsigned elapsed() const { return elapsed_; }
private:
    SignalPlan plan_;
    SignalPhase phase_ = SignalPhase::NS_LEFT;
    SignalPhase next_ = SignalPhase::NS_THROUGH_RIGHT;
    SignalStage stage_ = SignalStage::Green;
    unsigned elapsed_ = 0;
    std::array<std::uint64_t, 4> unserved_seconds_{};
};
class Simulator {
public:
    explicit Simulator(SimulationConfig config = {});
    const TrafficState& step();
    const TrafficState& state() const { return state_; }
private:
    SimulationConfig config_;
    FixedTimeController controller_;
    ReactiveController reactive_;
    std::mt19937 rng_;
    TrafficState state_;
    std::array<std::deque<std::uint64_t>, movement_count> queues_;
};
std::string status_line(const TrafficState& state);
} // namespace greenlight
