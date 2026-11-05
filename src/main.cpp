// Entry point: runs the intersection simulation with the fixed-timing
// controller and prints one line per simulated second.
//
// Usage: green_light [seconds] [seed]
//   seconds  how many simulated seconds to run (default 120)
//   seed     random seed for arrivals (default Config::randomSeed)
//
// Exit codes: 0 success, 1 bad arguments or invalid Config, 2 safety violation (a bug).

#include <cstdint>
#include <exception>
#include <iostream>
#include <string>

#include "control/FixedTimingController.hpp"
#include "core/Config.hpp"
#include "io/ConsoleLogger.hpp"
#include "signal/SafetyRules.hpp"
#include "sim/Simulator.hpp"

namespace {

constexpr int kDefaultSeconds = 120;

void printUsage() {
    std::cerr << "Usage: green_light [seconds] [seed]\n"
              << "  seconds  simulated seconds to run, 0 or more (default " << kDefaultSeconds
              << ")\n"
              << "  seed     random seed for arrivals, 0 to 4294967295 (default "
              << Config{}.randomSeed << ")\n";
}

// Parses a whole-number argument. Returns false if `text` is not entirely a
// number in [0, max].
bool parseNumber(const std::string& text, unsigned long long max, unsigned long long& value) {
    if (text.empty() || text[0] == '-' || text[0] == '+') return false;
    try {
        std::size_t used = 0;
        value = std::stoull(text, &used);
        return used == text.size() && value <= max;
    } catch (const std::exception&) {
        return false;
    }
}

}  // namespace

int main(int argc, char* argv[]) {
    if (argc > 3) {
        printUsage();
        return 1;
    }

    Config config;
    int seconds = kDefaultSeconds;
    unsigned long long value = 0;

    if (argc >= 2) {
        if (!parseNumber(argv[1], 1000000000ULL, value)) {
            std::cerr << "Error: seconds must be a whole number, got \"" << argv[1] << "\"\n";
            printUsage();
            return 1;
        }
        seconds = static_cast<int>(value);
    }
    if (argc >= 3) {
        if (!parseNumber(argv[2], UINT32_MAX, value)) {
            std::cerr << "Error: seed must be a whole number from 0 to 4294967295, got \""
                      << argv[2] << "\"\n";
            printUsage();
            return 1;
        }
        config.randomSeed = static_cast<std::uint32_t>(value);
    }

    // Refuse to start with a Config that breaks the safety rules.
    const Verdict valid = SafetyRules::validateConfig(config);
    if (!valid.accepted) {
        std::cerr << "Error: " << valid.reason << "\n";
        return 1;
    }

    try {
        FixedTimingController controller;
        Simulator sim(config, controller);
        ConsoleLogger logger(std::cout);

        for (int i = 0; i < seconds; ++i) {
            const StepResult result = sim.step();
            if (result.change) {
                logger.logSignalChange(*result.change);
            }
            if (result.rejection) {
                logger.logRejection(sim.time(), *result.rejection);
            }
            logger.logSecond(sim.state());
        }
    } catch (const SafetyViolation& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 2;
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 1;
    }

    return 0;
}
