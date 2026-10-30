#include "engine/TrafficEngine.hpp"
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

unsigned parse_unsigned(const char* text) {
    const std::string s(text);
    if (s.empty() || s.find_first_not_of("0123456789") != std::string::npos)
        throw std::invalid_argument("arguments must be unsigned integers");
    auto n = std::stoull(s);
    if (n > std::numeric_limits<unsigned>::max()) throw std::out_of_range("argument too large");
    return static_cast<unsigned>(n);
}
int main(int argc, char** argv) {
    try {
        if (argc > 5) throw std::invalid_argument("usage: green_light [seconds=60] [seed=42] [--controller fixed|reactive]");
        unsigned seconds = argc > 1 ? parse_unsigned(argv[1]) : 60;
        greenlight::SimulationConfig config;
        if (argc > 2) config.seed = parse_unsigned(argv[2]);
        if (argc > 3) {
            if (argc != 5 || std::string(argv[3]) != "--controller")
                throw std::invalid_argument("expected --controller fixed|reactive");
            const std::string mode(argv[4]);
            if (mode == "reactive") config.controller = greenlight::ControllerMode::Reactive;
            else if (mode != "fixed") throw std::invalid_argument("controller must be fixed or reactive");
        }
        greenlight::Simulator sim(config);
        for (unsigned t = 0; t < seconds; ++t) std::cout << greenlight::status_line(sim.step()) << '\n';
    } catch (const std::exception& e) {
        std::cerr << "Engine error: " << e.what() << '\n'; return 1;
    }
}
