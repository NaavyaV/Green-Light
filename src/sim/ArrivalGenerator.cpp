#include "sim/ArrivalGenerator.hpp"

namespace {

// Arrival rate for a movement, chosen by whether it is a left, through or right turn.
double rateFor(Movement m, const Config& config) {
    switch (m) {
        case Movement::N_LEFT:
        case Movement::S_LEFT:
        case Movement::E_LEFT:
        case Movement::W_LEFT:
            return config.leftArrivalRate;
        case Movement::N_THROUGH:
        case Movement::S_THROUGH:
        case Movement::E_THROUGH:
        case Movement::W_THROUGH:
            return config.throughArrivalRate;
        case Movement::N_RIGHT:
        case Movement::S_RIGHT:
        case Movement::E_RIGHT:
        case Movement::W_RIGHT:
            return config.rightArrivalRate;
    }
    return 0.0;
}

}  // namespace

ArrivalGenerator::ArrivalGenerator(const Config& config) : rng_(config.randomSeed) {
    for (Movement m : kAllMovements) {
        rates_[toIndex(m)] = rateFor(m, config);
    }
}

std::array<int, kMovementCount> ArrivalGenerator::nextSecond() {
    std::array<int, kMovementCount> counts{};
    // Exactly one roll per movement, always in the same order, even when a
    // rate is 0. Changing one movement's rate then does not shift the random
    // numbers the other movements receive.
    for (Movement m : kAllMovements) {
        std::bernoulli_distribution arrives(rates_[toIndex(m)]);
        counts[toIndex(m)] = arrives(rng_) ? 1 : 0;
    }
    return counts;
}
