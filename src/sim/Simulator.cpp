#include "sim/Simulator.hpp"

#include "signal/PhaseMap.hpp"

Simulator::Simulator(const Config& config, IController& controller)
    : intersection_(config.departureRate),
      arrivals_(config),
      signal_(config),
      controller_(controller) {
    // Valid before the first step: time 0, NS_THROUGH with its full plan, empty queues.
    updateState(0);
}

StepResult Simulator::step() {
    StepResult result;
    const int t = time_;       // the second being simulated
    const int next = t + 1;    // the second a new phase would start

    // 1. Generate arrivals
    const auto counts = arrivals_.nextSecond();

    // 2. Add them to the queues
    intersection_.addArrivals(t, counts);

    // 3. Let vehicles on green movements pass (using the current phase)
    intersection_.processDepartures(t, signal_.greenMovements());

    // 4. Update queues and wait times: done by steps 2 and 3. Intersection
    //    stores each car's arrival second and works out waits when asked.

    // 5. Update the signal timer. If the plan has run out, the phase ends by itself.
    result.change = signal_.tick(next);

    // 6. Otherwise, during a green, the controller decides, SafetyRules
    //    reviews the decision and SignalController applies it.
    if (!result.change && isGreen(signal_.phase())) {
        const Decision decision = controller_.decide(state_, signal_.status());
        const DecisionOutcome outcome = signal_.applyDecision(decision, next);
        result.change = outcome.change;
        if (!outcome.accepted) {
            result.rejection = outcome.reason;
        }
    }

    // 7. Update TrafficState. The only place time advances.
    time_ = next;
    updateState(t);

    return result;
}

void Simulator::updateState(int simulatedSecond) {
    const SignalStatus status = signal_.status();
    state_.time = time_;
    state_.phase = status.phase;
    state_.phaseSecondsRemaining = status.secondsRemaining;
    intersection_.snapshot(state_, simulatedSecond);
}
