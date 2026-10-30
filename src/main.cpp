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
        if (argc > 3) throw std::invalid_argument("usage: green_light [seconds=60] [seed=42]");
        unsigned seconds = argc > 1 ? parse_unsigned(argv[1]) : 60;
        greenlight::SimulationConfig config;
        if (argc > 2) config.seed = parse_unsigned(argv[2]);
        greenlight::Simulator sim(config);
        for (unsigned t = 0; t < seconds; ++t) std::cout << greenlight::status_line(sim.step()) << '\n';
    } catch (const std::exception& e) {
        std::cerr << "Engine error: " << e.what() << '\n'; return 1;
    }
}
